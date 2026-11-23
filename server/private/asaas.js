"use strict";
const $=selector=>document.querySelector(selector);
const button=selector=>$(selector);
const webhookUrl=location.origin+"/api/webhooks/asaas";
$("#webhookUrl").textContent=webhookUrl;
function status(message,good=false){const p=$("#message");p.textContent=message;p.className=good?"good":"error"}
function authHeader(){const value=$("#adminKey").value.trim();if(!value)throw Error("Informe a chave administrativa.");return {"Authorization":"Bearer "+value};}
async function call(method,path,body){
 const response=await fetch(path,{method,headers:{"accept":"application/json",...authHeader(),...(body?{"Content-Type":"application/json"}:{})},...(body?{body:JSON.stringify(body)}:{}),cache:"no-store"});
 const result=await response.json().catch(()=>({}));
 if(!response.ok)throw Error(result.error||"Erro HTTP "+response.status);
 return result;
}
async function runCheck(){
 try{button("#check").disabled=true;const result=await call("GET","/api/admin/asaas/status");
 $("#connection").textContent=result.connected?"Sandbox conectado":result.configured?"Falha de autenticação":"Não configurado";
 status(result.connected?"Conexão validada com o Asaas Sandbox.":"Nenhuma conexão ativa foi confirmada.",result.connected);
 }catch(e){status(e.message)}finally{button("#check").disabled=false}
}
$("#configForm").addEventListener("submit",async e=>{
 e.preventDefault();
 const apiKey=$("#apiKey").value.trim(),webhookToken=$("#webhookToken").value.trim();
 if(webhookToken.length<32||webhookToken.length>255||/\s/.test(webhookToken))return status("Token de webhook inválido.");
 const submit=$('button[type="submit"]');submit.disabled=true;
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
