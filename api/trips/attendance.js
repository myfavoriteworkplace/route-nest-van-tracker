import { db } from 'hatchable';
import { requireSchoolRole, writeAudit } from '../../lib/tenant.js';
export const access='user'; export const methods=['POST'];
export default async function(req,res){
 const uid=String(req.user.id),schoolId=Number(req.body?.school_id),tripId=Number(req.body?.trip_id),studentId=Number(req.body?.student_id),eventType=String(req.body?.event_type||'');
 if(!Number.isInteger(schoolId)||schoolId<1||!Number.isInteger(tripId)||tripId<1||!Number.isInteger(studentId)||studentId<1||!['boarded','dropped_off','absent'].includes(eventType))return res.status(400).json({error:'School, trip, student and a valid attendance event are required.'});
 const check=await requireSchoolRole(uid,schoolId,['school_admin','driver']);if(check.error)return res.status(check.status).json({error:check.error});
 const trip=await db.query("SELECT id,route_id,driver_id,status FROM trips WHERE id=$1 AND school_id=$2",[tripId,schoolId]);if(!trip.rows.length)return res.status(404).json({error:'Trip not found.'});
 if(trip.rows[0].status!=='active')return res.status(409).json({error:'Attendance can only be changed during an active trip.'});
 const student=await db.query("SELECT st.id FROM students st JOIN student_route_assignments a ON a.student_id=st.id AND a.school_id=st.school_id AND a.valid_to IS NULL WHERE st.id=$1 AND st.school_id=$2 AND a.route_id=$3 AND st.status='active'",[studentId,schoolId,trip.rows[0].route_id]);if(!student.rows.length)return res.status(403).json({error:'Student is not assigned to this trip route.'});
 if(check.membership.role==='driver'){
  const d=await db.query("SELECT id FROM drivers WHERE school_id=$1 AND user_id=$2 AND status='active'",[schoolId,uid]);
  if(!d.rows.length||Number(trip.rows[0].driver_id)!==Number(d.rows[0].id))return res.status(403).json({error:'This trip is not assigned to you.'});
 }
 const r=await db.query('INSERT INTO attendance_records (school_id,trip_id,student_id,event_type,recorded_by) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (trip_id,student_id,event_type) DO UPDATE SET recorded_by=EXCLUDED.recorded_by,recorded_at=now() RETURNING id,trip_id,student_id,event_type,recorded_by,recorded_at',[schoolId,tripId,studentId,eventType,uid]);
 await writeAudit({schoolId,actorUserId:uid,action:'attendance.'+eventType,targetType:'attendance',targetId:r.rows[0].id,details:{tripId,studentId}});
 return res.json({attendance:r.rows[0]});
}