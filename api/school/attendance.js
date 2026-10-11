import { db } from 'hatchable';
import { requireSchoolRole } from '../../lib/tenant.js';
export const access='user'; export const methods=['GET'];
export default async function(req,res){
 const uid=String(req.user.id),schoolId=Number(req.query?.school_id);
 if(!Number.isInteger(schoolId)||schoolId<1)return res.status(400).json({error:'school_id is required.'});
 const check=await requireSchoolRole(uid,schoolId,['school_admin']);if(check.error)return res.status(check.status).json({error:check.error});
 const r=await db.query("SELECT ar.id,ar.trip_id,ar.student_id,ar.event_type,ar.recorded_by,ar.recorded_at,st.full_name AS student_name,st.grade,t.trip_type,t.started_at,r.name AS route_name FROM attendance_records ar JOIN students st ON st.id=ar.student_id AND st.school_id=ar.school_id JOIN trips t ON t.id=ar.trip_id AND t.school_id=ar.school_id LEFT JOIN routes r ON r.id=t.route_id WHERE ar.school_id=$1 ORDER BY ar.recorded_at DESC LIMIT 300",[schoolId]);
 return res.json({records:r.rows});
}