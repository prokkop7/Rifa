"use strict";
const $=selector=>document.querySelector(selector);
const webhookUrl=location.origin+"/api/webhooks/asaas";
$("#webhookUrl").textContent=webhookUrl;
function status(message,good=false){const p=$("#message");p.textContent=message;p.className=good?"good":"error"}
function signedIn(on){$("#loginForm").hidden=on;$("#secureSettings").hidden=!on;document.querySelectorAll("[data-auth-only]").forEach(el=>el.hidden=!on);}
async function call(method,path,body){
 const response=await fetch(path,{method,headers:{"accept":"application/json",...(body?{"Content-Type":"application/json"}:{})},...(body?{body:JSON.stringify(body)}:{}),credentials:"same-origin",cache:"no-store"});
 const result=await response.json().catch(()=>({}));
 if(!response.ok)throw Error(result.error||"Erro HTTP "+response.status);
 return result;
}
async function checkSession(){try{await call("GET","/api/admin/asaas/session");signedIn(true);await runCheck()}catch{signedIn(false)}}
async function runCheck(){
 const button=$("#check");button.disabled=true;
 try{
  const result=await call("GET","/api/admin/asaas/status");
  $("#connection").textContent=result.connected?"Sandbox conectado":result.configured?"Falha de autenticação":"Não configurado";
  status(result.connected?"Conexão validada com o Asaas Sandbox.":"Nenhuma conexão ativa foi confirmada.",result.connected);
 }catch(e){status(e.message)}finally{button.disabled=false}
}
$("#loginForm").addEventListener("submit",async e=>{
 e.preventDefault();
 const submit=$("#loginForm button[type=submit]");submit.disabled=true;
 try{
  await call("POST","/api/admin/asaas/login",{email:$("#loginEmail").value.trim(),password:$("#loginPassword").value});
  $("#loginPassword").value="";
  signedIn(true);status("Acesso administrativo autorizado.",true);await runCheck();
 }catch(e){status(e.message)}finally{submit.disabled=false}
});
$("#logout").addEventListener("click",async()=>{
 try{await call("POST","/api/admin/asaas/logout",{});signedIn(false);status("Sessão encerrada.",true)}
 catch(e){status(e.message)}
});
$("#configForm").addEventListener("submit",async e=>{
 e.preventDefault();
 const apiKey=$("#apiKey").value.trim(),webhookToken=$("#webhookToken").value.trim();
 if(webhookToken.length<32||webhookToken.length>255||/\s/.test(webhookToken))return status("Token de webhook inválido.");
 const submit=$("#configForm button[type=submit]");submit.disabled=true;
 try{
  const result=await call("POST","/api/admin/asaas/config",{apiKey,webhookToken});
  $("#connection").textContent=result.connected?"Sandbox conectado":"Conexão pendente";
  $("#apiKey").value="";$("#webhookToken").value="";
  status("Credenciais validadas e salvas com criptografia no servidor.",true);
 }catch(e){status(e.message)}finally{submit.disabled=false}
});
$("#check").addEventListener("click",runCheck);
$("#remove").addEventListener("click",async()=>{
 if(!confirm("Desconectar o Asaas Sandbox desta instalação?"))return;
 try{await call("DELETE","/api/admin/asaas/config");$("#connection").textContent="Não configurado";status("Credenciais removidas.",true)}catch(e){status(e.message)}
});
$("#copyUrl").addEventListener("click",async()=>{try{await navigator.clipboard.writeText(webhookUrl);status("Endereço copiado.",true)}catch{status("Copie o endereço exibido acima.")}});
checkSession();
