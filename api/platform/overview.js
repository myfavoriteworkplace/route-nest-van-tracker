import { db } from 'hatchable';
import { isPlatformAdmin } from '../../lib/tenant.js';
export const access='user'; export const methods=['GET'];
export default async function(req,res){
 const uid=String(req.user.id); if(!(await isPlatformAdmin(uid)))return res.status(403).json({error:'Platform Super Admin access required.'});
 const r=await db.query("SELECT (SELECT count(*) FROM schools) AS total_schools,(SELECT count(*) FROM schools WHERE status='active') AS active_schools,(SELECT count(*) FROM subscriptions WHERE status='trialing' AND trial_ends_at>now()) AS trials,(SELECT count(*) FROM subscriptions WHERE status='active') AS active_subscriptions,(SELECT count(*) FROM subscriptions WHERE status='past_due') AS past_due,(SELECT COALESCE(sum(CASE WHEN billing_interval='monthly' THEN p.monthly_price_paise ELSE p.annual_price_paise/12 END),0) FROM subscriptions s JOIN plans p ON p.id=s.plan_id WHERE s.status='active') AS mrr_paise,(SELECT count(*) FROM webhook_events WHERE status='failed') AS failed_webhooks");
 const schools=await db.query("SELECT s.id,s.name,s.slug,s.contact_email,s.status,s.created_at,sub.status AS subscription_status,sub.trial_ends_at,sub.current_period_end,p.name AS plan_name FROM schools s LEFT JOIN subscriptions sub ON sub.school_id=s.id AND sub.status IN ('trialing','pending','active','past_due','suspended') LEFT JOIN plans p ON p.id=sub.plan_id ORDER BY s.created_at DESC LIMIT 100");
 const events=await db.query('SELECT id,action,target_type,target_id,actor_user_id,created_at FROM audit_logs ORDER BY created_at DESC LIMIT 20');
 return res.json({metrics:r.rows[0],schools:schools.rows,recent_activity:events.rows});
}