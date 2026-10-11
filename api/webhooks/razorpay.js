import { db, config, webhooks } from 'hatchable';
export const access='public'; export const methods=['POST'];
export default async function(req,res){
 const signature=req.headers['x-razorpay-signature'];
 const secret=await config.get('RAZORPAY_WEBHOOK_SECRET');
 if(!secret||!signature||!req.rawBody)return res.status(400).json({error:'Webhook verification is not configured.'});
 let verified=false; try{verified=await webhooks.verifyHmac({raw:req.rawBody,signature,secret,algorithm:'sha256',encoding:'hex',tolerance:0});}catch(e){verified=false;}
 if(!verified)return res.status(401).json({error:'Invalid webhook signature.'});
 let event; try{event=typeof req.body==='object'&&req.body?req.body:JSON.parse(req.rawBody);}catch(e){return res.status(400).json({error:'Invalid JSON payload.'});}
 const eventId=String(req.headers['x-razorpay-event-id']||''); const eventType=String(event.event||'');
 if(!eventId||!eventType)return res.status(400).json({error:'Missing event identifier or type.'});
 const inserted=await db.query("INSERT INTO webhook_events (provider_event_id,event_type,status) VALUES ($1,$2,'received') ON CONFLICT (provider_event_id) DO NOTHING RETURNING id",[eventId,eventType]);
 if(!inserted.rows.length){const old=await db.query('SELECT status FROM webhook_events WHERE provider_event_id=$1',[eventId]);if(old.rows[0]?.status!=='failed')return res.json({received:true,duplicate:true});await db.query("UPDATE webhook_events SET status='received',error_summary=NULL WHERE provider_event_id=$1",[eventId]);}
 try{
  const entity=event.payload?.subscription?.entity||{}, payment=event.payload?.payment?.entity||{};
  const subscriptionId=String(entity.id||payment.subscription_id||'');
  const notes=entity.notes||{}, schoolNote=Number(notes.school_id)||null;
  let sub=subscriptionId?await db.query('SELECT id,school_id,status FROM subscriptions WHERE provider_subscription_id=$1',[subscriptionId]):{rows:[]};
  let schoolId=sub.rows[0]?.school_id||schoolNote;
  const mapping={'subscription.activated':'active','subscription.charged':'active','subscription.authenticated':'active','subscription.pending':'pending','subscription.halted':'past_due','subscription.paused':'past_due','subscription.cancelled':'cancelled','subscription.completed':'expired','payment.failed':'past_due'};
  const newStatus=mapping[eventType];
  if(sub.rows[0]&&newStatus){
   const start=entity.current_start?new Date(entity.current_start*1000).toISOString():null;
   const end=entity.current_end?new Date(entity.current_end*1000).toISOString():null;
   await db.query('UPDATE subscriptions SET status=$1,current_period_start=COALESCE($2,current_period_start),current_period_end=COALESCE($3,current_period_end),updated_at=now() WHERE id=$4',[newStatus,start,end,sub.rows[0].id]);
  }
  if(payment.id){
   const amount=Math.max(0,Number(payment.amount)||0), paidAt=payment.created_at?new Date(Number(payment.created_at)*1000).toISOString():null;
   await db.query("INSERT INTO payment_events (school_id,subscription_id,provider_payment_id,provider_event_id,amount_paise,currency,status,paid_at,raw_summary) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb) ON CONFLICT (provider_payment_id) DO UPDATE SET status=EXCLUDED.status,provider_event_id=EXCLUDED.provider_event_id,raw_summary=EXCLUDED.raw_summary",[schoolId,sub.rows[0]?.id||null,String(payment.id),eventId,amount,String(payment.currency||'INR'),String(payment.status||eventType),paidAt,JSON.stringify({event:eventType,invoice_id:payment.invoice_id||null})]);
  }
  await db.query("UPDATE webhook_events SET status='processed',processed_at=now() WHERE provider_event_id=$1",[eventId]);
  return res.json({received:true,processed:true});
 }catch(error){
  await db.query("UPDATE webhook_events SET status='failed',error_summary=$2 WHERE provider_event_id=$1",[eventId,String(error?.message||'Processing error').slice(0,500)]);
  console.error('Razorpay webhook processing failed',eventId,error?.message);
  return res.status(500).json({error:'Webhook processing failed; retry is safe.'});
 }
}