// Asaas Checkout: sandbox-only adapter for legitimate commercial orders.
// Campaign entries and numbered prize draws MUST NOT use this module.
import { timingSafeEqual } from "node:crypto";
const API = "https://api-sandbox.asaas.com/v3";
const CHECKOUT_BASE = "https://asaas.com/checkoutSession/show?id=";

function settings(apiKeyOverride) {
  if(process.env.ASAAS_ENV !== "sandbox") throw Error("Only Asaas sandbox is enabled");
  if(!(apiKeyOverride||process.env.ASAAS_API_KEY)) throw Error("ASAAS_API_KEY not configured");
  return {"accept":"application/json","content-type":"application/json","access_token":apiKeyOverride||process.env.ASAAS_API_KEY,"User-Agent":"AcoesPlatform/0.2.0"};
}
async function request(path,opts={},apiKeyOverride) {
  const response=await fetch(API+path,{
    ...opts,headers:{...settings(apiKeyOverride),...(opts.headers||{})},
    signal:AbortSignal.timeout(12000)
  });
  const data=await response.json().catch(()=>null);
  if(!response.ok){
    const err=Error("Asaas request rejected");
    err.status=response.status;err.reason=data?.errors?.[0]?.description||null;
    throw err;
  }
  return data;
}
export async function verifyAsaasConnection(apiKeyOverride){
  if(!(apiKeyOverride||process.env.ASAAS_API_KEY))return {configured:false,connected:false,environment:"sandbox"};
  try {await request("/myAccount/status/",{},apiKeyOverride);return {configured:true,connected:true,environment:"sandbox"}}
  catch(e){return {configured:true,connected:false,environment:"sandbox",httpStatus:e.status||null}}
}
// Diagnostic-only: test production credentials without creating any charge.
export async function verifyAsaasProductionConnection(apiKey){
 if(typeof apiKey!=="string"||!apiKey)return {configured:false,connected:false,environment:"production"};
 try{
  const response=await fetch("https://api.asaas.com/v3/myAccount/status/",{headers:{"accept":"application/json","access_token":apiKey,"User-Agent":"AcoesPlatform/0.3.0"},signal:AbortSignal.timeout(12000)});
  return {configured:true,connected:response.ok,environment:"production",...(response.ok?{}:{httpStatus:response.status})};
 }catch{return {configured:true,connected:false,environment:"production"}}
}
export async function createCommercialCheckout({externalReference,title,amountCents,successUrl,cancelUrl,expiredUrl,apiKey}){
 if(!/^[a-zA-Z0-9-]{12,200}$/.test(externalReference))throw Error("Invalid order reference");
 if(typeof title!=="string"||title.trim().length<4||title.length>120)throw Error("Invalid order title");
 if(!Number.isSafeInteger(amountCents)||amountCents<100)throw Error("Invalid commercial amount");
 for(const url of [successUrl,cancelUrl,expiredUrl]){
   const parsed=new URL(url);
   if(parsed.protocol!=="https:"&&parsed.hostname!=="localhost")throw Error("Checkout callbacks must use HTTPS");
 }
 const data=await request("/checkouts",{method:"POST",body:JSON.stringify({
  billingTypes:["PIX"],
  chargeTypes:["DETACHED"],
  minutesToExpire:10,
  externalReference,
  callback:{successUrl,cancelUrl,expiredUrl},
  items:[{name:title.trim(),description:"Pedido comercial independente de qualquer sorteio",quantity:1,value:amountCents/100}]
 })},apiKey);
 if(typeof data?.id!=="string"||!/^[0-9a-z-]{12,120}$/i.test(data.id))throw Error("Asaas returned unexpected checkout id");
 return {checkoutId:data.id,checkoutUrl:CHECKOUT_BASE+encodeURIComponent(data.id),environment:"sandbox"};
}
export function verifyAsaasWebhookToken(supplied,tokenOverride){
 const secret=tokenOverride||process.env.ASAAS_WEBHOOK_TOKEN;
 if(!secret||secret.length<32||typeof supplied!=="string")return false;
 const a=Buffer.from(secret),b=Buffer.from(supplied);
 return a.length===b.length&&timingSafeEqual(a,b);
}
