import "dotenv/config";
import express from "express";
import pg from "pg";
import helmet from "helmet";
import cors from "cors";
import rateLimit from "express-rate-limit";
import {timingSafeEqual} from "node:crypto";

const required=["DATABASE_URL","APP_ORIGIN","ADMIN_API_KEY"];
for(const k of required){if(!process.env[k])throw Error("Missing configuration: "+k)}
if(process.env.ADMIN_API_KEY.length<32)throw Error("ADMIN_API_KEY must have 32+ characters");
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:10,ssl:process.env.DATABASE_SSL==="true"?{rejectUnauthorized:true}:undefined});
const app=express();app.disable("x-powered-by");
app.use(helmet());app.use(cors({origin:process.env.APP_ORIGIN.split(",").map(s=>s.trim())}));
app.use(express.json({limit:"16kb"}));
app.use("/api",rateLimit({windowMs:15*60*1000,limit:120,standardHeaders:"draft-7",legacyHeaders:false}));
const uuid=s=>typeof s==="string"&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
const error=(res,status,message)=>res.status(status).json({error:message});
const auth=(req,res,next)=>{const supplied=(req.get("authorization")||"").replace(/^Bearer /i,"");const a=Buffer.from(supplied),b=Buffer.from(process.env.ADMIN_API_KEY);if(a.length!==b.length||!timingSafeEqual(a,b))return error(res,401,"Não autorizado");next()};
function phone(value){let n=String(value||"").replace(/\D/g,"");if(n.startsWith("55")&&(n.length===12||n.length===13))n=n.slice(2);return /^[1-9][1-9][0-9]{8,9}$/.test(n)?"+55"+n:null}
app.get("/api/health",async(req,res)=>{try{await pool.query("select 1");res.json({ok:true})}catch{res.status(503).json({ok:false})}});
app.get("/api/campaigns",async(req,res,next)=>{try{const r=await pool.query("select id,title,description,kind,number_count,regulation_url from campaigns where status='published' order by created_at desc limit 50");res.json({campaigns:r.rows})}catch(e){next(e)}});
app.get("/api/campaigns/:id",async(req,res,next)=>{if(!uuid(req.params.id))return error(res,400,"ID inválido");try{
const r=await pool.query("select id,title,description,kind,number_count,regulation_url from campaigns where id=$1 and status='published'",[req.params.id]);
if(!r.rowCount)return error(res,404,"Campanha indisponível");
const p=await pool.query("select id,label,specs,image_url,position from prizes where campaign_id=$1 order by position",[req.params.id]);res.json({...r.rows[0],prizes:p.rows})}catch(e){next(e)}});
app.get("/api/campaigns/:id/numbers",async(req,res,next)=>{if(!uuid(req.params.id))return error(res,400,"ID inválido");try{
const c=await pool.query("select number_count from campaigns where id=$1 and status='published'",[req.params.id]);if(!c.rowCount)return error(res,404,"Campanha indisponível");
const r=await pool.query("select number from entries where campaign_id=$1 order by number",[req.params.id]);res.json({total:c.rows[0].number_count,occupied:r.rows.map(x=>x.number)})}catch(e){next(e)}});
app.post("/api/campaigns/:id/entries",rateLimit({windowMs:3600000,limit:8,standardHeaders:"draft-7",legacyHeaders:false}),async(req,res,next)=>{
if(!uuid(req.params.id))return error(res,400,"ID inválido");
const {fullName,phone:rawPhone,socialNetwork,socialHandle,numbers,acceptedRegulation}=req.body||{};
const name=String(fullName||"").trim(),normalized=phone(rawPhone);
if(name.length<3||name.length>120||!normalized)return error(res,400,"Nome ou telefone inválido");
if(!Array.isArray(numbers)||numbers.length<1||numbers.length>10||!numbers.every(Number.isInteger)||new Set(numbers).size!==numbers.length)return error(res,400,"Selecione de 1 a 10 números distintos");
if(acceptedRegulation!==true)return error(res,400,"Aceite do regulamento obrigatório");
if(String(socialNetwork||"").length>40||String(socialHandle||"").length>80)return error(res,400,"Rede social inválida");
const client=await pool.connect();
try{
await client.query("BEGIN");
const c=await client.query("select number_count from campaigns where id=$1 and status='published' and kind in ('authorized_free_promotion','authorized_osc') and (starts_at is null or starts_at<=now()) and (ends_at is null or ends_at>=now()) for share",[req.params.id]);
if(!c.rowCount){await client.query("ROLLBACK");return error(res,409,"Campanha não habilitada para inscrição")}
if(numbers.some(n=>n<1||n>c.rows[0].number_count)){await client.query("ROLLBACK");return error(res,400,"Número inválido")}
const person=await client.query("insert into participants(full_name,phone_e164,social_network,social_handle) values($1,$2,$3,$4) on conflict(phone_e164) do update set full_name=excluded.full_name,social_network=excluded.social_network,social_handle=excluded.social_handle returning id",[name,normalized,String(socialNetwork||"").trim()||null,String(socialHandle||"").trim()||null]);
for(const n of numbers){const r=await client.query("insert into entries(campaign_id,participant_id,number) values($1,$2,$3) on conflict do nothing returning id",[req.params.id,person.rows[0].id,n]);if(!r.rowCount){await client.query("ROLLBACK");return error(res,409,"Número indisponível. Atualize a grade.")}}
await client.query("insert into audit_log(actor_id,action,entity_type,entity_id,details) values($1,$2,$3,$4,$5)",[person.rows[0].id,"entries.created","campaign",req.params.id,JSON.stringify({numbers})]);
await client.query("COMMIT");res.status(201).json({participantId:person.rows[0].id,numbers,paymentRequired:false});
}catch(e){await client.query("ROLLBACK").catch(()=>{});next(e)}finally{client.release()}
});
app.post("/api/admin/organizers",auth,async(req,res,next)=>{
const {ownerUserId,displayName}=req.body||{};
if(!uuid(ownerUserId)||typeof displayName!=="string"||displayName.trim().length<3||displayName.length>120)return error(res,400,"Dados inválidos");
try{const r=await pool.query("insert into organizers(owner_user_id,display_name) values($1,$2) returning id,display_name",[ownerUserId,displayName.trim()]);res.status(201).json(r.rows[0])}catch(e){next(e)}
});
app.post("/api/admin/campaigns",auth,async(req,res,next)=>{const {organizerId,title,description,kind,numberCount}=req.body||{};
if(!uuid(organizerId)||typeof title!=="string"||title.trim().length<4||title.length>150||!["demo","authorized_free_promotion","authorized_osc"].includes(kind)||!Number.isInteger(numberCount)||numberCount<1||numberCount>100000)return error(res,400,"Dados inválidos");
try{const r=await pool.query("insert into campaigns(organizer_id,title,description,kind,number_count) values($1,$2,$3,$4,$5) returning id,status",[organizerId,title.trim(),String(description||"").slice(0,4000),kind,numberCount]);res.status(201).json(r.rows[0])}catch(e){next(e)}});
app.use((err,req,res,next)=>{console.error("API error",err.code||err.message);res.status(500).json({error:"Erro interno"})});
const port=Number(process.env.PORT||3000);app.listen(port,()=>console.log("API running on port "+port));
process.on("SIGTERM",async()=>{await pool.end();process.exit(0)});
