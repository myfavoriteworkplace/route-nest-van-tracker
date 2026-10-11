import { db } from 'hatchable';

export async function isPlatformAdmin(userId) {
 const r = await db.query('SELECT user_id FROM platform_admins WHERE user_id = $1', [String(userId)]);
 return r.rows.length > 0;
}
export async function membershipsFor(userId) {
 const r = await db.query(`SELECT m.school_id,m.role,m.status,s.name AS school_name,s.slug AS school_slug,s.status AS school_status,sub.status AS subscription_status,sub.trial_ends_at,sub.current_period_end,sub.cancel_at_period_end,p.name AS plan_name FROM school_memberships m JOIN schools s ON s.id=m.school_id LEFT JOIN LATERAL (SELECT * FROM subscriptions x WHERE x.school_id=s.id ORDER BY x.updated_at DESC,x.id DESC LIMIT 1) sub ON true LEFT JOIN plans p ON p.id=sub.plan_id WHERE m.user_id=$1 AND m.status='active' ORDER BY m.created_at ASC`, [String(userId)]);
 return r.rows;
}
export async function writeAudit({schoolId=null,actorUserId,action,targetType,targetId=null,details={}}) {
 await db.query('INSERT INTO audit_logs (school_id,actor_user_id,action,target_type,target_id,details) VALUES ($1,$2,$3,$4,$5,$6::jsonb)',[schoolId,String(actorUserId),action,targetType,targetId===null?null:String(targetId),JSON.stringify(details)]);
}
export async function requireSchoolRole(userId,schoolId,roles=[]) {
 const r=await db.query(`SELECT m.school_id,m.role,m.status,s.status AS school_status,sub.status AS subscription_status,sub.trial_ends_at,sub.current_period_end FROM school_memberships m JOIN schools s ON s.id=m.school_id LEFT JOIN LATERAL (SELECT * FROM subscriptions x WHERE x.school_id=s.id ORDER BY x.updated_at DESC,x.id DESC LIMIT 1) sub ON true WHERE m.user_id=$1 AND m.school_id=$2 AND m.status='active' LIMIT 1`,[String(userId),Number(schoolId)]);
 const m=r.rows[0];
 if(!m) return {error:'You do not have access to this school.',status:403};
 if(m.school_status!=='active') return {error:'This school account is not active.',status:403};
 if(roles.length&&!roles.includes(m.role)) return {error:'Your role cannot perform this action.',status:403};
 if(['suspended','expired','cancelled'].includes(m.subscription_status)&&!(m.current_period_end&&new Date(m.current_period_end)>new Date())) return {error:'This school subscription is not active. Please review billing.',status:402};
 if(m.subscription_status==='trialing'&&m.trial_ends_at&&new Date(m.trial_ends_at)<new Date()) return {error:'The school trial has ended. Please review subscription billing.',status:402};
 return {membership:m};
}
export function slugify(value) { return String(value||'').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,48)||'school'; }