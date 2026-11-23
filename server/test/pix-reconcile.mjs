import assert from "node:assert/strict";
import {findSandboxPixPaymentsByReference} from "../src/asaas.js";
process.env.ASAAS_ENV="sandbox";
const ref="f50008e8-24d6-4e8f-b1a2-e9c20e4d7ef9";
const original=globalThis.fetch;
let requests=0;
globalThis.fetch=async(url,options)=>{
 requests++;
 assert.equal(options.method||"GET","GET");
 assert.equal(new URL(url).pathname,"/v3/payments");
 assert.equal(new URL(url).searchParams.get("externalReference"),ref);
 return {ok:true,json:async()=>({data:[
  {id:"pay_080225913252_abc",status:"PENDING",externalReference:ref,value:5,billingType:"PIX"},
  {id:"pay_ignored",status:"PENDING",externalReference:"another-reference",value:5,billingType:"PIX"}
 ]})};
};
try{
 const found=await findSandboxPixPaymentsByReference(ref,"test-key");
 assert.equal(found.length,1);
 assert.equal(found[0].id,"pay_080225913252_abc");
 assert.equal(found[0].billingType,"PIX");
 assert.equal(requests,1);
 console.log("Read-only Sandbox payment reconciliation lookup contract: OK");
}finally{globalThis.fetch=original}
