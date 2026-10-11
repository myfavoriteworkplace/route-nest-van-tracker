import { db, config } from 'hatchable';
import { writeAudit } from '../../lib/tenant.js';
export const access='user';
export const methods=['POST'];
export default async function(req,res){
 const userId=String(req.user.id), supplied=String(req.body?.bootstrap_key||'');
 if(!supplied)return res.status(400).json({error:'Bootstrap key is required.'});
 const expected=await config.get('PLATFORM_BOOTSTRAP_KEY');
 if(!expected||supplied.length<16||supplied!==expected)return res.status(403).json({error:'Bootstrap key is invalid or not configured.'});
 const existing=await db.query('SELECT user_id FROM platform_admins LIMIT 1');
 if(existing.rows.length)return res.status(409).json({error:'A platform Super Admin has already been configured. Ask an existing platform administrator.'});
 await db.query('INSERT INTO platform_admins (user_id,created_by) VALUES ($1,$1) ON CONFLICT DO NOTHING',[userId]);
 await writeAudit({actorUserId:userId,action:'platform.super_admin_bootstrapped',targetType:'platform_admin',targetId:userId});
 return res.json({ok:true,message:'This account is now the initial platform Super Admin.'});
}