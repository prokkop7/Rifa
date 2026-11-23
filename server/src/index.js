import "dotenv/config";
import express from "express";
import pg from "pg";
import {verifyAsaasConnection,verifyAsaasWebhookToken,createCommercialCheckout} from "./asaas.js";
import helmet from "helmet";
import cors from "cors";
import rateLimit from "express-rate-limit";
import {timingSafeEqual,randomBytes,createHash,randomUUID,scrypt as scryptCallback} from "node:crypto";
import {promisify} from "node:util";
import {fileURLToPath} from "node:url";
import {getAsaasSettings,saveAsaasSettings,deleteAsaasSettings,validateAsaasSandboxSettings} from "./asaas-settings.js";
const scrypt=promisify(scryptCallback);

const required=["DATABASE_URL","APP_ORIGIN","ADMIN_API_KEY"];
for(const k of required){if(!process.env[k])throw Error("Missing configuration: "+k)}
if(process.env.ADMIN_API_KEY.length<32)throw Error("ADMIN_API_KEY must have 32+ characters");
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:10,ssl:process.env.DATABASE_SSL==="true"?{rejectUnauthorized:true}:undefined});
const app=express();app.disable("x-powered-by");
// Only trust X-Forwarded-* headers from the loopback HTTPS tunnel connector.
app.set("trust proxy",1); // One trusted hop: private Docker gateway to the AÇÕES-only loopback port
app.use(helmet());app.use(cors({origin:process.env.APP_ORIGIN.split(",").map(s=>s.trim())}));
app.use(express.json({limit:"16kb"}));
app.use("/api",rateLimit({windowMs:15*60*1000,limit:120,standardHeaders:"draft-7",legacyHeaders:false}));
const uuid=s=>typeof s==="string"&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
const error=(res,status,message)=>res.status(status).json({error:message});
const auth=(req,res,next)=>{const supplied=(req.get("authorization")||"").replace(/^Bearer /i,"");const a=Buffer.from(supplied),b=Buffer.from(process.env.ADMIN_API_KEY);if(a.length!==b.length||!timingSafeEqual(a,b))return error(res,401,"Não autorizado");next()};
function phone(value){let n=String(value||"").replace(/\D/g,"");if(n.startsWith("55")&&(n.length===12||n.length===13))n=n.slice(2);return /^[1-9][1-9][0-9]{8,9}$/.test(n)?"+55"+n:null}

const digest=token=>createHash("sha256").update(token).digest("hex");
async function makePassword(password) {
 const salt=randomBytes(24).toString("hex");
 const hash=(await scrypt(password,salt,64)).toString("hex");
 return {salt,hash};
}
async function checkPassword(password,salt,expected){
 const hash=(await scrypt(password,salt,64)).toString("hex");
 return timingSafeEqual(Buffer.from(hash,"hex"),Buffer.from(expected,"hex"));
}
async function requireParticipant(req,res,next){
 const token=(req.get("authorization")||"").replace(/^Bearer /i,"");
 if(!/^[a-f0-9]{64}$/.test(token))return error(res,401,"Faça login");
 try {
  const q=await pool.query("select s.id as session_id,p.id as participant_id,p.full_name,p.phone_e164 from participant_sessions s join participant_accounts a on a.id=s.account_id join participants p on p.id=a.participant_id where s.token_hash=$1 and s.revoked_at is null and s.expires_at>now()",[digest(token)]);
  if(!q.rowCount)return error(res,401,"Sessão expirada");
  req.participant=q.rows[0];
  next();
 }catch(err){next(err)}
}
const loginLimiter=rateLimit({windowMs:15*60*1000,limit:8,standardHeaders:"draft-7",legacyHeaders:false});
app.post("/api/auth/register",loginLimiter,async(req,res,next)=>{
 const name=String(req.body?.fullName||"").trim(),normalized=phone(req.body?.phone);
 const password=req.body?.password;
 if(name.length<3||name.length>120||!normalized||typeof password!=="string"||password.length<12||password.length>128)return error(res,400,"Informe nome, telefone e senha de 12 a 128 caracteres");
 const client=await pool.connect();
 try{
  const {salt,hash}=await makePassword(password);
  await client.query("BEGIN");
  const p=await client.query("insert into participants(full_name,phone_e164) values($1,$2) on conflict(phone_e164) do nothing returning id",[name,normalized]);
  if(!p.rowCount){await client.query("ROLLBACK");return error(res,409,"Telefone já cadastrado; não é possível reivindicar cadastro antigo sem verificação de identidade")}
  await client.query("insert into participant_accounts(participant_id,password_salt,password_hash) values($1,$2,$3)",[p.rows[0].id,salt,hash]);
  await client.query("COMMIT");
  res.status(201).json({created:true,message:"Conta criada. Número de telefone ainda não verificado."});
 }catch(err){await client.query("ROLLBACK").catch(()=>{});next(err)}finally{client.release()}
});
app.post("/api/auth/login",loginLimiter,async(req,res,next)=>{
 const normalized=phone(req.body?.phone),password=req.body?.password;
 if(!normalized||typeof password!=="string"||password.length>128)return error(res,401,"Credenciais inválidas");
 try{
  const q=await pool.query("select a.id,a.password_salt,a.password_hash from participant_accounts a join participants p on p.id=a.participant_id where p.phone_e164=$1",[normalized]);
  if(!q.rowCount)return error(res,401,"Credenciais inválidas");
  if(!await checkPassword(password,q.rows[0].password_salt,q.rows[0].password_hash))return error(res,401,"Credenciais inválidas");
  const token=randomBytes(32).toString("hex");
  await pool.query("insert into participant_sessions(account_id,token_hash,expires_at) values($1,$2,now()+interval '7 days')",[q.rows[0].id,digest(token)]);
  res.json({accessToken:token,expiresInSeconds:604800});
 }catch(err){next(err)}
});
app.get("/api/me",requireParticipant,(req,res)=>res.json({id:req.participant.participant_id,fullName:req.participant.full_name,phone:req.participant.phone_e164}));
app.get("/api/me/entries",requireParticipant,async(req,res,next)=>{
 try{
  const q=await pool.query("select c.id as campaign_id,c.title,c.status,e.id as entry_id,e.number,e.created_at from entries e join campaigns c on c.id=e.campaign_id where e.participant_id=$1 order by e.created_at desc limit 200",[req.participant.participant_id]);
  res.json({entries:q.rows});
 }catch(err){next(err)}
});
app.post("/api/auth/logout",requireParticipant,async(req,res,next)=>{
 try{await pool.query("update participant_sessions set revoked_at=now() where id=$1",[req.participant.session_id]);res.json({loggedOut:true})}catch(err){next(err)}
});

app.get("/api/health",async(req,res)=>{try{await pool.query("select 1");res.json({ok:true})}catch{res.status(503).json({ok:false})}});
app.get("/api/campaigns",async(req,res,next)=>{try{const r=await pool.query("select id,title,description,kind,number_count,regulation_url from campaigns where status='published' order by created_at desc limit 50");res.json({campaigns:r.rows})}catch(e){next(e)}});
app.get("/api/campaigns/:id",async(req,res,next)=>{if(!uuid(req.params.id))return error(res,400,"ID inválido");try{
const r=await pool.query("select id,title,description,kind,number_count,regulation_url from campaigns where id=$1 and status='published'",[req.params.id]);
if(!r.rowCount)return error(res,404,"Campanha indisponível");
const p=await pool.query("select id,label,specs,image_url,position from prizes where campaign_id=$1 order by position",[req.params.id]);res.json({...r.rows[0],prizes:p.rows})}catch(e){next(e)}});
app.get("/api/campaigns/:id/numbers",async(req,res,next)=>{if(!uuid(req.params.id))return error(res,400,"ID inválido");try{
const c=await pool.query("select number_count from campaigns where id=$1 and status='published'",[req.params.id]);if(!c.rowCount)return error(res,404,"Campanha indisponível");
const r=await pool.query("select number from entries where campaign_id=$1 order by number",[req.params.id]);res.json({total:c.rows[0].number_count,occupied:r.rows.map(x=>x.number)})}catch(e){next(e)}});
// Legacy unreserved flow disabled to avoid bypassing active holds.
app.post("/api/campaigns/:id/entries",requireParticipant,(req,res)=>error(res,410,"Use a reserva de 3 minutos e confirmação da inscrição gratuita"));

/* Timed holds are exclusively for authorized FREE entries. No payment linkage. */
app.get("/api/campaigns/:id/availability",async(req,res,next)=>{
 if(!uuid(req.params.id))return error(res,400,"ID inválido");
 try{
  const camp=await pool.query("select number_count from campaigns where id=$1 and status='published'",[req.params.id]);
  if(!camp.rowCount)return error(res,404,"Campanha indisponível");
  const [confirmed,held]=await Promise.all([
   pool.query("select number from entries where campaign_id=$1",[req.params.id]),
   pool.query("select number,expires_at from number_reservations where campaign_id=$1 and expires_at>now()",[req.params.id])
  ]);
  res.json({total:camp.rows[0].number_count,confirmed:confirmed.rows.map(x=>x.number),reserved:held.rows.map(x=>({number:x.number,expiresAt:x.expires_at}))});
 }catch(e){next(e)}
});
app.post("/api/campaigns/:id/reservations",requireParticipant,async(req,res,next)=>{
 if(!uuid(req.params.id))return error(res,400,"ID inválido");
 const numbers=req.body?.numbers;
 if(!Array.isArray(numbers)||numbers.length<1||numbers.length>10||!numbers.every(Number.isInteger)||new Set(numbers).size!==numbers.length)return error(res,400,"Escolha de 1 a 10 números diferentes");
 const client=await pool.connect();
 try{
  await client.query("BEGIN");
  const c=await client.query("select number_count from campaigns where id=$1 and status='published' and kind in ('authorized_free_promotion','authorized_osc') and (starts_at is null or starts_at<=now()) and (ends_at is null or ends_at>=now()) for share",[req.params.id]);
  if(!c.rowCount||numbers.some(n=>n<1||n>c.rows[0].number_count)){await client.query("ROLLBACK");return error(res,409,"Campanha ou números indisponíveis")}
  const person=req.participant.participant_id;
  // Reap old expired holds, but do not alter any active holds.
  await client.query("delete from number_reservations where campaign_id=$1 and expires_at<=now()",[req.params.id]);
  const already=await client.query("select number from entries where campaign_id=$1 and number=any($2::int[])",[req.params.id,numbers]);
  if(already.rowCount){await client.query("ROLLBACK");return error(res,409,"Um dos números já foi confirmado")}
  const group=randomUUID();
  const expiresAt=new Date(Date.now()+180000);
  for(const number of numbers){
   const r=await client.query("insert into number_reservations(campaign_id,participant_id,number,reservation_group,expires_at) values($1,$2,$3,$4,$5) on conflict(campaign_id,number) do nothing returning id",[req.params.id,person,number,group,expiresAt]);
   if(!r.rowCount){await client.query("ROLLBACK");return error(res,409,"Número reservado por outra pessoa")}
  }
  await client.query("COMMIT");
  res.status(201).json({reservationId:group,numbers,expiresAt:expiresAt.toISOString(),paymentRequired:false});
 }catch(e){await client.query("ROLLBACK").catch(()=>{});next(e)}finally{client.release()}
});
app.post("/api/campaigns/:id/reservations/:group/confirm",requireParticipant,async(req,res,next)=>{
 if(!uuid(req.params.id)||!uuid(req.params.group))return error(res,400,"ID inválido");
 if(req.body?.acceptedRegulation!==true)return error(res,400,"Aceite do regulamento obrigatório");
 const client=await pool.connect();
 try{
  await client.query("BEGIN");
  const c=await client.query("select id from campaigns where id=$1 and status='published' and kind in ('authorized_free_promotion','authorized_osc') and (ends_at is null or ends_at>=now()) for share",[req.params.id]);
  if(!c.rowCount){await client.query("ROLLBACK");return error(res,409,"Campanha encerrada")}
  const holds=await client.query("select id,number,expires_at from number_reservations where campaign_id=$1 and participant_id=$2 and reservation_group=$3 order by number for update",[req.params.id,req.participant.participant_id,req.params.group]);
  if(!holds.rowCount||holds.rows.some(x=>new Date(x.expires_at).getTime()<=Date.now())){await client.query("ROLLBACK");return error(res,409,"Reserva expirada")}
  for(const hold of holds.rows){
   const r=await client.query("insert into entries(campaign_id,participant_id,number) values($1,$2,$3) on conflict do nothing returning id",[req.params.id,req.participant.participant_id,hold.number]);
   if(!r.rowCount){await client.query("ROLLBACK");return error(res,409,"Número indisponível")}
  }
  await client.query("delete from number_reservations where reservation_group=$1 and participant_id=$2",[req.params.group,req.participant.participant_id]);
  await client.query("insert into audit_log(actor_id,action,entity_type,entity_id,details) values($1,$2,$3,$4,$5)",[req.participant.participant_id,"entries.confirmed_free","campaign",req.params.id,JSON.stringify({reservationId:req.params.group,numbers:holds.rows.map(x=>x.number)})]);
  await client.query("COMMIT");
  res.status(201).json({confirmed:true,numbers:holds.rows.map(x=>x.number),paymentRequired:false});
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

/* Staging-only system administrator endpoints. Do not expose the master API key to a browser. */

// Admin-only Asaas sandbox connection diagnostic. Does not initiate charges.
// Isolated sandbox admin login; sessions expire on restart.
const adminSessions=new Map();
const adminLoginLimiter=rateLimit({windowMs:15*60*1000,limit:6,standardHeaders:"draft-7",legacyHeaders:false});
function adminCookie(req){return (req.get("cookie")||"").split(";").map(s=>s.trim()).find(s=>s.startsWith("acoes_admin="))?.slice(12)||""}
function sessionAdmin(req,res,next){
 const token=adminCookie(req);
 const session=adminSessions.get(digest(token));
 if(!token||!session||session.expiresAt<Date.now())return error(res,401,"Faça login");
 const origin=req.protocol+"://"+req.get("host");
 if(!["GET","HEAD","OPTIONS"].includes(req.method)&&req.get("origin")!==origin)return error(res,403,"Origem não autorizada");
 next();
}
function requireAdminLoginReady(req,res,next){
 if(process.env.ASAAS_SETTINGS_UI_ENABLED!=="true")return error(res,404,"Not found");
 if(!req.secure&&!["localhost","127.0.0.1"].includes(req.hostname))return error(res,403,"HTTPS required");
 res.set("Cache-Control","no-store");next();
}
app.post("/api/admin/asaas/login",requireAdminLoginReady,adminLoginLimiter,async(req,res)=>{
 const {email,password}=req.body||{};
 const validEmail=typeof email==="string"&&email.toLowerCase().trim()===process.env.ADMIN_LOGIN_EMAIL?.toLowerCase();
 const validPassword=typeof password==="string"&&password.length>=6&&password.length<=128;
 const salt=process.env.ADMIN_PASSWORD_SALT,expected=process.env.ADMIN_PASSWORD_HASH;
 if(!validEmail||!validPassword||!/^[a-f0-9]{48}$/i.test(salt||"")||!/^[a-f0-9]{128}$/i.test(expected||""))
   return error(res,401,"Credenciais inválidas");
 try{
  if(!await checkPassword(password,salt,expected))return error(res,401,"Credenciais inválidas");
  const token=randomBytes(32).toString("hex");
  for(const [key,item] of adminSessions){if(item.expiresAt<Date.now())adminSessions.delete(key)}
  if(adminSessions.size>=10)adminSessions.delete(adminSessions.keys().next().value);
  adminSessions.set(digest(token),{expiresAt:Date.now()+8*60*60*1000});
  res.set("Cache-Control","no-store");
  res.cookie("acoes_admin",token,{httpOnly:true,secure:req.secure,sameSite:"strict",path:"/api/admin/asaas",maxAge:8*60*60*1000});
  res.json({authenticated:true,email:process.env.ADMIN_LOGIN_EMAIL});
 }catch(e){console.error("Admin login error",e.message);return error(res,500,"Erro interno")}
});
app.get("/api/admin/asaas/session",requireAdminLoginReady,sessionAdmin,(req,res)=>res.json({authenticated:true,email:process.env.ADMIN_LOGIN_EMAIL}));
app.post("/api/admin/asaas/logout",requireAdminLoginReady,sessionAdmin,(req,res)=>{
 adminSessions.delete(digest(adminCookie(req)));
 res.clearCookie("acoes_admin",{path:"/api/admin/asaas",sameSite:"strict",secure:req.secure,httpOnly:true});
 res.json({authenticated:false});
});

const sandboxUiEnabled=process.env.ASAAS_SETTINGS_UI_ENABLED==="true";
function requireSecureAdminSetup(req,res,next){
 if(!sandboxUiEnabled)return error(res,404,"Not found");
 // The backend must be reached over TLS, except local development.
 if(!req.secure&&!["localhost","127.0.0.1"].includes(req.hostname))return error(res,403,"HTTPS required");
 res.set("Cache-Control","no-store");
 next();
}
for(const [route,file,type] of [
 ["/admin/asaas","../private/asaas.html","text/html"],
 ["/admin/asaas/styles.css","../private/asaas.css","text/css"],
 ["/admin/asaas/app.js","../private/asaas.js","application/javascript"]
]){
 app.get(route,requireSecureAdminSetup,(req,res)=>res.type(type).sendFile(fileURLToPath(new URL(file,import.meta.url))));
}
app.get("/api/admin/asaas/status",requireSecureAdminSetup,sessionAdmin,async(req,res,next)=>{
 try{
  const creds=await getAsaasSettings(pool);
  if(!creds)return res.json({configured:false,connected:false,environment:"sandbox"});
  const result=await verifyAsaasConnection(creds.apiKey);
  res.json({...result,updatedAt:creds.updatedAt});
 }catch(e){next(e)}
});
app.post("/api/admin/asaas/config",requireSecureAdminSetup,sessionAdmin,async(req,res,next)=>{
 const issue=validateAsaasSandboxSettings(req.body);
 if(issue)return error(res,400,issue);
 try{
   const result=await verifyAsaasConnection(req.body.apiKey);
   if(!result.connected)return error(res,422,"Chave não validada no Sandbox. Verifique a chave e a conta.");
   const saved=await saveAsaasSettings(pool,{apiKey:req.body.apiKey,webhookToken:req.body.webhookToken});
   res.status(201).json({...saved,connected:true});
 }catch(e){next(e)}
});
app.delete("/api/admin/asaas/config",requireSecureAdminSetup,sessionAdmin,async(req,res,next)=>{
 try{res.json(await deleteAsaasSettings(pool))}catch(e){next(e)}
});
// Receive commercial payment events only; never allocate campaign numbers via payment events.
// Only a staging administrator can create a standalone commercial sale checkout.
// There is intentionally no route from campaign numbers to this API.
app.post("/api/admin/commercial-checkouts",auth,async(req,res,next)=>{
 const {organizerId,description,amountCents}=req.body||{};
 if(!uuid(organizerId)||typeof description!=="string"||description.trim().length<4||
   description.trim().length>120||!Number.isSafeInteger(amountCents)||amountCents<100||amountCents>100000000)
   return error(res,400,"Dados comerciais inválidos");
 const {COMMERCIAL_CHECKOUT_RETURN_BASE:base}=process.env;
 if(!base||!/^https:\/\//.test(base))return error(res,503,"Callback HTTPS não configurado");
 let orderId=null;
 try{
  const result=await pool.query("insert into commercial_orders(organizer_id,description,amount_cents,external_reference,provider,status) select id,$2,$3,$4,'asaas','created' from organizers where id=$1 returning id,external_reference",[
   organizerId,description.trim(),amountCents,randomUUID()
  ]);
  if(!result.rowCount)return error(res,404,"Organizador inexistente");
  orderId=result.rows[0].id;
  const externalReference=result.rows[0].external_reference;
  const back=base.replace(/\/$/,"");
  const callbacks={
    successUrl:back+"/?checkoutReturn=success&order="+encodeURIComponent(orderId),
    cancelUrl:back+"/?checkoutReturn=cancel&order="+encodeURIComponent(orderId),
    expiredUrl:back+"/?checkoutReturn=expired&order="+encodeURIComponent(orderId)
  };
  const providerSettings=await getAsaasSettings(pool);
  if(!providerSettings)throw Error("Asaas Sandbox não configurado");
  const checkout=await createCommercialCheckout({externalReference,title:description.trim(),amountCents,...callbacks,apiKey:providerSettings.apiKey});
  await pool.query("update commercial_orders set provider_checkout_id=$2,status='pending' where id=$1",[orderId,checkout.checkoutId]);
  res.status(201).json({orderId,checkoutUrl:checkout.checkoutUrl,checkoutId:checkout.checkoutId,environment:"sandbox",paid:false});
 }catch(e){
  // A provider checkout may have been created before persistence failed.
  // Such orders require manual reconciliation; do not blindly retry.
  console.error("Asaas checkout setup failed",e.status||e.message,orderId);
  next(e);
 }
});
app.get("/api/admin/commercial-orders/:id",auth,async(req,res,next)=>{
 if(!uuid(req.params.id))return error(res,400,"Invalid id");
 try{
  const r=await pool.query("select id,description,amount_cents,status,provider_checkout_id,created_at,paid_at from commercial_orders where id=$1",[req.params.id]);
  if(!r.rowCount)return error(res,404,"Order not found");
  res.json({order:r.rows[0]});
 }catch(e){next(e)}
});
// Persist Asaas webhook events using provider IDs for idempotency.
// Only CHECKOUT_PAID updates a commercial order, never raffle numbers.
app.post("/api/webhooks/asaas",async(req,res,next)=>{
 let providerSettings;
 try{providerSettings=await getAsaasSettings(pool)}catch(e){return next(e)}
 if(!providerSettings||!verifyAsaasWebhookToken(req.get("asaas-access-token"),providerSettings.webhookToken))return error(res,401,"Not authorized");
 const evt=req.body;
 if(!evt||typeof evt.id!=="string"||evt.id.length>200||typeof evt.event!=="string"||evt.event.length>100)
   return error(res,400,"Invalid event");
 const checkoutId=evt.checkout?.id;
 const paymentId=evt.payment?.id;
 if((!checkoutId||typeof checkoutId!=="string")&&(!paymentId||typeof paymentId!=="string"))
   return error(res,400,"Event has no payment or checkout id");
 const client=await pool.connect();
 try{
   await client.query("BEGIN");
   const orderQuery=checkoutId?
    "select id from commercial_orders where provider_checkout_id=$1 for update":
    "select id from commercial_orders where provider_payment_id=$1 for update";
   const found=await client.query(orderQuery,[checkoutId||paymentId]);
   // Unknown events are saved and acknowledged; never grant access or entries.
   const id=found.rows[0]?.id||null;
   const inserted=await client.query(
    "insert into payment_events(provider,provider_event_id,commercial_order_id,payload) values('asaas',$1,$2,$3) on conflict(provider,provider_event_id) do nothing returning id",
    [evt.id,id,JSON.stringify(evt)]);
   if(inserted.rowCount&&id){
     const paid=evt.event==="CHECKOUT_PAID";
     const failed=evt.event==="CHECKOUT_CANCELED"||evt.event==="CHECKOUT_EXPIRED";
     if(paid)await client.query("update commercial_orders set status='paid',paid_at=coalesce(paid_at,now()) where id=$1 and status not in ('refunded')",[id]);
     else if(failed)await client.query("update commercial_orders set status='cancelled' where id=$1 and status in ('created','pending')",[id]);
   }
   await client.query("COMMIT");
   res.json({received:true});
 }catch(e){await client.query("ROLLBACK").catch(()=>{});next(e)}
 finally{client.release()}
});
app.get("/api/admin/overview",auth,async(req,res,next)=>{
 try{
  const [organizers,campaigns,participants,entries]=await Promise.all([
   pool.query("select count(*)::int as n from organizers"),
   pool.query("select count(*)::int as n from campaigns"),
   pool.query("select count(*)::int as n from participants"),
   pool.query("select count(*)::int as n from entries")
  ]);
  res.json({organizers:organizers.rows[0].n,campaigns:campaigns.rows[0].n,participants:participants.rows[0].n,entries:entries.rows[0].n});
 }catch(e){next(e)}
});
app.get("/api/admin/organizers",auth,async(req,res,next)=>{
 try{const r=await pool.query("select id,display_name,created_at from organizers order by created_at desc limit 100");res.json({organizers:r.rows})}catch(e){next(e)}
});
app.get("/api/admin/campaigns",auth,async(req,res,next)=>{
 try{const r=await pool.query(`select c.id,c.title,c.description,c.kind,c.status,c.number_count,c.created_at,o.display_name as organizer,
 (select count(*)::int from entries e where e.campaign_id=c.id) as occupied,
 (select count(*)::int from prizes p where p.campaign_id=c.id) as prize_count
 from campaigns c join organizers o on o.id=c.organizer_id order by c.created_at desc limit 200`);
 res.json({campaigns:r.rows})}catch(e){next(e)}
});
app.get("/api/admin/campaigns/:id/entries",auth,async(req,res,next)=>{
 if(!uuid(req.params.id))return error(res,400,"ID inválido");
 try{
  const r=await pool.query(`select e.id,e.number,e.created_at,p.full_name,p.phone_e164,p.social_network,p.social_handle
   from entries e join participants p on p.id=e.participant_id where e.campaign_id=$1 order by e.number limit 100000`,[req.params.id]);
  res.json({entries:r.rows});
 }catch(e){next(e)}
});
app.post("/api/admin/campaigns/:id/prizes",auth,async(req,res,next)=>{
 if(!uuid(req.params.id))return error(res,400,"ID inválido");
 const {label,specs,position,imageUrl}=req.body||{};
 if(typeof label!=="string"||label.trim().length<2||label.length>120||String(specs||"").length>1000||!Number.isInteger(position)||position<1||position>50)return error(res,400,"Dados inválidos");
 if(imageUrl&&(!/^https:\/\/[a-z0-9.-]+\/\S+$/i.test(imageUrl)||String(imageUrl).length>2000))return error(res,400,"URL de imagem inválida");
 try{
  const r=await pool.query(`insert into prizes(campaign_id,label,specs,position,image_url)
   select id,$2,$3,$4,$5 from campaigns where id=$1 and status='draft'
   returning id,label,specs,position,image_url`,[req.params.id,label.trim(),String(specs||"").trim(),position,imageUrl||null]);
  if(!r.rowCount)return error(res,409,"Campanha não encontrada ou não está em rascunho");
  res.status(201).json({prize:r.rows[0]});
 }catch(e){if(e.code==="23505")return error(res,409,"Já existe prêmio nessa posição");next(e)}
});

app.use((err,req,res,next)=>{console.error("API error",err.code||err.message);res.status(500).json({error:"Erro interno"})});
const port=Number(process.env.PORT||3000);app.listen(port,()=>console.log("API running on port "+port));
process.on("SIGTERM",async()=>{await pool.end();process.exit(0)});
