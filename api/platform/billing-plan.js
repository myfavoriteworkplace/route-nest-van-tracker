import { db } from 'hatchable';
import { isPlatformAdmin, writeAudit } from '../../lib/tenant.js';
export const access='user'; export const methods=['POST'];
export default async function(req,res){
 const uid=String(req.user.id);if(!(await isPlatformAdmin(uid)))return res.status(403).json({error:'Platform Super Admin access required.'});
 const providerPlanId=String(req.body?.provider_plan_id||'').trim().slice(0,100),annualPlanId=String(req.body?.provider_annual_plan_id||'').trim().slice(0,100),monthly=Number(req.body?.monthly_price_paise),annual=Number(req.body?.annual_price_paise);
 if(!providerPlanId)return res.status(400).json({error:'Razorpay Plan ID is required.'});
 if(!Number.isInteger(monthly)||monthly<0||!Number.isInteger(annual)||annual<0)return res.status(400).json({error:'Prices must be non-negative integer paise values.'});
 const r=await db.query("UPDATE plans SET provider_plan_id=$1,provider_annual_plan_id=$2,monthly_price_paise=$3,annual_price_paise=$4 WHERE code='school-standard' RETURNING id,code,name,provider_plan_id,provider_annual_plan_id,monthly_price_paise,annual_price_paise",[providerPlanId,annualPlanId||null,monthly,annual]);
 if(!r.rows.length)return res.status(404).json({error:'School Standard plan not found.'});
 await writeAudit({actorUserId:uid,action:'billing.plan_configured',targetType:'plan',targetId:r.rows[0].id,details:{provider_plan_id:providerPlanId,monthly_price_paise:monthly,annual_price_paise:annual}});
 return res.json({plan:r.rows[0]});
}