import {createCipheriv,createDecipheriv,randomBytes} from "node:crypto";
const ids={sandbox:"asaas_sandbox",production:"asaas_production"};
function providerId(environment){if(!Object.hasOwn(ids,environment))throw Error("Invalid provider environment");return ids[environment]}
function encryptionKey(){
 const hex=process.env.PROVIDER_SETTINGS_ENCRYPTION_KEY;
 if(!/^[0-9a-f]{64}$/i.test(hex||""))throw Error("PROVIDER_SETTINGS_ENCRYPTION_KEY must be 32 bytes in hex");
 return Buffer.from(hex,"hex");
}
export function seal(value){
 const iv=randomBytes(12),cipher=createCipheriv("aes-256-gcm",encryptionKey(),iv);
 const bytes=Buffer.concat([cipher.update(JSON.stringify(value),"utf8"),cipher.final()]);
 return [iv.toString("base64url"),cipher.getAuthTag().toString("base64url"),bytes.toString("base64url")].join(".");
}
export function unseal(ciphertext){
 const fields=ciphertext.split(".");
 if(fields.length!==3)throw Error("Invalid provider settings");
 const [iv,tag,bytes]=fields.map(x=>Buffer.from(x,"base64url"));
 const decipher=createDecipheriv("aes-256-gcm",encryptionKey(),iv);
 decipher.setAuthTag(tag);
 return JSON.parse(Buffer.concat([decipher.update(bytes),decipher.final()]).toString("utf8"));
}
export async function getAsaasSettings(pool,environment="sandbox"){
 const r=await pool.query("select credential_ciphertext,updated_at from payment_provider_settings where id=$1",[providerId(environment)]);
 if(!r.rowCount)return null;
 const data=unseal(r.rows[0].credential_ciphertext);
 return {apiKey:data.apiKey,webhookToken:data.webhookToken,updatedAt:r.rows[0].updated_at};
}
export async function saveAsaasSettings(pool,{apiKey,webhookToken},environment="sandbox"){
 const encrypted=seal({apiKey,webhookToken});
 const r=await pool.query("insert into payment_provider_settings(id,credential_ciphertext) values($1,$2) on conflict (id) do update set credential_ciphertext=excluded.credential_ciphertext,updated_at=now() returning updated_at",[providerId(environment),encrypted]);
 return {configured:true,environment,updatedAt:r.rows[0].updated_at};
}
export async function deleteAsaasSettings(pool,environment="sandbox"){
 await pool.query("delete from payment_provider_settings where id=$1",[providerId(environment)]);
 return {configured:false,environment};
}
export function validateAsaasSettings(payload,environment="sandbox"){
 providerId(environment);
 if(typeof payload?.apiKey!=="string"||payload.apiKey.length<16||payload.apiKey.length>1024||/\s/.test(payload.apiKey))return "Chave API "+environment+" inválida";
 if(typeof payload.webhookToken!=="string"||payload.webhookToken.length<32||payload.webhookToken.length>255||/\s/.test(payload.webhookToken))return "Token webhook deve ter 32–255 caracteres, sem espaços";
 return null;
}

export const validateAsaasSandboxSettings=payload=>validateAsaasSettings(payload,"sandbox");
export async function getActiveAsaasEnvironment(pool){const r=await pool.query("select active_environment from payment_provider_mode where id='asaas'");return r.rows[0]?.active_environment||"sandbox"}
export async function setActiveAsaasEnvironment(pool,environment){providerId(environment);const r=await pool.query("insert into payment_provider_mode(id,active_environment) values('asaas',$1) on conflict(id) do update set active_environment=excluded.active_environment,updated_at=now() returning active_environment,updated_at",[environment]);return {activeEnvironment:r.rows[0].active_environment,updatedAt:r.rows[0].updated_at,paymentsEnabled:false}}
