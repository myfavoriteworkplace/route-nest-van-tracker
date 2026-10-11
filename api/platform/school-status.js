import { db } from 'hatchable';
import { isPlatformAdmin, writeAudit } from '../../lib/tenant.js';
export const access='user'; export const methods=['POST'];
export default async function(req,res){
 const uid=String(req.user.id); if(!(await isPlatformAdmin(uid)))return res.status(403).json({error:'Platform Super Admin access required.'});
 const schoolId=Number(req.body?.school_id), status=String(req.body?.status||''), reason=String(req.body?.reason||'').trim().slice(0,500);
 if(!Number.isInteger(schoolId)||schoolId<1||!['active','suspended','archived'].includes(status))return res.status(400).json({error:'Valid school_id and status are required.'});
 const r=await db.query('UPDATE schools SET status=$1,updated_at=now() WHERE id=$2 RETURNING id,name,status',[status,schoolId]);
 if(!r.rows.length)return res.status(404).json({error:'School not found.'});
 await writeAudit({schoolId,actorUserId:uid,action:'school.status_changed',targetType:'school',targetId:schoolId,details:{status,reason}});
 return res.json({school:r.rows[0]});
}