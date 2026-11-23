import assert from "node:assert/strict";
import {createCommercialCheckout} from "../src/asaas.js";
process.env.ASAAS_ENV="sandbox";
const originalFetch=globalThis.fetch,seen=[];
globalThis.fetch=async(url,options)=>{
 seen.push({url,method:options.method,key:options.headers.access_token,body:JSON.parse(options.body)});
 return {ok:true,json:async()=>({id:"a3c5cb0d-853d-4b1f-932c-523aa5ea710d"})};
};
const checkout={
 externalReference:"2e7866db-40e6-448a-935e-d4dc5d6a3acd",
 title:"Licenca comercial de software",
 amountCents:10900,
 successUrl:"https://example.org/success",
 cancelUrl:"https://example.org/cancel",
 expiredUrl:"https://example.org/expired"
};
try{
 const sandbox=await createCommercialCheckout({...checkout,apiKey:"mock-sandbox-key",environment:"sandbox"});
 const production=await createCommercialCheckout({...checkout,apiKey:"mock-production-key",environment:"production"});
 assert.equal(seen.length,2);
 assert.equal(seen[0].url,"https://api-sandbox.asaas.com/v3/checkouts");
 assert.equal(seen[1].url,"https://api.asaas.com/v3/checkouts");
 assert.equal(seen[0].key,"mock-sandbox-key");
 assert.equal(seen[1].key,"mock-production-key");
 assert.equal(seen[0].body.items[0].value,109);
 assert.equal(sandbox.environment,"sandbox");
 assert.equal(production.environment,"production");
 assert.ok(production.checkoutUrl.startsWith("https://asaas.com/checkoutSession/show?id="));
 await assert.rejects(()=>createCommercialCheckout({...checkout,environment:"production"}),/Explicit production credentials required/);
 console.log("Production & Sandbox checkout routing verified with mocks; no actual charge created");
}finally{globalThis.fetch=originalFetch}
