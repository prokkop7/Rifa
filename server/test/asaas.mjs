import assert from "node:assert/strict";
import {createCommercialCheckout,verifyAsaasWebhookToken} from "../src/asaas.js";

process.env.ASAAS_ENV="sandbox";
process.env.ASAAS_API_KEY="test-only-fake-key";
process.env.ASAAS_WEBHOOK_TOKEN="sandbox-test-webhook-token-long-enough-123";
let sent=null;
globalThis.fetch=async(url,opts)=>{
 assert.equal(url,"https://api-sandbox.asaas.com/v3/checkouts");
 assert.equal(opts.headers.access_token,"test-only-fake-key");
 sent=JSON.parse(opts.body);
 return {ok:true,json:async()=>({id:"84997b72-a786-43a1-b8d8-9083c6f8b8e2"})};
};
const result=await createCommercialCheckout({
 externalReference:"5df3077e-8086-4a48-a77d-22710ba04ebd",
 title:"Produto comercial de teste",
 amountCents:5090,
 successUrl:"https://example.org/success",
 cancelUrl:"https://example.org/cancel",
 expiredUrl:"https://example.org/expired"
});
assert.deepEqual(sent.billingTypes,["PIX"]);
assert.deepEqual(sent.chargeTypes,["DETACHED"]);
assert.equal(sent.minutesToExpire,10);
assert.equal(sent.items[0].value,50.9);
assert.equal(result.checkoutId,"84997b72-a786-43a1-b8d8-9083c6f8b8e2");
assert.ok(result.checkoutUrl.includes(result.checkoutId));
assert.equal(verifyAsaasWebhookToken(process.env.ASAAS_WEBHOOK_TOKEN),true);
assert.equal(verifyAsaasWebhookToken("invalid"),false);
await assert.rejects(()=>createCommercialCheckout({
 externalReference:"5df3077e-8086-4a48-a77d-22710ba04ebd",
 title:"Teste",
 amountCents:100,
 successUrl:"http://evil.example/success",
 cancelUrl:"https://example.org/cancel",
 expiredUrl:"https://example.org/expired"
}));
console.log("Sandbox adapter contract checks passed");
