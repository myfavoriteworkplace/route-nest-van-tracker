import { db } from 'hatchable';
import { requireSchoolRole } from '../../lib/tenant.js';
export const access='user'; export const methods=['GET'];
export default async function(req,res){
 const uid=String(req.user.id),schoolId=Number(req.query?.school_id),studentId=Number(req.query?.student_id);
 if(!Number.isInteger(schoolId)||schoolId<1||!Number.isInteger(studentId)||studentId<1)return res.status(400).json({error:'school_id and student_id are required.'});
 const check=await requireSchoolRole(uid,schoolId,['parent']);if(check.error)return res.status(check.status).json({error:check.error});
 const r=await db.query("SELECT t.id AS trip_id,t.status,t.started_at,ctl.latitude,ctl.longitude,ctl.accuracy_m,ctl.recorded_at FROM students st JOIN student_guardians sg ON sg.student_id=st.id JOIN guardians g ON g.id=sg.guardian_id JOIN student_route_assignments sra ON sra.student_id=st.id AND sra.school_id=st.school_id AND sra.valid_to IS NULL JOIN trips t ON t.route_id=sra.route_id AND t.school_id=st.school_id AND t.status='active' LEFT JOIN current_trip_locations ctl ON ctl.trip_id=t.id WHERE st.id=$1 AND st.school_id=$2 AND g.user_id=$3 AND g.school_id=$2 ORDER BY t.started_at DESC LIMIT 1",[studentId,schoolId,uid]);
 if(!r.rows.length)return res.status(404).json({error:'No active trip is available for this child.'});
 const row=r.rows[0];return res.json({trip_id:row.trip_id,status:row.status,location:row.latitude==null?null:{latitude:row.latitude,longitude:row.longitude,accuracy_m:row.accuracy_m,recorded_at:row.recorded_at,is_stale:!row.recorded_at||(Date.now()-new Date(row.recorded_at).getTime()>60000)}});
}