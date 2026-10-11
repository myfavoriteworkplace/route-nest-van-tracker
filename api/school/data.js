import { db } from 'hatchable';
import { requireSchoolRole, writeAudit } from '../../lib/tenant.js';
export const access='user'; export const methods=['GET','POST'];
export default async function(req,res){
 const uid=String(req.user.id), schoolId=Number(req.method==='GET'?req.query?.school_id:req.body?.school_id);
 if(!Number.isInteger(schoolId)||schoolId<1)return res.status(400).json({error:'school_id is required.'});
 const check=await requireSchoolRole(uid,schoolId,req.method==='POST'?['school_admin']:['school_admin','driver','parent']);
 if(check.error)return res.status(check.status).json({error:check.error});
 if(req.method==='GET'){
  if(check.membership.role==='driver'){
   const d=await db.query("SELECT id FROM drivers WHERE school_id=$1 AND user_id=$2 AND status='active'",[schoolId,uid]);
   if(!d.rows.length)return res.status(403).json({error:'Driver profile is not active for this school.'});
   const vehicles=await db.query("SELECT v.id,v.registration_number,v.label,v.capacity,v.status FROM vehicle_assignments a JOIN vehicles v ON v.id=a.vehicle_id AND v.school_id=a.school_id WHERE a.school_id=$1 AND a.driver_id=$2 AND a.valid_to IS NULL AND v.status='active' ORDER BY v.registration_number",[schoolId,d.rows[0].id]);
   const routes=await db.query("SELECT DISTINCT r.id,r.name,r.description,r.status FROM vehicle_assignments a JOIN routes r ON r.id=a.route_id AND r.school_id=a.school_id WHERE a.school_id=$1 AND a.driver_id=$2 AND a.valid_to IS NULL AND r.status='active' ORDER BY r.name",[schoolId,d.rows[0].id]);
   const students=await db.query("SELECT DISTINCT st.id,st.full_name,st.grade,st.student_code,r.name AS route_name FROM student_route_assignments a JOIN students st ON st.id=a.student_id AND st.school_id=a.school_id JOIN routes r ON r.id=a.route_id AND r.school_id=a.school_id JOIN vehicle_assignments va ON va.route_id=r.id AND va.school_id=r.school_id AND va.driver_id=$2 AND va.valid_to IS NULL WHERE a.school_id=$1 AND a.valid_to IS NULL AND st.status='active' ORDER BY st.full_name",[schoolId,d.rows[0].id]);
   const trips=await db.query("SELECT t.id,t.trip_type,t.status,t.started_at,t.ended_at,r.name AS route_name,v.registration_number FROM trips t LEFT JOIN routes r ON r.id=t.route_id LEFT JOIN vehicles v ON v.id=t.vehicle_id WHERE t.school_id=$1 AND t.driver_id=$2 ORDER BY t.created_at DESC LIMIT 30",[schoolId,d.rows[0].id]);
   return res.json({school_id:schoolId,role:check.membership.role,vehicles:vehicles.rows,routes:routes.rows,students:students.rows,trips:trips.rows,subscription:null});
  }
  if(check.membership.role==='parent'){
   const children=await db.query("SELECT st.id,st.full_name,st.grade,st.student_code FROM students st JOIN student_guardians sg ON sg.student_id=st.id JOIN guardians g ON g.id=sg.guardian_id WHERE st.school_id=$1 AND g.user_id=$2 AND g.school_id=$1 AND st.status='active' ORDER BY st.full_name",[schoolId,uid]);
   return res.json({school_id:schoolId,role:check.membership.role,students:children.rows});
  }
  const school=await db.query('SELECT id,name,slug,status,timezone FROM schools WHERE id=$1',[schoolId]);
  const vehicles=await db.query('SELECT id,registration_number,label,capacity,status FROM vehicles WHERE school_id=$1 ORDER BY id DESC LIMIT 200',[schoolId]);
  const routes=await db.query('SELECT id,name,description,status FROM routes WHERE school_id=$1 ORDER BY id DESC LIMIT 200',[schoolId]);
  const students=await db.query('SELECT id,student_code,full_name,grade,status FROM students WHERE school_id=$1 ORDER BY id DESC LIMIT 300',[schoolId]);
  const drivers=await db.query("SELECT d.id,d.user_id,COALESCE(up.email,'') AS email,COALESCE(up.full_name,'') AS full_name,d.status FROM drivers d LEFT JOIN user_profiles up ON up.user_id=d.user_id WHERE d.school_id=$1 ORDER BY d.id DESC LIMIT 200",[schoolId]);
  const trips=await db.query("SELECT t.id,t.trip_type,t.status,t.started_at,t.ended_at,r.name AS route_name,v.registration_number FROM trips t LEFT JOIN routes r ON r.id=t.route_id LEFT JOIN vehicles v ON v.id=t.vehicle_id WHERE t.school_id=$1 ORDER BY t.created_at DESC LIMIT 50",[schoolId]);
  const sub=await db.query("SELECT sub.id,sub.status,sub.billing_interval,sub.trial_ends_at,sub.current_period_end,sub.cancel_at_period_end,p.name AS plan_name,p.monthly_price_paise,p.annual_price_paise FROM subscriptions sub JOIN plans p ON p.id=sub.plan_id WHERE sub.school_id=$1 AND sub.status IN ('trialing','pending','active','past_due','suspended') LIMIT 1",[schoolId]);
  return res.json({school:school.rows[0],role:check.membership.role,vehicles:vehicles.rows,routes:routes.rows,students:students.rows,drivers:drivers.rows,trips:trips.rows,subscription:sub.rows[0]||null});
 }
 const type=String(req.body?.type||''), action=String(req.body?.action||'create');
 if(action!=='create')return res.status(400).json({error:'Only create is supported for this resource in this release.'});
 let r;
 if(type==='vehicle'){
  const registration=String(req.body?.registration_number||'').trim().toUpperCase().slice(0,30),label=String(req.body?.label||'').trim().slice(0,100),capacity=Math.max(0,Math.min(100,Number(req.body?.capacity)||0));
  if(!registration)return res.status(400).json({error:'Vehicle registration is required.'});
  r=await db.query('INSERT INTO vehicles (school_id,registration_number,label,capacity) VALUES ($1,$2,$3,$4) RETURNING id,registration_number,label,capacity,status',[schoolId,registration,label,capacity]);
 } else if(type==='route'){
  const name=String(req.body?.name||'').trim().slice(0,120),description=String(req.body?.description||'').trim().slice(0,500)||null;
  if(name.length<2)return res.status(400).json({error:'Route name is required.'});
  r=await db.query('INSERT INTO routes (school_id,name,description) VALUES ($1,$2,$3) RETURNING id,name,description,status',[schoolId,name,description]);
 } else if(type==='student'){
  const fullName=String(req.body?.full_name||'').trim().slice(0,120),grade=String(req.body?.grade||'').trim().slice(0,40)||null,code=String(req.body?.student_code||'').trim().slice(0,40)||null,routeId=Number(req.body?.route_id)||null;
  if(fullName.length<2)return res.status(400).json({error:'Student name is required.'});
  if(routeId){const route=await db.query("SELECT id FROM routes WHERE id=$1 AND school_id=$2 AND status='active'",[routeId,schoolId]);if(!route.rows.length)return res.status(400).json({error:'Selected route does not belong to this school.'});}
  r=await db.query('INSERT INTO students (school_id,full_name,grade,student_code) VALUES ($1,$2,$3,$4) RETURNING id,full_name,grade,student_code,status',[schoolId,fullName,grade,code]);
  if(routeId)await db.query('INSERT INTO student_route_assignments (school_id,student_id,route_id) VALUES ($1,$2,$3)',[schoolId,r.rows[0].id,routeId]);
 } else if(type==='assignment'){
  const vehicleId=Number(req.body?.vehicle_id),routeId=Number(req.body?.route_id),driverUserId=String(req.body?.driver_user_id||'');
  if(!Number.isInteger(vehicleId)||!Number.isInteger(routeId)||!driverUserId)return res.status(400).json({error:'Choose a vehicle, route and accepted driver.'});
  const v=await db.query("SELECT id FROM vehicles WHERE id=$1 AND school_id=$2 AND status='active'",[vehicleId,schoolId]);
  const route=await db.query("SELECT id FROM routes WHERE id=$1 AND school_id=$2 AND status='active'",[routeId,schoolId]);
  const driver=await db.query("SELECT id FROM drivers WHERE school_id=$1 AND user_id=$2 AND status='active'",[schoolId,driverUserId]);
  if(!v.rows.length||!route.rows.length||!driver.rows.length)return res.status(400).json({error:'Vehicle, route and accepted driver must all belong to this school.'});
  await db.query('UPDATE vehicle_assignments SET valid_to=CURRENT_DATE WHERE school_id=$1 AND vehicle_id=$2 AND valid_to IS NULL',[schoolId,vehicleId]);
  r=await db.query('INSERT INTO vehicle_assignments (school_id,vehicle_id,route_id,driver_id) VALUES ($1,$2,$3,$4) RETURNING id,vehicle_id,route_id,driver_id,valid_from',[schoolId,vehicleId,routeId,driver.rows[0].id]);
 } else return res.status(400).json({error:'Supported types are vehicle, route, student and assignment.'});
 await writeAudit({schoolId,actorUserId:uid,action:type+'.created',targetType:type,targetId:r.rows[0].id});
 return res.status(201).json({item:r.rows[0]});
}