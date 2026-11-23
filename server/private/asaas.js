"use strict";
const $=selector=>document.querySelector(selector);
let currentEnvironment="sandbox",activeEnvironment="sandbox";
const webhookUrl=location.origin+"/api/webhooks/asaas";
$("#webhookUrl").textContent=webhookUrl;
function status(message,good=false){const p=$("#message");p.textContent=message;p.className=good?"good":"error"}
function signedIn(on){$("#loginForm").hidden=on;$("#secureSettings").hidden=!on;document.querySelectorAll("[data-auth-only]").forEach(el=>el.hidden=!on);}
async function call(method,path,body){
 const response=await fetch(path,{method,headers:{"accept":"application/json",...(body?{"Content-Type":"application/json"}:{})},...(body?{body:JSON.stringify(body)}:{}),credentials:"same-origin",cache:"no-store"});
 const result=await response.json().catch(()=>({}));
 if(!response.ok){if(response.status===401&&path!=="/api/admin/asaas/login"&&path!=="/api/admin/asaas/session"){signedIn(false);$("#loginForm").scrollIntoView({behavior:"smooth",block:"center"});status("Sua sessão administrativa expirou. Entre novamente para continuar.");}throw Error(response.status===401&&path!=="/api/admin/asaas/login"?"Sessão encerrada. Faça login novamente.":result.error||"Erro HTTP "+response.status)}
 return result;
}
async function checkSession(){try{await call("GET","/api/admin/asaas/session");signedIn(true);await runCheck();await loadActions()}catch{signedIn(false)}}
function refreshTabs(){document.querySelectorAll("[data-environment]").forEach(btn=>{const selected=btn.dataset.environment===currentEnvironment;btn.classList.toggle("selected",selected);btn.setAttribute("aria-pressed",String(selected))});$("#keyEnvironmentLabel").textContent="Chave de API Asaas "+(currentEnvironment==="sandbox"?"Sandbox":"Produção");$("#activeEnvironment").textContent=activeEnvironment==="sandbox"?"Sandbox":"Produção";$("#activeBadge").textContent="ATIVO: "+activeEnvironment.toUpperCase();$("#apiKey").value="";$("#webhookToken").value="";}
async function runCheck(){
 const button=$("#check");button.disabled=true;
 try{
  const result=await call("GET","/api/admin/asaas/status?environment="+encodeURIComponent(currentEnvironment));
  activeEnvironment=result.activeEnvironment||activeEnvironment;refreshTabs();$("#connection").textContent=result.connected?(currentEnvironment==="sandbox"?"Sandbox conectado":"Produção conectada"):result.configured?"Falha de autenticação":"Não configurado";
  status(result.connected?"Conexão validada no ambiente "+currentEnvironment+".":"Nenhuma conexão ativa confirmada no ambiente "+currentEnvironment+".",result.connected);
 }catch(e){status(e.message)}finally{button.disabled=false}
}
$("#loginForm").addEventListener("submit",async e=>{
 e.preventDefault();
 const submit=$("#loginForm button[type=submit]");submit.disabled=true;
 try{
  await call("POST","/api/admin/asaas/login",{email:$("#loginEmail").value.trim(),password:$("#loginPassword").value});
  $("#loginPassword").value="";
  signedIn(true);status("Acesso administrativo autorizado.",true);await runCheck();await loadActions();
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
  const result=await call("POST","/api/admin/asaas/config",{apiKey,webhookToken,environment:currentEnvironment});
  $("#connection").textContent=result.connected?"Sandbox conectado":"Conexão pendente";
  $("#apiKey").value="";$("#webhookToken").value="";
  status("Credenciais validadas e salvas com criptografia no servidor.",true);
 }catch(e){status(e.message)}finally{submit.disabled=false}
});
$("#check").addEventListener("click",runCheck);
$("#remove").addEventListener("click",async()=>{
 if(!confirm("Desconectar credenciais de "+currentEnvironment+"?"))return;
 try{await call("DELETE","/api/admin/asaas/config?environment="+encodeURIComponent(currentEnvironment));$("#connection").textContent="Não configurado";status("Credenciais de "+currentEnvironment+" removidas.",true)}catch(e){status(e.message)}
});
$("#copyUrl").addEventListener("click",async()=>{try{await navigator.clipboard.writeText(webhookUrl);status("Endereço copiado.",true)}catch{status("Copie o endereço exibido acima.")}});
document.querySelectorAll("[data-environment]").forEach(btn=>btn.addEventListener("click",async()=>{currentEnvironment=btn.dataset.environment;refreshTabs();if(!$("#secureSettings").hidden)await runCheck()}));
$("#setActive").addEventListener("click",async()=>{try{if(!confirm("Selecionar "+currentEnvironment+" como ambiente preferido? Isso NÃO ativa cobranças reais."))return;const r=await call("POST","/api/admin/asaas/active-environment",{environment:currentEnvironment});activeEnvironment=r.activeEnvironment;refreshTabs();status("Preferência salva: "+activeEnvironment+". Cobranças reais permanecem desativadas.",true)}catch(e){status(e.message)}});

let pixOrderId=null,pixPoll=null,pixPayload="";
function pixNotice(msg,isGood=false){const el=$("#pixMessage");el.textContent=msg;el.className=isGood?"good":"error"}
async function pollPix(){
 if(!pixOrderId)return;
 try{
  const r=await call("GET","/api/admin/pix-demo/"+encodeURIComponent(pixOrderId));
  $("#pixStatus").textContent=r.status==="paid"?"Pagamento confirmado":r.status==="pending"?"Aguardando Pix":r.status;
  if(r.status==="paid"){pixNotice("Pagamento de teste confirmado pelo Asaas Sandbox.",true);clearInterval(pixPoll);pixPoll=null}
 }catch(e){pixNotice("Falha ao consultar: "+e.message)}
}
$("#pixDemoForm").addEventListener("submit",async e=>{
 e.preventDefault();const button=$("#pixGenerate");button.disabled=true;pixNotice("Gerando cobrança individual no Asaas Sandbox...");
 try{
  const r=await call("POST","/api/admin/pix-demo",{fullName:$("#pixName").value.trim(),phone:$("#pixPhone").value,cpf:$("#pixCpf").value});
  $("#pixCpf").value="";
  showPixResult(r);
  pixNotice("QR Code Sandbox criado. Nunca use dinheiro real nesta demonstração.",true);
 }catch(err){pixNotice(err.message)}finally{button.disabled=false}
});
function showPixResult(r){
  pixOrderId=r.orderId;pixPayload=r.payload;
  $("#pixOrderId").textContent=r.orderId;
  $("#pixQr").src="data:image/png;base64,"+r.encodedImage;
  $("#pixPayload").value=r.payload;
  $("#pixStatus").textContent=r.status==="paid"?"Pagamento confirmado":"Aguardando Pix";
  $("#pixResult").hidden=false;
  if(pixPoll)clearInterval(pixPoll);
  if(r.status!=="paid")pixPoll=setInterval(pollPix,10000);
}
$("#pixRecover").addEventListener("click",async()=>{
 const b=$("#pixRecover");b.disabled=true;
 try{
  const r=await call("GET","/api/admin/pix-demo/recent");
  showPixResult(r);
  pixNotice("Último Pix Sandbox recuperado, sem criar nova cobrança.",true);
 }catch(e){pixNotice(e.message)}finally{b.disabled=false}
});
$("#pixCopy").addEventListener("click",async()=>{
 try{await navigator.clipboard.writeText(pixPayload);pixNotice("Código Pix copiado.",true)}
 catch{pixNotice("Não foi possível copiar. Selecione o código acima.")}
});
$("#pixRefresh").addEventListener("click",pollPix);

const PUBLIC_ACTION_URL="https://prokkop7.github.io/Rifa/?acao=";
const actionList=$("#actionList");
function actionMessage(msg,good=false){$("#actionMessage").textContent=msg;$("#actionMessage").className=good?"good":"error"}
function actionRow(a){
 const row=document.createElement("div");row.className="action-row";
 const left=document.createElement("div");left.className="action-row-text";
 const name=document.createElement("strong");name.textContent=a.title;
 const meta=document.createElement("small");meta.textContent=({product:"Produto",money:"Dinheiro",service:"Serviço"})[a.category]+" · "+a.number_count+" números · "+(a.state==="preview"?"Prévia disponível":"Arquivada");
 left.append(name,meta);
 const buttons=document.createElement("div");buttons.className="action-buttons";
 const copy=document.createElement("button");copy.type="button";copy.className="outline";copy.textContent="Copiar link";
 copy.addEventListener("click",()=>GenCopy(PUBLIC_ACTION_URL+encodeURIComponent(a.slug)));
 const open=document.createElement("button");open.type="button";open.className="outline";open.textContent="Abrir";
 open.addEventListener("click",()=>window.open(PUBLIC_ACTION_URL+encodeURIComponent(a.slug),"_blank","noopener,noreferrer"));
 const toggle=document.createElement("button");toggle.type="button";toggle.className="outline";toggle.textContent=a.state==="preview"?"Arquivar":"Reativar prévia";
 toggle.addEventListener("click",async()=>{toggle.disabled=true;try{await call("POST","/api/admin/actions/"+encodeURIComponent(a.id)+"/state",{state:a.state==="preview"?"archived":"preview"});await loadActions()}catch(e){actionMessage(e.message)}finally{toggle.disabled=false}});
 buttons.append(copy,open,toggle);row.append(left,buttons);return row;
}
async function GenCopy(value){try{await navigator.clipboard.writeText(value);actionMessage("Link copiado.",true)}catch{actionMessage("Não foi possível copiar o link.")}}
async function loadActions(){
 try{const r=await call("GET","/api/admin/actions");actionList.replaceChildren();r.actions.forEach(a=>actionList.append(actionRow(a)));if(!r.actions.length)actionMessage("Nenhuma ação cadastrada ainda.",true)}
 catch(e){actionMessage(e.message)}
}
$("#actionForm").addEventListener("submit",async e=>{
 e.preventDefault();const submit=$("#actionForm button[type=submit]");submit.disabled=true;
 try{
  const r=await call("POST","/api/admin/actions",{category:$("#actionType").value,title:$("#actionTitle").value,description:$("#actionDescription").value,numberCount:Number($("#actionCount").value),imageUrl:$("#actionImage").value});
  $("#actionTitle").value="";$("#actionDescription").value="";$("#actionImage").value="";
  actionMessage("Ação criada. Link da prévia: "+PUBLIC_ACTION_URL+r.action.slug,true);await loadActions();
 }catch(err){actionMessage(err.message)}finally{submit.disabled=false}
});
$("#actionReload").addEventListener("click",loadActions);

refreshTabs();checkSession();
