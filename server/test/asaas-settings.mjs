import assert from "node:assert/strict";
import {randomBytes} from "node:crypto";
import {getAsaasSettings,saveAsaasSettings,deleteAsaasSettings,validateAsaasSandboxSettings,validateAsaasSettings,getActiveAsaasEnvironment,setActiveAsaasEnvironment} from "../src/asaas-settings.js";

process.env.PROVIDER_SETTINGS_ENCRYPTION_KEY=randomBytes(32).toString("hex");
const rows=new Map();
let selected="sandbox";
const pool={async query(sql,args){
 if(sql.startsWith("insert into payment_provider_mode")){selected=args[0];return {rows:[{active_environment:selected,updated_at:new Date()}],rowCount:1};}
 if(sql.startsWith("select active_environment from payment_provider_mode"))return {rows:[{active_environment:selected}],rowCount:1};
 if(sql.startsWith("insert into payment_provider_settings")){
  rows.set(args[0],args[1]);return {rows:[{updated_at:new Date()}],rowCount:1};
 }
 if(sql.startsWith("select credential_ciphertext")){
  const value=rows.get(args[0]);
  return value?{rows:[{credential_ciphertext:value,updated_at:new Date()}],rowCount:1}:{rows:[],rowCount:0};
 }
 if(sql.startsWith("delete from payment_provider_settings")){
  rows.delete(args[0]);return {rows:[],rowCount:1};
 }
 throw Error("Unexpected query "+sql);
}};
assert.equal(validateAsaasSandboxSettings({apiKey:"test_access_token_long",webhookToken:"a".repeat(32)}),null);
assert.notEqual(validateAsaasSandboxSettings({apiKey:"x",webhookToken:"a".repeat(32)}),null);
await saveAsaasSettings(pool,{apiKey:"test_access_token_long",webhookToken:"b".repeat(32)});
const stored=rows.get("asaas_sandbox");
assert.ok(!stored.includes("test_access_token_long"));
assert.ok(!stored.includes("b".repeat(32)));
const restored=await getAsaasSettings(pool);
assert.equal(restored.apiKey,"test_access_token_long");
assert.equal(restored.webhookToken,"b".repeat(32));
await deleteAsaasSettings(pool);
assert.equal(await getAsaasSettings(pool),null);
console.log("Encrypted Asaas sandbox settings checks passed");

assert.equal(validateAsaasSettings({apiKey:"prod_api_key_long_enough",webhookToken:"c".repeat(32)},"production"),null);
await saveAsaasSettings(pool,{apiKey:"production_key_separate",webhookToken:"c".repeat(32)},"production");
const prod=await getAsaasSettings(pool,"production");
assert.equal(prod.apiKey,"production_key_separate");
assert.equal(await getAsaasSettings(pool,"sandbox"),null);
await setActiveAsaasEnvironment(pool,"production");
assert.equal(await getActiveAsaasEnvironment(pool),"production");
await deleteAsaasSettings(pool,"production");
assert.equal(await getAsaasSettings(pool,"production"),null);
console.log("Production and sandbox credentials verified as isolated");
