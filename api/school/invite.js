import { db } from 'hatchable';
import { requireSchoolRole, writeAudit } from '../../lib/tenant.js';
export const access='user'; export const methods=['POST','GET'];
export default async function(req,res){
 const uid=String(req.user.id),schoolId=Number(req.method==='GET'?req.query?.school_id:req.body?.school_id);
 if(!Number.isInteger(schoolId)||schoolId<1)return res.status(400).json({error:'school_id is required.'});
 const check=await requireSchoolRole(uid,schoolId,['school_admin']);if(check.error)return res.status(check.status).json({error:check.error});
 if(req.method==='GET'){
  const r=await db.query("SELECT id,email,role,student_id,status,created_at,accepted_at FROM school_invites WHERE school_id=$1 ORDER BY id DESC LIMIT 100",[schoolId]);
  return res.json({invites:r.rows});
 }
 const email=String(req.body?.email||'').trim().toLowerCase(),role=String(req.body?.role||''),studentId=Number(req.body?.student_id)||null;
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return res.status(400).json({error:'Enter a valid email address.'});
 if(!['driver','parent'].includes(role))return res.status(400).json({error:'Only driver and parent invitations are supported here.'});
 if(role==='parent'){
  if(!studentId)return res.status(400).json({error:'Choose the student this guardian is authorized to view.'});
  const student=await db.query("SELECT id FROM students WHERE id=$1 AND school_id=$2 AND status='active'",[studentId,schoolId]);
  if(!student.rows.length)return res.status(400).json({error:'Student does not belong to this school.'});
 }
 // The invite is bound to the verified email; membership is created after sign-in.
 const result=await db.query("INSERT INTO school_invites (school_id,email,role,student_id,invited_by) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (school_id,email,role) WHERE status='pending' DO UPDATE SET student_id=EXCLUDED.student_id,invited_by=EXCLUDED.invited_by RETURNING id,email,role,student_id,status,created_at",[schoolId,email,role,role==='parent'?studentId:null,uid]);
 await writeAudit({schoolId,actorUserId:uid,action:'school.invite_created',targetType:'school_invite',targetId:result.rows[0].id,details:{email,role,studentId:role==='parent'?studentId:null}});
 return res.status(201).json({invite:result.rows[0],message:'Invitation saved. The invited person must sign in with this exact email to join the school.'});
}