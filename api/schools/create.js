import { db } from 'hatchable';
import { slugify, writeAudit } from '../../lib/tenant.js';
export const access='user';
export const methods=['POST'];
export default async function(req,res){
 const userId=String(req.user.id), name=String(req.body?.name||'').trim().slice(0,160), email=String(req.body?.contact_email||req.user.email||'').trim().toLowerCase().slice(0,254), phone=String(req.body?.phone||'').trim().slice(0,30)||null, fullName=String(req.body?.admin_name||'').trim().slice(0,120);
 if(name.length<2)return res.status(400).json({error:'Enter a school name.'});
 if(!email||!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email))return res.status(400).json({error:'Enter a valid school contact email.'});
 const existing=await db.query("SELECT school_id FROM school_memberships WHERE user_id=$1 AND role='school_admin' AND status='active'",[userId]);
 if(existing.rows.length)return res.status(409).json({error:'This account already administers a school. Contact support to manage additional schools.'});
 let slug=slugify(name); const collision=await db.query('SELECT id FROM schools WHERE slug=$1',[slug]); if(collision.rows.length)slug=slug+'-'+Math.random().toString(36).slice(2,7);
 const plan=await db.query("SELECT id,trial_days FROM plans WHERE code='school-standard' AND active=true LIMIT 1");
 if(!plan.rows.length)return res.status(500).json({error:'No active subscription plan is configured.'});
 const trialEnds=new Date(Date.now()+Number(plan.rows[0].trial_days||14)*86400000).toISOString();
 const tx=await db.transaction([
  {sql:'INSERT INTO schools (name,slug,contact_email,phone) VALUES ($1,$2,$3,$4) RETURNING id,name,slug,status,created_at',params:[name,slug,email,phone]},
  {sql:"INSERT INTO user_profiles (user_id,full_name,phone) VALUES ($1,$2,$3) ON CONFLICT (user_id) DO UPDATE SET full_name=CASE WHEN EXCLUDED.full_name<>'' THEN EXCLUDED.full_name ELSE user_profiles.full_name END,phone=COALESCE(EXCLUDED.phone,user_profiles.phone),updated_at=now()",params:[userId,fullName,phone]},
  {sql:"INSERT INTO school_memberships (school_id,user_id,role,status) SELECT id,$1,'school_admin','active' FROM schools WHERE slug=$2",params:[userId,slug]},
  {sql:"INSERT INTO subscriptions (school_id,plan_id,status,trial_ends_at,billing_interval) SELECT id,$1,'trialing',$2,'monthly' FROM schools WHERE slug=$3",params:[plan.rows[0].id,trialEnds,slug]}
 ]);
 const school=tx.results[0].rows[0];
 await writeAudit({schoolId:school.id,actorUserId:userId,action:'school.created',targetType:'school',targetId:school.id,details:{slug}});
 return res.status(201).json({school,trial_ends_at:trialEnds,message:'School workspace created. Trial access is enabled; connect billing before the trial ends.'});
}