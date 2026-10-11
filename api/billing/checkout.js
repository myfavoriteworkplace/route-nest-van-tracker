import { db, config } from 'hatchable';
import { requireSchoolRole, writeAudit } from '../../lib/tenant.js';
export const access='user'; export const methods=['POST'];
export default async function(req,res){
 const uid=String(req.user.id), schoolId=Number(req.body?.school_id), interval=String(req.body?.interval||'monthly');
 if(!Number.isInteger(schoolId)||schoolId<1||!['monthly','annual'].includes(interval))return res.status(400).json({error:'A valid school_id and billing interval are required.'});
 const check=await requireSchoolRole(uid,schoolId,['school_admin']); if(check.error)return res.status(check.status).json({error:check.error});
 const existing=await db.query("SELECT id,status,provider_subscription_id FROM subscriptions WHERE school_id=$1 AND status IN ('pending','active','past_due','trialing') ORDER BY id DESC LIMIT 1",[schoolId]);
 if(existing.rows[0]?.status==='active')return res.status(409).json({error:'This school already has an active subscription.'});
 const p=await db.query("SELECT id,name,monthly_price_paise,annual_price_paise,provider_plan_id,provider_annual_plan_id FROM plans WHERE code='school-standard' AND active=true LIMIT 1");
 const providerPlanId=interval==='annual'?p.rows[0]?.provider_annual_plan_id:p.rows[0]?.provider_plan_id;
 if(!p.rows.length||!providerPlanId)return res.status(503).json({error:'Billing is not configured yet. The platform owner must create the matching monthly or annual recurring plan in Razorpay and save its Plan ID.'});
 const keyId=await config.get('RAZORPAY_KEY_ID'), keySecret=await config.get('RAZORPAY_KEY_SECRET');
 if(!keyId||!keySecret)return res.status(503).json({error:'Razorpay credentials are not configured in Hatchable Setup.'});
 const prior=existing.rows[0];
 if(prior?.provider_subscription_id)return res.status(409).json({error:'A Razorpay subscription is already pending. Complete that checkout or reconcile it before creating another.'});
 const response=await fetch('https://api.razorpay.com/v1/subscriptions',{method:'POST',headers:{Authorization:'Basic '+btoa(keyId+':'+keySecret),'Content-Type':'application/json'},body:JSON.stringify({plan_id:providerPlanId,total_count:interval==='annual'?10:120,customer_notify:1,quantity:1,notes:{school_id:String(schoolId),created_by:uid,billing_interval:interval}})});
 const data=await response.json();
 if(!response.ok)return res.status(502).json({error:'Razorpay could not create the subscription. Check the provider plan and merchant account.',provider_error:data?.error?.description||null});
 if(prior)await db.query("UPDATE subscriptions SET status='pending',provider_subscription_id=$1,billing_interval=$2,updated_at=now() WHERE id=$3",[data.id,interval,prior.id]);
 else await db.query("INSERT INTO subscriptions (school_id,plan_id,status,provider_subscription_id,billing_interval) VALUES ($1,$2,'pending',$3,$4)",[schoolId,p.rows[0].id,data.id,interval]);
 await writeAudit({schoolId,actorUserId:uid,action:'subscription.checkout_created',targetType:'subscription',targetId:data.id,details:{interval}});
 return res.status(201).json({subscription_id:data.id,short_url:data.short_url||null,checkout_url:data.short_url||null,status:data.status,plan:p.rows[0].name,amount_paise:interval==='monthly'?p.rows[0].monthly_price_paise:p.rows[0].annual_price_paise,customer_id:data.customer_id||null});
}