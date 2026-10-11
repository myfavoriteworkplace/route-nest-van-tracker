import { db } from 'hatchable';
import { requireSchoolRole, writeAudit } from '../../lib/tenant.js';
export const access='user'; export const methods=['POST'];
export default async function(req,res){
 const uid=String(req.user.id),schoolId=Number(req.body?.school_id),action=String(req.body?.action||'');
 if(!Number.isInteger(schoolId)||schoolId<1)return res.status(400).json({error:'school_id is required.'});
 const check=await requireSchoolRole(uid,schoolId,['school_admin','driver']);if(check.error)return res.status(check.status).json({error:check.error});
 if(action==='start'){
  const routeId=Number(req.body?.route_id)||null,vehicleId=Number(req.body?.vehicle_id)||null,tripType=String(req.body?.trip_type||'pickup');
  if(!['pickup','dropoff'].includes(tripType))return res.status(400).json({error:'Invalid trip type.'});
  if(check.membership.role==='driver'){
   const assigned=await db.query("SELECT id FROM drivers WHERE school_id=$1 AND user_id=$2 AND status='active'",[schoolId,uid]);
   if(!assigned.rows.length)return res.status(403).json({error:'Driver profile is not active for this school.'});
  }
  if(routeId){const r=await db.query("SELECT id FROM routes WHERE id=$1 AND school_id=$2 AND status='active'",[routeId,schoolId]);if(!r.rows.length)return res.status(400).json({error:'Route does not belong to this school or is inactive.'});}
  if(vehicleId){const v=await db.query("SELECT id FROM vehicles WHERE id=$1 AND school_id=$2 AND status='active'",[vehicleId,schoolId]);if(!v.rows.length)return res.status(400).json({error:'Vehicle does not belong to this school or is inactive.'});}
  const driver=check.membership.role==='driver'?await db.query('SELECT id FROM drivers WHERE school_id=$1 AND user_id=$2',[schoolId,uid]):{rows:[]};
  const r=await db.query("INSERT INTO trips (school_id,route_id,vehicle_id,driver_id,trip_type,status,started_at) VALUES ($1,$2,$3,$4,$5,'active',now()) RETURNING id,school_id,route_id,vehicle_id,driver_id,trip_type,status,started_at",[schoolId,routeId,vehicleId,driver.rows[0]?.id||null,tripType]);
  await writeAudit({schoolId,actorUserId:uid,action:'trip.started',targetType:'trip',targetId:r.rows[0].id});return res.status(201).json({trip:r.rows[0]});
 }
 const tripId=Number(req.body?.trip_id);if(!Number.isInteger(tripId)||tripId<1)return res.status(400).json({error:'trip_id is required.'});
 const t=await db.query('SELECT id,driver_id,status FROM trips WHERE id=$1 AND school_id=$2',[tripId,schoolId]);if(!t.rows.length)return res.status(404).json({error:'Trip not found.'});
 if(check.membership.role==='driver'){
  const d=await db.query("SELECT id FROM drivers WHERE school_id=$1 AND user_id=$2 AND status='active'",[schoolId,uid]);
  if(!d.rows.length||Number(t.rows[0].driver_id)!==Number(d.rows[0].id))return res.status(403).json({error:'This trip is not assigned to you.'});
 }
 if(action==='end'){
  if(t.rows[0].status!=='active')return res.status(409).json({error:'Only active trips can be ended.'});
  await db.query("UPDATE trips SET status='completed',ended_at=now() WHERE id=$1 AND school_id=$2",[tripId,schoolId]);
  await db.query('DELETE FROM current_trip_locations WHERE trip_id=$1',[tripId]);
  await writeAudit({schoolId,actorUserId:uid,action:'trip.ended',targetType:'trip',targetId:tripId});return res.json({ok:true,status:'completed'});
 }
 return res.status(400).json({error:'Supported actions are start and end.'});
}