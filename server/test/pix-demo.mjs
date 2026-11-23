import assert from "node:assert/strict";
import {createSandboxPixCustomer,createSandboxPixPayment,getSandboxPixQr,getSandboxPixPayment} from "../src/asaas.js";
process.env.ASAAS_ENV="sandbox";
const original=globalThis.fetch;
const seen=[];
globalThis.fetch=async(url,options)=>{
 seen.push({url,method:options.method||"GET",body:options.body?JSON.parse(options.body):null});
 const path=new URL(url).pathname;
 const payload=path==="/v3/customers"?{id:"cus_1234567890"}:
 path==="/v3/payments"&&options.method==="POST"?{id:"pay_1234567890",status:"PENDING"}:
 path==="/v3/payments/pay_1234567890/pixQrCode"?{encodedImage:"aGVsbG8=",payload:"000201sandboxdemo",expirationDate:"2026-11-25"}:
 path==="/v3/payments/pay_1234567890"?{id:"pay_1234567890",status:"PENDING"}:null;
 if(!payload)throw Error("Unexpected API call: "+path);
 return {ok:true,status:200,json:async()=>payload};
};
try{
 const customer=await createSandboxPixCustomer({name:"Cliente de Teste",cpfCnpj:"00000000000",mobilePhone:"21999999999",externalReference:"demo-test",apiKey:"sandbox-test-key"});
 assert.equal(customer,"cus_1234567890");
 const pay=await createSandboxPixPayment({customer,externalReference:"demo-order",apiKey:"sandbox-test-key"});
 assert.equal(pay.paymentId,"pay_1234567890");
 assert.equal(seen[1].body.billingType,"PIX");
 assert.equal(seen[1].body.value,5);
 assert.equal(seen[1].body.externalReference,"demo-order");
 const qr=await getSandboxPixQr(pay.paymentId,"sandbox-test-key");
 assert.equal(qr.payload,"000201sandboxdemo");
 assert.ok(qr.encodedImage);
 assert.equal((await getSandboxPixPayment(pay.paymentId,"sandbox-test-key")).status,"PENDING");
 assert.equal(seen.length,4);
 assert.ok(seen.every(item=>item.url.startsWith("https://api-sandbox.asaas.com/v3/")));
 console.log("Pix Sandbox customer/payment/QR/status contract: OK");
}finally{globalThis.fetch=original}
