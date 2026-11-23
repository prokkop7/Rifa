// Asaas connection adapter: sandbox-only configuration for safe setup.
// No campaign checkout or payment creation here.
const SANDBOX="https://api-sandbox.asaas.com/v3";
export async function verifyAsaasConnection(){
 const key=process.env.ASAAS_API_KEY;
 if(!key) return {configured:false,connected:false,environment:"sandbox"};
 if(process.env.ASAAS_ENV!=="sandbox") throw Error("Asaas production is not enabled in this adapter");
 const response=await fetch(SANDBOX+"/myAccount/status/",{
  headers:{"accept":"application/json","access_token":key,"User-Agent":"AcoesPlatform/0.1.0"},
  signal:AbortSignal.timeout(10000)
 });
 if(!response.ok)return {configured:true,connected:false,environment:"sandbox",httpStatus:response.status};
 return {configured:true,connected:true,environment:"sandbox"};
}
export function verifyAsaasWebhookToken(supplied){
 const secret=process.env.ASAAS_WEBHOOK_TOKEN;
 if(!secret || secret.length<32 || typeof supplied!=="string")return false;
 const a=new TextEncoder().encode(secret),b=new TextEncoder().encode(supplied);
 if(a.length!==b.length)return false;
 let diff=0;for(let i=0;i<a.length;i++)diff|=a[i]^b[i];
 return diff===0;
}
