import { db } from 'hatchable';
import { isPlatformAdmin, membershipsFor } from '../lib/tenant.js';
export const access='user';
export const methods=['GET','PUT'];
export default async function(req,res){
 const userId=String(req.user.id), email=String(req.user.email||'').trim().toLowerCase();
 if(req.method==='GET'){
  if(email){
   const invites=await db.query("SELECT id,school_id,role,student_id FROM school_invites WHERE lower(email)=$1 AND status='pending' ORDER BY id ASC LIMIT 25",[email]);
   for(const inv of invites.rows){
    const statements=[
     {sql:"INSERT INTO school_memberships (school_id,user_id,role,status) VALUES ($1,$2,$3,'active') ON CONFLICT (school_id,user_id) DO NOTHING",params:[inv.school_id,userId,inv.role]},
     {sql:"UPDATE school_invites SET status='accepted',accepted_at=now() WHERE id=$1 AND status='pending'",params:[inv.id]}
    ];
    if(inv.role==='driver')statements.splice(1,0,{sql:"INSERT INTO drivers (school_id,user_id,status) VALUES ($1,$2,'active') ON CONFLICT (school_id,user_id) DO NOTHING",params:[inv.school_id,userId]});
    if(inv.role==='parent'&&inv.student_id){
     statements.splice(1,0,{sql:"INSERT INTO guardians (school_id,user_id,relationship) VALUES ($1,$2,'guardian') ON CONFLICT (school_id,user_id) DO NOTHING",params:[inv.school_id,userId]});
     statements.splice(2,0,{sql:"INSERT INTO student_guardians (student_id,guardian_id) SELECT $1,id FROM guardians WHERE school_id=$2 AND user_id=$3 ON CONFLICT DO NOTHING",params:[inv.student_id,inv.school_id,userId]});
    }
    await db.transaction(statements);
   }
  }
  const p=await db.query('SELECT user_id,full_name,phone,status FROM user_profiles WHERE user_id=$1',[userId]);
  return res.json({user:{id:userId,email,...(p.rows[0]||{})},isPlatformAdmin:await isPlatformAdmin(userId),memberships:await membershipsFor(userId)});
 }
 const fullName=String(req.body?.full_name||'').trim().slice(0,120),phone=String(req.body?.phone||'').trim().slice(0,30)||null;
 await db.query("INSERT INTO user_profiles (user_id,full_name,phone) VALUES ($1,$2,$3) ON CONFLICT (user_id) DO UPDATE SET full_name=EXCLUDED.full_name,phone=EXCLUDED.phone,updated_at=now()",[userId,fullName,phone]);
 return res.json({ok:true});
}