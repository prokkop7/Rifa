import {createCipheriv,createDecipheriv,randomBytes} from "node:crypto";
const PROVIDER_ID="asaas_sandbox";
function encryptionKey(){
 const hex=process.env.PROVIDER_SETTINGS_ENCRYPTION_KEY;
 if(!/^[0-9a-f]{64}$/i.test(hex||""))throw Error("PROVIDER_SETTINGS_ENCRYPTION_KEY must be 32 bytes in hex");
 return Buffer.from(hex,"hex");
}
function seal(value){
 const iv=randomBytes(12),cipher=createCipheriv("aes-256-gcm",encryptionKey(),iv);
 const bytes=Buffer.concat([cipher.update(JSON.stringify(value),"utf8"),cipher.final()]);
 return [iv.toString("base64url"),cipher.getAuthTag().toString("base64url"),bytes.toString("base64url")].join(".");
}
function unseal(ciphertext){
 const fields=ciphertext.split(".");
 if(fields.length!==3)throw Error("Invalid provider settings");
 const [iv,tag,bytes]=fields.map(x=>Buffer.from(x,"base64url"));
 const decipher=createDecipheriv("aes-256-gcm",encryptionKey(),iv);
 decipher.setAuthTag(tag);
 return JSON.parse(Buffer.concat([decipher.update(bytes),decipher.final()]).toString("utf8"));
}
export async function getAsaasSettings(pool){
 const r=await pool.query("select credential_ciphertext,updated_at from payment_provider_settings where id=$1",[PROVIDER_ID]);
 if(!r.rowCount)return null;
 const data=unseal(r.rows[0].credential_ciphertext);
 return {apiKey:data.apiKey,webhookToken:data.webhookToken,updatedAt:r.rows[0].updated_at};
}
export async function saveAsaasSettings(pool,{apiKey,webhookToken}){
 const encrypted=seal({apiKey,webhookToken});
 const r=await pool.query("insert into payment_provider_settings(id,credential_ciphertext) values($1,$2) on conflict (id) do update set credential_ciphertext=excluded.credential_ciphertext,updated_at=now() returning updated_at",[PROVIDER_ID,encrypted]);
 return {configured:true,environment:"sandbox",updatedAt:r.rows[0].updated_at};
}
export async function deleteAsaasSettings(pool){
 await pool.query("delete from payment_provider_settings where id=$1",[PROVIDER_ID]);
 return {configured:false,environment:"sandbox"};
}
export function validateAsaasSandboxSettings(payload){
 if(typeof payload?.apiKey!=="string"||payload.apiKey.length<16||payload.apiKey.length>1024||/\s/.test(payload.apiKey))return "Chave API Sandbox inválida";
 if(typeof payload.webhookToken!=="string"||payload.webhookToken.length<32||payload.webhookToken.length>255||/\s/.test(payload.webhookToken))return "Token webhook deve ter 32–255 caracteres, sem espaços";
 return null;
}
