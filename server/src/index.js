import "dotenv/config";
import express from "express";
import pg from "pg";
import {verifyAsaasConnection,verifyAsaasProductionConnection,verifyAsaasWebhookToken,createCommercialCheckout,createSandboxPixCustomer,createSandboxPixPayment,getSandboxPixQr,getSandboxPixPayment,findSandboxPixPaymentsByReference} from "./asaas.js";
import helmet from "helmet";
import cors from "cors";
import rateLimit from "express-rate-limit";
import {timingSafeEqual,randomBytes,createHash,randomUUID,scrypt as scryptCallback} from "node:crypto";
import {promisify} from "node:util";
import {fileURLToPath} from "node:url";
import {getAsaasSettings,saveAsaasSettings,deleteAsaasSettings,validateAsaasSettings,getActiveAsaasEnvironment,setActiveAsaasEnvironment,seal,unseal} from "./asaas-settings.js";
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

// Public previews only. Paid-number transactions remain unavailable.
app.get("/api/actions",async(req,res,next)=>{
 try{
  const q=await pool.query("select slug,category,title,description,image_url,number_count,price_cents,prize_details,rules_text,regulation_url,max_numbers_per_person,starts_at,ends_at,created_at from action_catalog where state='preview' order by created_at desc limit 100");
  res.set("Cache-Control","public, max-age=45");res.json({actions:q.rows,purchasesEnabled:false});
 }catch(e){next(e)}
});
app.get("/api/actions/:slug",async(req,res,next)=>{
 if(!/^[a-z0-9-]{8,90}$/.test(req.params.slug))return error(res,404,"Ação não encontrada");
 try{
  const q=await pool.query("select slug,category,title,description,image_url,number_count,price_cents,prize_details,rules_text,regulation_url,max_numbers_per_person,starts_at,ends_at from action_catalog where slug=$1 and state='preview'",[req.params.slug]);
  if(!q.rowCount)return error(res,404,"Ação não encontrada");
  res.set("Cache-Control","public, max-age=45");res.json({action:q.rows[0],purchasesEnabled:false});
 }catch(e){next(e)}
});
// Temporary number holds for catalog previews. No charge, sale, or confirmed entry.
// Reservation audit is only visible after secure administrator authentication.
app.get("/api/admin/reservation-audit",requireSecureAdminSetup,sessionAdmin,async(req,res,next)=>{
 const kind=String(req.query.type||""),slug=String(req.query.action||"");
 const before=req.query.before===undefined?null:Number(req.query.before);
 if((kind&&!["created","released","expired","conflict"].includes(kind))||
  (slug&&!/^[a-z0-9-]{8,90}$/.test(slug))||
  (before!==null&&(!Number.isSafeInteger(before)||before<1)))return error(res,400,"Filtro inválido");
 try{
  await pool.query("delete from action_number_holds where expires_at<=now()");
  const q=await pool.query(
   "select id,action_slug,participant_id,reservation_group,number,event_type,occurred_at from action_reservation_audit "+
   "where ($1::text='' or event_type=$1) and ($2::text='' or action_slug=$2) and ($3::bigint is null or id<$3) "+
   "order by id desc limit 101",[kind,slug,before]);
  const hasMore=q.rows.length>100,events=q.rows.slice(0,100);
  const summary=await pool.query(
   "select event_type,count(*)::int as count from action_reservation_audit where ($1::text='' or action_slug=$1) group by event_type",[slug]);
  res.set("Cache-Control","no-store");
  res.json({events,hasMore,nextCursor:hasMore?events[events.length-1].id:null,
   summary:Object.fromEntries(summary.rows.map(x=>[x.event_type,x.count]))});
 }catch(e){next(e)}
});
const RAYA_DEFAULT_ENDPOINT="https://api.rayaconnect.com.br/v2/api/external/9f945521-57eb-426a-8207-f4e9cc69b8de";
const RAYA_DEFAULT_PHONE="5522999397655";
const BRL=amount=>(amount/100).toLocaleString("pt-BR",{style:"currency",currency:"BRL"});
function rayaEndpoint(value){
 if(typeof value!=="string"||value.length>200)return null;
 const match=/^https:\/\/api\.rayaconnect\.com\.br\/v2\/api\/external\/([0-9a-f-]{36})$/i.exec(value);
 return match&&uuid(match[1])?value:null;
}
async function actionCheckoutConfig(client=pool){
 const q=await client.query("select mode,raya_endpoint,destination_phone,token_ciphertext from action_checkout_settings where id='global'");
 return q.rows[0]||{mode:"automatic",raya_endpoint:RAYA_DEFAULT_ENDPOINT,destination_phone:RAYA_DEFAULT_PHONE,token_ciphertext:null};
}
async function expireManualRequests(client,actionId=null){
 // Caller owns any needed serialization lock on an action row.
 const conditions=actionId?"and action_id=$1":"";
 const args=actionId?[actionId]:[];
 const q=await client.query(
  "update action_manual_requests set status='expired',updated_at=now() "+
  "where status='reserved' and expires_at<=now() "+conditions+" returning id",args);
 if(q.rowCount)await client.query("delete from action_manual_request_numbers where request_id=any($1::uuid[])",[q.rows.map(r=>r.id)]);
 return q.rowCount;
}
function formatManualRequestMessage(r){
 const num=r.numbers.map(n=>String(n).padStart(3,"0")).join(", ");
 const text=[
  "*AÇÕES | NOVA RESERVA PARA ATENDIMENTO*","",
  "*Ação:* "+r.title,
  "*Categoria:* "+({product:"Produto",money:"Dinheiro",service:"Serviço"}[r.category]||r.category),
  "*Pedido:* "+r.id,
  "*ID do cliente:* "+r.customer_id,"",
  "*Nome:* "+r.contact_name,
  "*WhatsApp:* "+r.contact_phone.replace(/^\+/,""),
  "*Números:* "+num,
  "*Quantidade:* "+r.quantity,
  "*Valor unitário:* "+BRL(r.unit_price_cents),
  "*Valor total:* "+BRL(Number(r.total_cents)),
  "*Reservado até:* "+new Date(r.expires_at).toLocaleString("pt-BR",{timeZone:"America/Sao_Paulo"}),
  "",
  "*Situação:* RESERVADO — AGUARDANDO CONFERÊNCIA",
  "_Envio automático do AÇÕES. A reserva não comprova pagamento._"
 ];
 return text.join("\n");
}
async function sendManualRequestNotification(orderId){
 const claimed=await pool.query(
  "update action_manual_requests set notification_status='sending',notification_attempts=notification_attempts+1,updated_at=now() "+
  "where id=$1 and status='reserved' and (notification_status in ('pending','failed') or "+
  "(notification_status='sending' and updated_at<now()-interval '2 minutes')) returning id",
  [orderId]);
 if(!claimed.rowCount)return {attempted:false};
 try{
  const config=await actionCheckoutConfig();
  if(!config.token_ciphertext)throw Error("Raya token not configured");
  const token=unseal(config.token_ciphertext)?.token;
  if(typeof token!=="string"||token.length<16)throw Error("Raya token invalid");
  const q=await pool.query(
   "select r.*,a.title,a.category from action_manual_requests r join action_catalog a on a.id=r.action_id where r.id=$1",
   [orderId]);
  if(!q.rowCount)throw Error("Request not found");
  const response=await fetch(config.raya_endpoint,{
   method:"POST",headers:{"Authorization":"Bearer "+token,"Content-Type":"application/json","Accept":"application/json"},
   body:JSON.stringify({body:formatManualRequestMessage(q.rows[0]),number:config.destination_phone,externalKey:"acoes-"+orderId,isClosed:false}),
   signal:AbortSignal.timeout(11000)
  });
  if(!response.ok)throw Error("Raya HTTP "+response.status);
  await pool.query(
   "update action_manual_requests set notification_status='sent',notification_sent_at=now(),notification_error=null,updated_at=now() where id=$1",[orderId]);
  return {attempted:true,accepted:true};
 }catch(err){
  const reason=(String(err.message||"Notification failed")).slice(0,150);
  await pool.query(
   "update action_manual_requests set notification_status='failed',notification_error=$2,updated_at=now() where id=$1",
   [orderId,reason]).catch(()=>{});
  console.error("AÇÕES Raya notification failed",orderId,reason);
  return {attempted:true,accepted:false};
 }
}
app.get("/api/checkout/mode",async(req,res,next)=>{
 try{
  const config=await actionCheckoutConfig();
  res.set("Cache-Control","no-store");
  res.json({mode:config.mode,manualEnabled:config.mode==="whatsapp"&&!!config.token_ciphertext});
 }catch(e){next(e)}
});
app.get("/api/admin/checkout-mode",requireSecureAdminSetup,sessionAdmin,async(req,res,next)=>{
 try{
  const config=await actionCheckoutConfig();
  res.set("Cache-Control","no-store");
  res.json({mode:config.mode,rayaEndpoint:config.raya_endpoint,destinationPhone:config.destination_phone,
   tokenConfigured:!!config.token_ciphertext,automaticRaffleNumbersEnabled:false});
 }catch(e){next(e)}
});
app.put("/api/admin/checkout-mode",requireSecureAdminSetup,sessionAdmin,async(req,res,next)=>{
 const mode=String(req.body?.mode||"");
 const endpoint=rayaEndpoint(req.body?.rayaEndpoint);
 const destination=String(req.body?.destinationPhone||"").replace(/\D/g,"");
 const token=req.body?.token;
 if(!["automatic","whatsapp"].includes(mode)||!endpoint||!/^55[1-9][1-9][0-9]{8,9}$/.test(destination)||
  (token!==undefined&&(typeof token!=="string"||token.length<16||token.length>2048||/\s/.test(token))))
  return error(res,400,"Confira modo, URL da Raya, número do destinatário e token");
 try{
  const current=await actionCheckoutConfig();
  const encrypted=token?seal({token}):current.token_ciphertext;
  if(mode==="whatsapp"&&!encrypted)return error(res,409,"Configure primeiro o token Bearer da Raya");
  await pool.query(
   "insert into action_checkout_settings(id,mode,raya_endpoint,destination_phone,token_ciphertext) "+
   "values('global',$1,$2,$3,$4) on conflict(id) do update set mode=excluded.mode,raya_endpoint=excluded.raya_endpoint,"+
   "destination_phone=excluded.destination_phone,token_ciphertext=excluded.token_ciphertext,updated_at=now()",
   [mode,endpoint,destination,encrypted]);
  res.json({mode,rayaEndpoint:endpoint,destinationPhone:destination,tokenConfigured:!!encrypted});
 }catch(e){next(e)}
});
const manualRequestLimiter=rateLimit({windowMs:15*60*1000,limit:6,standardHeaders:"draft-7",legacyHeaders:false});
app.post("/api/actions/:slug/manual-requests",manualRequestLimiter,async(req,res,next)=>{
 if(!/^[a-z0-9-]{8,90}$/.test(req.params.slug))return error(res,404,"Ação não encontrada");
 const numbers=req.body?.numbers,name=String(req.body?.fullName||"").trim().replace(/\s+/g," ");
 const normalized=phone(req.body?.phone);
 if(!Array.isArray(numbers)||numbers.length<1||numbers.length>20||!numbers.every(Number.isInteger)||
  new Set(numbers).size!==numbers.length||name.length<3||name.length>120||!normalized)
  return error(res,400,"Informe nome, WhatsApp e até 20 números distintos");
 const client=await pool.connect();
 let savedId=null;
 try{
  await client.query("BEGIN");
  const config=await actionCheckoutConfig(client);
  if(config.mode!=="whatsapp"||!config.token_ciphertext){await client.query("ROLLBACK");return error(res,409,"Atendimento WhatsApp não está habilitado")}
  const a=await client.query(
   "select id,title,category,number_count,max_numbers_per_person,price_cents from action_catalog where slug=$1 and state='preview' for update",
   [req.params.slug]);
  if(!a.rowCount){await client.query("ROLLBACK");return error(res,404,"Ação não encontrada")}
  const action=a.rows[0];
  if(numbers.length>action.max_numbers_per_person||numbers.some(n=>n<1||n>action.number_count)){
   await client.query("ROLLBACK");return error(res,400,"Número fora do intervalo ou limite da ação");
  }
  await expireManualRequests(client,action.id);
  const existingPhone=await client.query(
   "select coalesce(sum(quantity),0)::int as count from action_manual_requests where action_id=$1 and contact_phone=$2 and status='reserved' and expires_at>now()",
   [action.id,normalized]);
  if(existingPhone.rows[0].count+numbers.length>action.max_numbers_per_person){
   await client.query("ROLLBACK");return error(res,409,"Limite de números por contato atingido");
  }
  const taken=await client.query(
   "select number from action_manual_request_numbers where action_id=$1 and number=any($2::int[]) "+
   "union select number from action_number_holds where action_id=$1 and number=any($2::int[]) and expires_at>now() "+
   "union select number from action_number_confirmations where action_id=$1 and number=any($2::int[])",
   [action.id,numbers]);
  if(taken.rowCount){await client.query("ROLLBACK");return error(res,409,"Um ou mais números já estão reservados")}
  const total=action.price_cents*numbers.length;
  const q=await client.query(
   "insert into action_manual_requests(action_id,contact_name,contact_phone,unit_price_cents,quantity,total_cents,numbers,expires_at) "+
   "values($1,$2,$3,$4,$5,$6,$7,now()+interval '24 hours') returning id,customer_id,expires_at",
   [action.id,name,normalized,action.price_cents,numbers.length,total,numbers]);
  savedId=q.rows[0].id;
  for(const number of numbers)await client.query(
   "insert into action_manual_request_numbers(action_id,number,request_id) values($1,$2,$3)",
   [action.id,number,savedId]);
  await client.query("COMMIT");
  const delivered=await sendManualRequestNotification(savedId);
  res.set("Cache-Control","no-store");
  res.status(201).json({orderId:savedId,customerId:q.rows[0].customer_id,numbers,quantity:numbers.length,
   unitPriceCents:action.price_cents,totalCents:total,expiresAt:q.rows[0].expires_at,
   status:"reserved",notificationStatus:delivered.accepted?"sent":"pending",
   message:delivered.accepted?"Pedido reservado e notificação aceita pela Raya.":"Pedido reservado; aviso pendente de reenvio pelo administrador."});
 }catch(e){
  await client.query("ROLLBACK").catch(()=>{});
  if(e.code==="23505")return error(res,409,"Números já reservados");
  next(e);
 }finally{client.release()}
});
app.get("/api/admin/manual-requests",requireSecureAdminSetup,sessionAdmin,async(req,res,next)=>{
 try{
  await expireManualRequests(pool);
  const q=await pool.query(
   "select r.id,r.customer_id,r.contact_name,r.contact_phone,r.numbers,r.quantity,r.unit_price_cents,r.total_cents,"+
   "r.status,r.notification_status,r.notification_attempts,r.created_at,r.expires_at,a.title,a.slug "+
   "from action_manual_requests r join action_catalog a on a.id=r.action_id order by r.created_at desc limit 100");
  res.set("Cache-Control","no-store");res.json({orders:q.rows});
 }catch(e){next(e)}
});
app.post("/api/admin/manual-requests/:id/retry",requireSecureAdminSetup,sessionAdmin,async(req,res,next)=>{
 if(!uuid(req.params.id))return error(res,400,"Pedido inválido");
 try{
  const result=await sendManualRequestNotification(req.params.id);
  res.json({accepted:!!result.accepted,attempted:!!result.attempted});
 }catch(e){next(e)}
});
app.post("/api/admin/manual-requests/:id/release",requireSecureAdminSetup,sessionAdmin,async(req,res,next)=>{
 if(!uuid(req.params.id))return error(res,400,"Pedido inválido");
 const client=await pool.connect();
 try{
  await client.query("BEGIN");
  const q=await client.query("update action_manual_requests set status='released',updated_at=now() where id=$1 and status='reserved' returning id",[req.params.id]);
  if(q.rowCount)await client.query("delete from action_manual_request_numbers where request_id=$1",[req.params.id]);
  await client.query("COMMIT");
  res.json({released:!!q.rowCount});
 }catch(e){await client.query("ROLLBACK").catch(()=>{});next(e)}
 finally{client.release()}
});
app.get("/api/actions/:slug/numbers",async(req,res,next)=>{
 if(!/^[a-z0-9-]{8,90}$/.test(req.params.slug))return error(res,404,"Ação não encontrada");
 try{
  const a=await pool.query("select id,number_count,max_numbers_per_person from action_catalog where slug=$1 and state='preview'",[req.params.slug]);
  if(!a.rowCount)return error(res,404,"Ação não encontrada");
  const action=a.rows[0];
  await pool.query("delete from action_number_holds where action_id=$1 and expires_at<=now()",[action.id]);
  await expireManualRequests(pool,action.id);
  const [holds,confirmed,manual]=await Promise.all([
   pool.query("select number,expires_at from action_number_holds where action_id=$1 and expires_at>now()",[action.id]),
   pool.query("select number from action_number_confirmations where action_id=$1",[action.id]),
   pool.query("select number from action_manual_request_numbers where action_id=$1",[action.id])
  ]);
  res.set("Cache-Control","no-store");
  res.json({total:action.number_count,maxPerPerson:action.max_numbers_per_person,
   reserved:[...holds.rows.map(x=>({number:x.number,expiresAt:x.expires_at})),...manual.rows.map(x=>({number:x.number,expiresAt:null}))],
   confirmed:confirmed.rows.map(x=>x.number),purchasesEnabled:false,confirmationEnabled:false});
 }catch(e){next(e)}
});
app.get("/api/me/action-holds",requireParticipant,async(req,res,next)=>{
 try{
  await pool.query("delete from action_number_holds where expires_at<=now()");
  const r=await pool.query("select a.slug,a.title,h.number,h.reservation_group,h.expires_at from action_number_holds h join action_catalog a on a.id=h.action_id where h.participant_id=$1 and h.expires_at>now() order by h.expires_at asc,h.number asc limit 200",[req.participant.participant_id]);
  const groups=new Map();
  for(const h of r.rows){
   const key=h.reservation_group;
   if(!groups.has(key))groups.set(key,{reservationId:key,slug:h.slug,title:h.title,expiresAt:h.expires_at,numbers:[]});
   groups.get(key).numbers.push(h.number);
  }
  res.set("Cache-Control","no-store");
  res.json({holds:r.rows,reservations:[...groups.values()],serverTime:new Date().toISOString(),purchasesEnabled:false});
 }catch(e){next(e)}
});
async function auditHoldConflict(actionId,slug,participantId,numbers){
 try{
  if(!actionId||!Array.isArray(numbers))return;
  await pool.query(
   "insert into action_reservation_audit(action_id,action_slug,participant_id,number,event_type) "+
   "select $1,$2,$3,n,'conflict' from unnest($4::int[]) as n",
   [actionId,slug,participantId,numbers.filter(n=>Number.isInteger(n)&&n>0).slice(0,20)]);
 }catch(e){console.error("Reservation audit write failed",e.message)}
}
const previewHoldLimiter=rateLimit({windowMs:15*60*1000,limit:20,standardHeaders:"draft-7",legacyHeaders:false});
app.post("/api/actions/:slug/holds",previewHoldLimiter,requireParticipant,async(req,res,next)=>{
 if(!/^[a-z0-9-]{8,90}$/.test(req.params.slug))return error(res,404,"Ação não encontrada");
 const numbers=req.body?.numbers;
 if(!Array.isArray(numbers)||!numbers.length||numbers.length>20||!numbers.every(Number.isInteger)||new Set(numbers).size!==numbers.length)
  return error(res,400,"Escolha entre 1 e 20 números distintos");
 const client=await pool.connect();
 let auditActionId=null,auditPid=null;
 try{
  await client.query("BEGIN");
  const a=await client.query("select id,number_count,max_numbers_per_person from action_catalog where slug=$1 and state='preview' for update",[req.params.slug]);
  if(!a.rowCount){await client.query("ROLLBACK");return error(res,404,"Ação não encontrada")}
  const action=a.rows[0],pid=req.participant.participant_id;
  auditActionId=action.id;auditPid=pid;
  if(numbers.some(n=>n<1||n>action.number_count)||numbers.length>action.max_numbers_per_person){
   await client.query("ROLLBACK");return error(res,400,"Número fora do intervalo ou limite individual excedido");
  }
  // All competing holds on this action serialize on the action row.
  await client.query("delete from action_number_holds where action_id=$1 and expires_at<=now()",[action.id]);
  const existing=await client.query("select number from action_number_holds where action_id=$1 and participant_id=$2",[action.id,pid]);
  const ownerNumbers=new Set(existing.rows.map(r=>r.number));
  if(ownerNumbers.size){await client.query("ROLLBACK");await auditHoldConflict(auditActionId,req.params.slug,auditPid,numbers);return error(res,409,"Você já possui uma reserva temporária nesta ação. Libere-a ou aguarde a expiração.")}
  if(new Set([...ownerNumbers,...numbers]).size>action.max_numbers_per_person){
   await client.query("ROLLBACK");return error(res,409,"Limite por participante atingido; libere a seleção anterior");
  }
  const manualOccupied=await client.query("select number from action_manual_request_numbers where action_id=$1 and number=any($2::int[])",[action.id,numbers]);
  if(manualOccupied.rowCount){await client.query("ROLLBACK");return error(res,409,"Números reservados para atendimento WhatsApp")}
  const occupied=await client.query("select number from action_number_holds where action_id=$1 and number=any($2::int[]) union select number from action_number_confirmations where action_id=$1 and number=any($2::int[])",[action.id,numbers]);
  if(occupied.rowCount){await client.query("ROLLBACK");await auditHoldConflict(auditActionId,req.params.slug,auditPid,numbers);return error(res,409,"Um ou mais números já estão reservados ou confirmados")}
  const group=randomUUID(),expiresAt=new Date(Date.now()+180000);
  for(const number of numbers){
   await client.query("insert into action_number_holds(action_id,participant_id,number,reservation_group,expires_at) values($1,$2,$3,$4,$5)",[action.id,pid,number,group,expiresAt]);
  }
  await client.query("COMMIT");
  res.set("Cache-Control","no-store");
  res.status(201).json({reservationId:group,numbers,expiresAt:expiresAt.toISOString(),paymentRequired:false,
   temporarySelection:true,confirmationEnabled:false});
 }catch(e){
  await client.query("ROLLBACK").catch(()=>{});
  if(e.code==="23505"){await auditHoldConflict(auditActionId,req.params.slug,auditPid,numbers);return error(res,409,"Número reservado por outro participante")}
  next(e);
 }finally{client.release()}
});
app.delete("/api/actions/:slug/holds/:group",requireParticipant,async(req,res,next)=>{
 if(!/^[a-z0-9-]{8,90}$/.test(req.params.slug)||!uuid(req.params.group))return error(res,400,"Seleção inválida");
 try{
  const r=await pool.query("delete from action_number_holds h using action_catalog a where h.action_id=a.id and a.slug=$1 and h.participant_id=$2 and h.reservation_group=$3 returning h.number",
   [req.params.slug,req.participant.participant_id,req.params.group]);
  res.set("Cache-Control","no-store");res.json({released:r.rows.map(x=>x.number)});
 }catch(e){next(e)}
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
function adminCookies(req){
 // Browsers may send both the old and new cookie paths after migration.
 return (req.get("cookie")||"").split(";").map(s=>s.trim())
  .filter(s=>s.startsWith("acoes_admin=")).map(s=>s.slice(12))
  .filter(s=>/^[0-9a-f]{64}$/i.test(s));
}
function activeAdminToken(req){
 const now=Date.now();
 return adminCookies(req).find(token=>{
  const entry=adminSessions.get(digest(token));
  return entry&&entry.expiresAt>now;
 })||null;
}
function sessionAdmin(req,res,next){
 const token=activeAdminToken(req);
 if(!token)return error(res,401,"Faça login");
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
  // Remove stale cookie issued before the admin path was widened.
  res.clearCookie("acoes_admin",{path:"/api/admin/asaas",sameSite:"strict",secure:req.secure,httpOnly:true});
  res.cookie("acoes_admin",token,{httpOnly:true,secure:req.secure,sameSite:"strict",path:"/api/admin",maxAge:8*60*60*1000});
  res.json({authenticated:true,email:process.env.ADMIN_LOGIN_EMAIL});
 }catch(e){console.error("Admin login error",e.message);return error(res,500,"Erro interno")}
});
app.get("/api/admin/asaas/session",requireAdminLoginReady,sessionAdmin,(req,res)=>res.json({authenticated:true,email:process.env.ADMIN_LOGIN_EMAIL}));
app.post("/api/admin/asaas/logout",requireAdminLoginReady,sessionAdmin,(req,res)=>{
 for(const token of adminCookies(req))adminSessions.delete(digest(token));
 res.clearCookie("acoes_admin",{path:"/api/admin",sameSite:"strict",secure:req.secure,httpOnly:true});
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
// Separate credentials for sandbox and production. Never return stored secrets.
const asaasEnv=req=>req.query.environment||req.body?.environment||"sandbox";
const asaasValidEnv=e=>e==="sandbox"||e==="production";
app.get("/api/admin/asaas/status",requireSecureAdminSetup,sessionAdmin,async(req,res,next)=>{
 const environment=asaasEnv(req);
 if(!asaasValidEnv(environment))return error(res,400,"Ambiente inválido");
 try{
  const creds=await getAsaasSettings(pool,environment);
  const activeEnvironment=await getActiveAsaasEnvironment(pool);
  if(!creds)return res.json({configured:false,connected:false,environment,activeEnvironment,paymentsEnabled:false});
  const result=environment==="production"?await verifyAsaasProductionConnection(creds.apiKey):await verifyAsaasConnection(creds.apiKey);
  res.json({...result,updatedAt:creds.updatedAt,activeEnvironment,paymentsEnabled:false});
 }catch(e){next(e)}
});
app.post("/api/admin/asaas/config",requireSecureAdminSetup,sessionAdmin,async(req,res,next)=>{
 const environment=asaasEnv(req);
 if(!asaasValidEnv(environment))return error(res,400,"Ambiente inválido");
 const issue=validateAsaasSettings(req.body,environment);
 if(issue)return error(res,400,issue);
 try{
  const result=environment==="production"?await verifyAsaasProductionConnection(req.body.apiKey):await verifyAsaasConnection(req.body.apiKey);
  if(!result.connected)return error(res,422,"Chave não validada no ambiente "+environment+". Verifique a conta e a chave.");
  const saved=await saveAsaasSettings(pool,{apiKey:req.body.apiKey,webhookToken:req.body.webhookToken},environment);
  res.status(201).json({...saved,connected:true,paymentsEnabled:false});
 }catch(e){next(e)}
});
app.delete("/api/admin/asaas/config",requireSecureAdminSetup,sessionAdmin,async(req,res,next)=>{
 const environment=asaasEnv(req);
 if(!asaasValidEnv(environment))return error(res,400,"Ambiente inválido");
 try{res.json(await deleteAsaasSettings(pool,environment))}catch(e){next(e)}
});
app.post("/api/admin/asaas/active-environment",requireSecureAdminSetup,sessionAdmin,async(req,res,next)=>{
 const environment=req.body?.environment;
 if(!asaasValidEnv(environment))return error(res,400,"Ambiente inválido");
 try{
  // Pure administrative selection. It does not change checkout's sandbox-only route.
  if(environment==="production"&&!await getAsaasSettings(pool,"production"))return error(res,409,"Configure a chave de produção antes de selecioná-la");
  res.json(await setActiveAsaasEnvironment(pool,environment));
 }catch(e){next(e)}
});
// Create, list and archive individual shareable action previews.
// Administer configuration of individually linked action previews.
// Prices are display-only. Payment routes do not allocate campaign numbers.
const actionFields="id,slug,category,title,description,image_url,number_count,price_cents,prize_details,rules_text,regulation_url,max_numbers_per_person,starts_at,ends_at,state,created_at";
function parseActionInput(body){
 const title=String(body?.title||"").trim(),description=String(body?.description||"").trim();
 const prizeDetails=String(body?.prizeDetails||"").trim(),rulesText=String(body?.rulesText||"").trim();
 const category=body?.category,numberCount=Number(body?.numberCount);
 const priceCents=Number(body?.priceCents),maxPerPerson=Number(body?.maxPerPerson);
 const imageUrl=String(body?.imageUrl||"").trim(),regulationUrl=String(body?.regulationUrl||"").trim();
 const startsAt=body?.startsAt||null,endsAt=body?.endsAt||null;
 const httpsUrl=x=>{try{const u=new URL(x);return u.protocol==="https:"&&!!u.hostname&&!u.username&&!u.password}catch{return false}};
 if(!["product","money","service"].includes(category)||title.length<4||title.length>110||
  description.length>3000||prizeDetails.length>3000||rulesText.length>6000||
  !Number.isSafeInteger(numberCount)||numberCount<1||numberCount>10000||
  !Number.isSafeInteger(priceCents)||priceCents<0||priceCents>100000000||
  !Number.isSafeInteger(maxPerPerson)||maxPerPerson<1||maxPerPerson>numberCount||
  (imageUrl&&(!httpsUrl(imageUrl)||imageUrl.length>1200))||
  (regulationUrl&&(!httpsUrl(regulationUrl)||regulationUrl.length>1200))||
  (startsAt&&(typeof startsAt!=="string"||isNaN(Date.parse(startsAt))))||
  (endsAt&&(typeof endsAt!=="string"||isNaN(Date.parse(endsAt))))||
  (startsAt&&endsAt&&Date.parse(endsAt)<=Date.parse(startsAt)))return null;
 return {title,description,prizeDetails,rulesText,category,numberCount,priceCents,maxPerPerson,imageUrl:imageUrl||null,regulationUrl:regulationUrl||null,startsAt,endsAt};
}
app.get("/api/admin/actions",requireSecureAdminSetup,sessionAdmin,async(req,res,next)=>{
 try{const q=await pool.query("select "+actionFields+" from action_catalog order by created_at desc limit 200");res.json({actions:q.rows})}catch(e){next(e)}
});
app.post("/api/admin/actions",requireSecureAdminSetup,sessionAdmin,async(req,res,next)=>{
 const data=parseActionInput(req.body);
 if(!data)return error(res,400,"Verifique tipo, título, preço, regras, quantidade, limites, URLs HTTPS e datas.");
 try{
  const slug=data.title.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,56)+"-"+randomBytes(4).toString("hex");
  const q=await pool.query(
   "insert into action_catalog(slug,category,title,description,image_url,number_count,price_cents,prize_details,rules_text,regulation_url,max_numbers_per_person,starts_at,ends_at) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) returning "+actionFields,
   [slug,data.category,data.title,data.description,data.imageUrl,data.numberCount,data.priceCents,data.prizeDetails,data.rulesText,data.regulationUrl,data.maxPerPerson,data.startsAt,data.endsAt]);
  res.status(201).json({action:q.rows[0],purchasesEnabled:false});
 }catch(e){next(e)}
});
app.put("/api/admin/actions/:id",requireSecureAdminSetup,sessionAdmin,async(req,res,next)=>{
 if(!uuid(req.params.id))return error(res,400,"Ação inválida");
 const data=parseActionInput(req.body);
 if(!data)return error(res,400,"Verifique tipo, título, preço, regras, quantidade, limites, URLs HTTPS e datas.");
 try{
  const q=await pool.query(
   "update action_catalog set category=$2,title=$3,description=$4,image_url=$5,number_count=$6,price_cents=$7,prize_details=$8,rules_text=$9,regulation_url=$10,max_numbers_per_person=$11,starts_at=$12,ends_at=$13,updated_at=now() where id=$1 returning "+actionFields,
   [req.params.id,data.category,data.title,data.description,data.imageUrl,data.numberCount,data.priceCents,data.prizeDetails,data.rulesText,data.regulationUrl,data.maxPerPerson,data.startsAt,data.endsAt]);
  if(!q.rowCount)return error(res,404,"Ação não encontrada");
  res.json({action:q.rows[0],purchasesEnabled:false});
 }catch(e){next(e)}
});
app.post("/api/admin/actions/:id/state",requireSecureAdminSetup,sessionAdmin,async(req,res,next)=>{
 if(!uuid(req.params.id)||!["preview","archived"].includes(req.body?.state))return error(res,400,"Ação ou estado inválido");
 try{
  const q=await pool.query("update action_catalog set state=$2,updated_at=now() where id=$1 returning id,slug,state",[req.params.id,req.body.state]);
  if(!q.rowCount)return error(res,404,"Ação não encontrada");
  res.json({action:q.rows[0]});
 }catch(e){next(e)}
});
// Administratively gated Sandbox-only QR demonstration, unrelated to raffle entries.
const pixDemoLimiter=rateLimit({windowMs:60*60*1000,limit:8,standardHeaders:"draft-7",legacyHeaders:false});
function cleanCpf(raw){
 const n=String(raw||"").replace(/\D/g,"");
 if(!/^\d{11}$/.test(n)||/^(\d)\1{10}$/.test(n))return null;
 for(let length=9;length<=10;length++){
  const sum=[...n.slice(0,length)].reduce((s,d,i)=>s+Number(d)*(length+1-i),0);
  const check=(sum*10)%11%10;
  if(check!==Number(n[length]))return null;
 }
 return n;
}
app.post("/api/admin/pix-demo",requireSecureAdminSetup,sessionAdmin,pixDemoLimiter,async(req,res,next)=>{
 if(process.env.ASAAS_ENV!=="sandbox")return error(res,503,"A demonstração Pix só funciona em Sandbox");
 const name=String(req.body?.fullName||"").trim().replace(/\s+/g," ");
 const cpfCnpj=cleanCpf(req.body?.cpf);
 const mobilePhone=phone(req.body?.phone)?.slice(3);
 if(name.length<3||name.length>100||!cpfCnpj||!mobilePhone)return error(res,400,"Informe nome completo, CPF válido e WhatsApp brasileiro");
 const id=randomUUID(),userId=randomUUID();
 try{
  const key=(await getAsaasSettings(pool,"sandbox"))?.apiKey;
  if(!key)return error(res,503,"Asaas Sandbox não configurado");
  const recent=await pool.query("select count(*)::int n from sandbox_pix_demos where created_at>now()-interval '1 hour'");
  if(recent.rows[0].n>=12)return error(res,429,"Limite temporário de demonstrações atingido");
  await pool.query("insert into sandbox_pix_demos(id,user_id,external_reference) values($1,$2,$3)",[id,userId,id]);
  const customerId=await createSandboxPixCustomer({name,cpfCnpj,mobilePhone,externalReference:userId,apiKey:key});
  await pool.query("update sandbox_pix_demos set provider_customer_id=$2 where id=$1",[id,customerId]);
  const payment=await createSandboxPixPayment({customer:customerId,externalReference:id,apiKey:key});
  await pool.query("update sandbox_pix_demos set provider_payment_id=$2,status='pending' where id=$1",[id,payment.paymentId]);
  const qr=await getSandboxPixQr(payment.paymentId,key);
  res.status(201).json({orderId:id,userId,amountCents:500,environment:"sandbox",status:"pending",...qr});
 }catch(e){
  // Preserve any provider IDs for reconciliation; do not create raffle entries.
  console.error("Pix demonstration setup failed",e.status||e.message);
  await pool.query("update sandbox_pix_demos set status='failed' where id=$1 and provider_payment_id is null",[id]).catch(()=>{});
  error(res,502,"Não foi possível gerar o Pix Sandbox. Verifique a configuração e tente novamente.");
 }
});
// Read-only Sandbox Pix ledger. Never returns payer identity or secrets.
app.get("/api/admin/pix-demo/orders",requireSecureAdminSetup,sessionAdmin,async(req,res,next)=>{
 try{
  const q=await pool.query(
   "select id,status,amount_cents,created_at,paid_at,provider_payment_id is not null as has_payment,provider_customer_id is not null as has_customer "+
   "from sandbox_pix_demos order by created_at desc limit 50");
  res.set("Cache-Control","no-store");
  res.json({orders:q.rows,environment:"sandbox",purchasesEnabled:false});
 }catch(e){next(e)}
});
// Recover a missing payment identifier without creating another charge.
app.post("/api/admin/pix-demo/:id/reconcile",requireSecureAdminSetup,sessionAdmin,async(req,res,next)=>{
 if(!uuid(req.params.id))return error(res,400,"Pedido inválido");
 if(process.env.ASAAS_ENV!=="sandbox")return error(res,503,"Conciliação disponível somente no Sandbox");
 try{
  const q=await pool.query("select id,external_reference,provider_payment_id,status,amount_cents from sandbox_pix_demos where id=$1",[req.params.id]);
  if(!q.rowCount)return error(res,404,"Cobrança Sandbox não encontrada");
  const row=q.rows[0];
  const key=(await getAsaasSettings(pool,"sandbox"))?.apiKey;
  if(!key)return error(res,503,"Sandbox desconectado");
  let providerId=row.provider_payment_id;
  if(!providerId){
   const matches=await findSandboxPixPaymentsByReference(row.external_reference,key);
   const valid=matches.filter(p=>p.billingType==="PIX"&&Number(p.value)===row.amount_cents/100);
   if(valid.length!==1)return res.status(409).json({
    error:valid.length?"Mais de uma cobrança correspondente. Exige revisão manual.":"Nenhuma cobrança correspondente encontrada no Asaas.",
    orderId:row.id,matchingPayments:valid.length,createdNewPayment:false});
   providerId=valid[0].id;
   await pool.query("update sandbox_pix_demos set provider_payment_id=$2 where id=$1 and provider_payment_id is null",[row.id,providerId]);
  }
  const payment=await getSandboxPixPayment(providerId,key);
  const status=String(payment.status||"");
  const localStatus=["RECEIVED","CONFIRMED"].includes(status)?"paid":
   ["REFUNDED","REFUND_REQUESTED"].includes(status)?"refunded":
   ["DELETED","OVERDUE"].includes(status)?"cancelled":"pending";
  await pool.query(
   "update sandbox_pix_demos set status=$2,paid_at=case when $2='paid' then coalesce(paid_at,now()) else paid_at end "+
   "where id=$1 and status not in ('refunded') and (status<>'paid' or $2 in ('paid','refunded'))",
   [row.id,localStatus]);
  const verified=await pool.query("select status,provider_payment_id from sandbox_pix_demos where id=$1",[row.id]);
  res.set("Cache-Control","no-store");
  res.json({orderId:row.id,status:verified.rows[0].status,providerStatus:status,
   recoveredPaymentId:Boolean(verified.rows[0].provider_payment_id),createdNewPayment:false});
 }catch(e){console.error("Pix Sandbox reconcile failed",e.status||e.message);next(e)}
});
app.get("/api/admin/pix-demo/recent",requireSecureAdminSetup,sessionAdmin,async(req,res,next)=>{
 try{
  const q=await pool.query("select id,provider_payment_id,status,created_at from sandbox_pix_demos where provider_payment_id is not null order by created_at desc limit 1");
  if(!q.rowCount)return error(res,404,"Nenhum Pix Sandbox para recuperar");
  const p=q.rows[0];
  const key=(await getAsaasSettings(pool,"sandbox"))?.apiKey;
  if(!key)return error(res,503,"Sandbox não configurado");
  const qr=await getSandboxPixQr(p.provider_payment_id,key);
  const provider=await getSandboxPixPayment(p.provider_payment_id,key);
  res.set("Cache-Control","no-store");
  res.json({orderId:p.id,status:p.status,providerStatus:provider.status,amountCents:500,environment:"sandbox",...qr});
 }catch(e){next(e)}
});
app.get("/api/admin/pix-demo/:id",requireSecureAdminSetup,sessionAdmin,async(req,res,next)=>{
 if(!uuid(req.params.id))return error(res,400,"Pedido inválido");
 try{
  const q=await pool.query("select id,user_id,provider_payment_id,status,amount_cents from sandbox_pix_demos where id=$1",[req.params.id]);
  if(!q.rowCount)return error(res,404,"Pedido não encontrado");
  const order=q.rows[0];
  if(!order.provider_payment_id)return res.json({orderId:order.id,status:order.status,amountCents:order.amount_cents});
  const key=(await getAsaasSettings(pool,"sandbox"))?.apiKey;
  if(!key)return error(res,503,"Sandbox desconectado");
  const payment=await getSandboxPixPayment(order.provider_payment_id,key);
  if(["RECEIVED","CONFIRMED"].includes(payment.status)&&order.status!=="paid"){
   await pool.query("update sandbox_pix_demos set status='paid',paid_at=coalesce(paid_at,now()) where id=$1 and status in ('pending','created')",[order.id]);
  }
  const current=await pool.query("select status from sandbox_pix_demos where id=$1",[order.id]);
  res.json({orderId:order.id,status:current.rows[0].status,providerStatus:payment.status,amountCents:order.amount_cents});
 }catch(e){next(e)}
});

// Receive commercial payment events only; never allocate campaign numbers via payment events.
// Only a staging administrator can create a standalone commercial sale checkout.
// There is intentionally no route from campaign numbers to this API.
app.post("/api/admin/commercial-checkouts",auth,async(req,res,next)=>{
 const {organizerId,description,amountCents,saleType}=req.body||{};
 if(!uuid(organizerId)||!["product","service"].includes(saleType)||typeof description!=="string"||description.trim().length<4||
   description.trim().length>120||!Number.isSafeInteger(amountCents)||amountCents<100||amountCents>100000000)
   return error(res,400,"Dados comerciais inválidos");
 const {COMMERCIAL_CHECKOUT_RETURN_BASE:base}=process.env;
 if(!base||!/^https:\/\//.test(base))return error(res,503,"Callback HTTPS não configurado");
 let orderId=null;
 try{
  const environment=await getActiveAsaasEnvironment(pool);
  const providerSettings=await getAsaasSettings(pool,environment);
  if(!providerSettings)return error(res,409,"Configure as credenciais do ambiente "+environment+" antes de criar cobranças comerciais.");
  // Prod requires validated credentials and an independent webhook.
  const result=await pool.query("insert into commercial_orders(organizer_id,description,amount_cents,external_reference,provider,status,provider_environment,sale_type) select id,$2,$3,$4,'asaas','created',$5,$6 from organizers where id=$1 returning id,external_reference",[
   organizerId,description.trim(),amountCents,randomUUID(),environment,saleType
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
  const checkout=await createCommercialCheckout({externalReference,title:description.trim(),amountCents,...callbacks,
   apiKey:providerSettings.apiKey,environment});
  await pool.query("update commercial_orders set provider_checkout_id=$2,status='pending' where id=$1",[orderId,checkout.checkoutId]);
  res.status(201).json({orderId,checkoutUrl:checkout.checkoutUrl,checkoutId:checkout.checkoutId,environment,saleType,paid:false});
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
  const r=await pool.query("select id,description,amount_cents,status,provider_checkout_id,provider_environment,sale_type,created_at,paid_at from commercial_orders where id=$1",[req.params.id]);
  if(!r.rowCount)return error(res,404,"Order not found");
  res.json({order:r.rows[0]});
 }catch(e){next(e)}
});
// Persist Asaas webhook events using provider IDs for idempotency.
// Only CHECKOUT_PAID updates a commercial order, never raffle numbers.
async function processAsaasWebhook(req,res,next,environment){
 let providerSettings;
 try{providerSettings=await getAsaasSettings(pool,environment)}catch(e){return next(e)}
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
    "select id from commercial_orders where provider_checkout_id=$1 and provider_environment=$2 for update":
    "select id from commercial_orders where provider_payment_id=$1 and provider_environment=$2 for update";
   const found=await client.query(orderQuery,[checkoutId||paymentId,environment]);
   // Unknown events are saved and acknowledged; never grant access or entries.
   const id=found.rows[0]?.id||null;
   const inserted=await client.query(
    "insert into payment_events(provider,provider_event_id,commercial_order_id,payload) values($1,$2,$3,$4) on conflict(provider,provider_event_id) do nothing returning id",
    [environment==="sandbox"?"asaas":"asaas_production",evt.id,id,JSON.stringify(evt)]);
   if(inserted.rowCount&&paymentId&&environment==="sandbox"){
     const demo=await client.query("select id from sandbox_pix_demos where provider_payment_id=$1 for update",[paymentId]);
     if(demo.rowCount){
       const did=demo.rows[0].id;
       if(["PAYMENT_RECEIVED","PAYMENT_CONFIRMED"].includes(evt.event))
         await client.query("update sandbox_pix_demos set status='paid',paid_at=coalesce(paid_at,now()) where id=$1 and status in ('pending','created')",[did]);
       else if(evt.event==="PAYMENT_REFUNDED")
         await client.query("update sandbox_pix_demos set status='refunded' where id=$1 and status='paid'",[did]);
       else if(["PAYMENT_DELETED","PAYMENT_OVERDUE"].includes(evt.event))
         await client.query("update sandbox_pix_demos set status='cancelled' where id=$1 and status in ('pending','created')",[did]);
     }
   }
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
}
app.post("/api/webhooks/asaas",(req,res,next)=>processAsaasWebhook(req,res,next,"sandbox"));
app.post("/api/webhooks/asaas/production",(req,res,next)=>processAsaasWebhook(req,res,next,"production"));
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
