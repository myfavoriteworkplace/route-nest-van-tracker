import { db } from 'hatchable';
import { requireSchoolRole } from '../../lib/tenant.js';
export const access='user'; export const methods=['POST'];
export default async function(req,res){
 const uid=String(req.user.id),schoolId=Number(req.body?.school_id),tripId=Number(req.body?.trip_id),lat=Number(req.body?.latitude),lon=Number(req.body?.longitude),accuracy=Number(req.body?.accuracy_m)||null;
 if(!Number.isInteger(schoolId)||schoolId<1||!Number.isInteger(tripId)||tripId<1||!Number.isFinite(lat)||!Number.isFinite(lon)||lat < -90||lat>90||lon < -180||lon>180)return res.status(400).json({error:'Valid school, trip and coordinates are required.'});
 const check=await requireSchoolRole(uid,schoolId,['driver']);if(check.error)return res.status(check.status).json({error:check.error});
 const d=await db.query("SELECT id FROM drivers WHERE school_id=$1 AND user_id=$2 AND status='active'",[schoolId,uid]);if(!d.rows.length)return res.status(403).json({error:'Driver profile is not active for this school.'});
 const t=await db.query("SELECT id FROM trips WHERE id=$1 AND school_id=$2 AND driver_id=$3 AND status='active'",[tripId,schoolId,d.rows[0].id]);if(!t.rows.length)return res.status(403).json({error:'Location can only be sent for your own active trip.'});
 const recordedAt=new Date().toISOString();
 await db.query('INSERT INTO current_trip_locations (trip_id,school_id,latitude,longitude,accuracy_m,recorded_at) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (trip_id) DO UPDATE SET latitude=EXCLUDED.latitude,longitude=EXCLUDED.longitude,accuracy_m=EXCLUDED.accuracy_m,recorded_at=EXCLUDED.recorded_at',[tripId,schoolId,lat,lon,accuracy,recordedAt]);
 await db.query('INSERT INTO trip_locations (trip_id,school_id,latitude,longitude,accuracy_m,recorded_at) VALUES ($1,$2,$3,$4,$5,$6)',[tripId,schoolId,lat,lon,accuracy,recordedAt]);
 return res.json({ok:true,recorded_at:recordedAt});
}