// Asaas Checkout: sandbox-only adapter for legitimate commercial orders.
// Campaign entries and numbered prize draws MUST NOT use this module.
import { timingSafeEqual } from "node:crypto";
const API = "https://api-sandbox.asaas.com/v3";
const CHECKOUT_BASE = "https://sandbox.asaas.com/checkoutSession/show/";

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
  minutesToExpire:60,
  externalReference,
  callback:{successUrl,cancelUrl,expiredUrl},
  items:[{name:title.trim().slice(0,30),description:title.trim(),quantity:1,value:amountCents/100}]
 })},apiKey);
 if(typeof data?.id!=="string"||!/^[0-9a-z-]{12,120}$/i.test(data.id))throw Error("Asaas returned unexpected checkout id");
 return {checkoutId:data.id,checkoutUrl:CHECKOUT_BASE+encodeURIComponent(data.id),environment:"sandbox"};
}
// Admin-only Sandbox Pix demonstration. Never connected to campaign entries.
export async function createSandboxPixCustomer({name,cpfCnpj,mobilePhone,externalReference,apiKey}){
 const data=await request("/customers",{method:"POST",body:JSON.stringify({
  name,cpfCnpj,mobilePhone,externalReference,notificationDisabled:true
 })},apiKey);
 if(!/^cus_[a-zA-Z0-9]+$/.test(data?.id||""))throw Error("Asaas returned unexpected customer id");
 return data.id;
}
export async function createSandboxPixPayment({customer,externalReference,apiKey}){
 const dueDate=new Intl.DateTimeFormat("sv-SE",{timeZone:"America/Sao_Paulo",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
 const data=await request("/payments",{method:"POST",body:JSON.stringify({
  customer,billingType:"PIX",value:5,dueDate,
  externalReference,description:"AÇÕES — demonstração técnica Pix Sandbox, sem participação em sorteio"
 })},apiKey);
 if(typeof data?.id!=="string"||!/^pay_[a-zA-Z0-9_]{4,100}$/.test(data.id))throw Error("Asaas returned unexpected payment id");
 return {paymentId:data.id,status:data.status};
}
// Read-only reconciliation: never creates a new payment.
export async function findSandboxPixPaymentsByReference(externalReference,apiKey){
 if(typeof externalReference!=="string"||!/^[0-9a-f-]{36}$/i.test(externalReference))throw Error("Invalid order reference");
 const data=await request("/payments?externalReference="+encodeURIComponent(externalReference)+"&limit=20",{},apiKey);
 if(!Array.isArray(data?.data))throw Error("Invalid payment search response");
 return data.data.filter(p=>p?.externalReference===externalReference &&
  typeof p.id==="string"&&/^pay_[A-Za-z0-9_]{4,100}$/.test(p.id))
  .map(p=>({id:p.id,status:p.status,externalReference:p.externalReference,value:p.value,billingType:p.billingType}));
}
export async function getSandboxPixQr(paymentId,apiKey){
 if(!/^pay_[a-zA-Z0-9_]{4,100}$/.test(paymentId))throw Error("Invalid payment id");
 const data=await request("/payments/"+encodeURIComponent(paymentId)+"/pixQrCode",{},apiKey);
 if(typeof data?.payload!=="string"||data.payload.length>3000||!/^[A-Za-z0-9+/=]+$/.test(data?.encodedImage||"")||data.encodedImage.length>300000)throw Error("Asaas returned invalid Pix QR data");
 return {payload:data.payload,encodedImage:data.encodedImage,expirationDate:data.expirationDate||null};
}
export async function getSandboxPixPayment(paymentId,apiKey){
 if(!/^pay_[a-zA-Z0-9_]{4,100}$/.test(paymentId))throw Error("Invalid payment id");
 const data=await request("/payments/"+encodeURIComponent(paymentId),{},apiKey);
 return {status:data.status,id:data.id};
}

export function verifyAsaasWebhookToken(supplied,tokenOverride){
 const secret=tokenOverride||process.env.ASAAS_WEBHOOK_TOKEN;
 if(!secret||secret.length<32||typeof supplied!=="string")return false;
 const a=Buffer.from(secret),b=Buffer.from(supplied);
 return a.length===b.length&&timingSafeEqual(a,b);
}
