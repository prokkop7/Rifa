"use strict";
const $=selector=>document.querySelector(selector);
let currentEnvironment="sandbox",activeEnvironment="sandbox";
const webhookUrl=()=>location.origin+(currentEnvironment==="production"?"/api/webhooks/asaas/production":"/api/webhooks/asaas");
$("#webhookUrl").textContent=webhookUrl();
function status(message,good=false){const p=$("#message");p.textContent=message;p.className=good?"good":"error"}
const adminPages=new Set(["overview","actions","reservations","pix","asaas","security","checkout"]);
let currentAdminPage="overview",adminAuthenticated=false;
function activateAdminPage(name){
 if(!adminPages.has(name))name="overview";
 currentAdminPage=name;
 const nextHash="#"+name;
 if(location.hash!==nextHash)history.replaceState(null,"",nextHash);
 for(const el of document.querySelectorAll("[data-panel-page]")){
  el.hidden=!adminAuthenticated||el.dataset.panelPage!==name;
 }
 for(const btn of document.querySelectorAll("[data-admin-page]")){
  const active=btn.dataset.adminPage===name;
  btn.classList.toggle("active",active);
  if(active)btn.setAttribute("aria-current","page");else btn.removeAttribute("aria-current");
 }
 if(name==="asaas"&&adminAuthenticated)runCheck();
 window.scrollTo({top:0,behavior:"instant"});
}
document.querySelectorAll("[data-admin-page]").forEach(b=>b.addEventListener("click",()=>activateAdminPage(b.dataset.adminPage)));
document.querySelectorAll("[data-go-page]").forEach(b=>b.addEventListener("click",()=>activateAdminPage(b.dataset.goPage)));
window.addEventListener("hashchange",()=>{const page=location.hash.slice(1);if(adminPages.has(page)&&adminAuthenticated)activateAdminPage(page)});
function signedIn(on){
 adminAuthenticated=on;
 $("#loginForm").hidden=on;
 $("#secureSettings").hidden=!on;
 $("#adminNavigation").hidden=!on;
 if(!on){
  for(const el of document.querySelectorAll("[data-panel-page]"))el.hidden=true;
  $("#asaasSettingsPanel").hidden=false; // login only, all controls remain locked
  currentAdminPage="overview";
 }else{
  const hash=location.hash.slice(1);
  activateAdminPage(adminPages.has(hash)?hash:currentAdminPage);
 }
}
async function call(method,path,body){
 const response=await fetch(path,{method,headers:{"accept":"application/json",...(body?{"Content-Type":"application/json"}:{})},...(body?{body:JSON.stringify(body)}:{}),credentials:"same-origin",cache:"no-store"});
 const result=await response.json().catch(()=>({}));
 if(!response.ok){if(response.status===401&&path!=="/api/admin/asaas/login"&&path!=="/api/admin/asaas/session"){signedIn(false);$("#loginForm").scrollIntoView({behavior:"smooth",block:"center"});status("Sua sessão administrativa expirou. Entre novamente para continuar.");}throw Error(response.status===401&&path!=="/api/admin/asaas/login"?"Sessão encerrada. Faça login novamente.":result.error||"Erro HTTP "+response.status)}
 return result;
}
async function checkSession(){try{await call("GET","/api/admin/asaas/session");signedIn(true);await runCheck();await loadActions();await refreshPixLedger();await loadCheckoutMode();await loadManualOrders();await loadCheckoutMode();await loadManualOrders()}catch{signedIn(false)}}
function refreshTabs(){document.querySelectorAll("[data-environment]").forEach(btn=>{const selected=btn.dataset.environment===currentEnvironment;btn.classList.toggle("selected",selected);btn.setAttribute("aria-pressed",String(selected))});$("#keyEnvironmentLabel").textContent="Chave de API Asaas "+(currentEnvironment==="sandbox"?"Sandbox":"Produção");$("#activeEnvironment").textContent=activeEnvironment==="sandbox"?"Sandbox":"Produção";$("#activeBadge").textContent="PREFERÊNCIA: "+activeEnvironment.toUpperCase();
 $("#dashboardEnvironment").textContent=activeEnvironment==="sandbox"?"Sandbox":"Produção";
 $("#dashboardCheckoutMode").textContent=activeEnvironment==="sandbox"?"Sandbox (teste)":"Produção (real)";
 $("#commercialEnvironment").textContent=activeEnvironment==="sandbox"?"Sandbox (teste)":"Produção (real)";
 $("#webhookUrl").textContent=webhookUrl();
$("#apiKey").value="";$("#webhookToken").value="";}
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
  signedIn(true);status("Acesso administrativo autorizado.",true);await runCheck();await loadActions();await refreshPixLedger();
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
$("#copyUrl").addEventListener("click",async()=>{try{await navigator.clipboard.writeText(webhookUrl());status("Endereço copiado.",true)}catch{status("Copie o endereço exibido acima.")}});
document.querySelectorAll("[data-environment]").forEach(btn=>btn.addEventListener("click",async()=>{currentEnvironment=btn.dataset.environment;refreshTabs();if(!$("#secureSettings").hidden)await runCheck()}));
$("#setActive").addEventListener("click",async()=>{try{if(!confirm("Definir "+currentEnvironment+" para novos checkouts comerciais de Produto ou Serviço? A alteração não cria cobranças automaticamente."))return;const r=await call("POST","/api/admin/asaas/active-environment",{environment:currentEnvironment});activeEnvironment=r.activeEnvironment;refreshTabs();status("Ambiente comercial ativo: "+activeEnvironment+". Novos checkouts de produtos ou serviços usarão este ambiente. Nenhum pagamento foi criado.",true)}catch(e){status(e.message)}});

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

// Pix Sandbox: read existing payments only, never issue a new charge from this list.
const ledgerStatuses={created:"Criado",pending:"Pendente",paid:"Confirmado",cancelled:"Cancelado",failed:"Falha",refunded:"Estornado"};
const ledgerMessage=msg=>{$("#pixLedgerMessage").textContent=msg};
async function refreshPixLedger(){
 const target=$("#pixLedgerList"),button=$("#pixLedgerRefresh");button.disabled=true;
 try{
  const result=await call("GET","/api/admin/pix-demo/orders");
  target.replaceChildren();
  if(!result.orders.length)ledgerMessage("Nenhuma cobrança Sandbox registrada.");
  else ledgerMessage(result.orders.length+" cobrança(s) de teste encontrada(s).");
  for(const order of result.orders){
   const row=document.createElement("div");row.className="pix-ledger-row";
   const title=document.createElement("strong");title.textContent=ledgerStatuses[order.status]||order.status;
   const info=document.createElement("small");
   info.textContent=new Date(order.created_at).toLocaleString("pt-BR")+
    " · "+(Number(order.amount_cents)/100).toLocaleString("pt-BR",{style:"currency",currency:"BRL"})+
    " · "+String(order.id).slice(0,8)+"…";
   const actions=document.createElement("div");actions.className="action-buttons";
   const reconcile=document.createElement("button");reconcile.className="outline";reconcile.type="button";reconcile.textContent="Conciliar";
   reconcile.addEventListener("click",async()=>{
    reconcile.disabled=true;
    try{
     const r=await call("POST","/api/admin/pix-demo/"+encodeURIComponent(order.id)+"/reconcile",{});
     ledgerMessage("Pedido conciliado: "+(ledgerStatuses[r.status]||r.status)+". Nenhuma cobrança foi criada.");
     await refreshPixLedger();
    }catch(e){ledgerMessage("Conciliação: "+e.message)}finally{reconcile.disabled=false}
   });
   actions.append(reconcile);
   row.append(title,info,actions);target.append(row);
  }
 }catch(e){ledgerMessage(e.message)}finally{button.disabled=false}
}
$("#pixLedgerRefresh").addEventListener("click",refreshPixLedger);

const PUBLIC_ACTION_URL="https://prokkop7.github.io/Rifa/?acao=";
const actionList=$("#actionList");
let editingAction=null;
function actionMessage(msg,good=false){$("#actionMessage").textContent=msg;$("#actionMessage").className=good?"good":"error"}
const displayBRL=cents=>(cents/100).toLocaleString("pt-BR",{style:"currency",currency:"BRL"});
async function GenCopy(value){try{await navigator.clipboard.writeText(value);actionMessage("Link copiado.",true)}catch{actionMessage("Não foi possível copiar o link.")}}
function toLocalDateTime(value){
 if(!value)return "";
 const d=new Date(value);
 const fmt=n=>String(n).padStart(2,"0");
 return d.getFullYear()+"-"+fmt(d.getMonth()+1)+"-"+fmt(d.getDate())+"T"+fmt(d.getHours())+":"+fmt(d.getMinutes());
}
let pendingActionFiles=[];
function renderPendingActionPhotos(){
 const host=$("#actionPendingPhotos");host.replaceChildren();
 pendingActionFiles.forEach((file,index)=>{
  const card=document.createElement("div");card.className="action-photo-card";
  const image=document.createElement("img");image.alt="Nova foto: "+file.name;
  const reader=new FileReader();reader.onload=()=>{image.src=reader.result};reader.readAsDataURL(file);
  const caption=document.createElement("small");caption.textContent=file.name;
  const remove=document.createElement("button");remove.type="button";remove.className="outline";remove.textContent="Remover";
  remove.addEventListener("click",()=>{pendingActionFiles.splice(index,1);renderPendingActionPhotos()});
  card.append(image,caption,remove);host.append(card);
 });
}
$("#actionPhotos").addEventListener("change",e=>{
 const files=[...e.target.files];e.target.value="";
 const allowed=["image/jpeg","image/png","image/webp"];
 if(files.some(f=>!allowed.includes(f.type)||f.size>12000000)){actionMessage("Escolha imagens JPG, PNG ou WebP com até 12 MB cada.");return}
 if(pendingActionFiles.length+files.length>6){actionMessage("Selecione no máximo seis fotos por vez.");return}
 pendingActionFiles.push(...files);renderPendingActionPhotos();
});
async function optimizeActionPhoto(file){
 // The admin page's Content Security Policy allows data: images but not blob:.
 // Use FileReader for both preview and canvas processing; blob: silently fails in some browsers.
 const input=await new Promise((resolve,reject)=>{
  const reader=new FileReader();
  reader.onerror=()=>reject(Error("Não foi possível ler o arquivo "+file.name));
  reader.onload=()=>resolve(reader.result);
  reader.readAsDataURL(file);
 });
 return new Promise((resolve,reject)=>{
  const img=new Image();
  img.onerror=()=>reject(Error("Não foi possível abrir "+file.name+". Verifique se é uma imagem válida."));
  img.onload=()=>{
   try{
    const size=Math.min(1,1400/Math.max(img.naturalWidth,img.naturalHeight));
    const canvas=document.createElement("canvas");
    canvas.width=Math.max(1,Math.round(img.naturalWidth*size));
    canvas.height=Math.max(1,Math.round(img.naturalHeight*size));
    const ctx=canvas.getContext("2d");
    if(!ctx)throw Error("Seu navegador não conseguiu processar a imagem");
    ctx.fillStyle="#fff";ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.drawImage(img,0,0,canvas.width,canvas.height);
    const raw=canvas.toDataURL("image/jpeg",0.82).split(",")[1];
    if(!raw||raw.length>2700000)throw Error("Imagem muito grande; escolha uma foto menor.");
    resolve({filename:file.name.replace(/\.[^.]+$/,"")+".jpg",mime:"image/jpeg",base64:raw});
   }catch(err){reject(err)}
  };
  img.src=input;
 });
}
function actionImagePreview(images,actionId){
 const host=$("#actionExistingPhotos");host.replaceChildren();
 if(!images?.length)return;
 const heading=document.createElement("p");heading.className="help";heading.textContent="Fotos já salvas nesta ação:";
 host.append(heading);
 for(const item of images){
  const card=document.createElement("div");card.className="action-photo-card";
  const img=document.createElement("img");img.src=item.url;img.alt=item.filename;
  const name=document.createElement("small");name.textContent=item.isCover?"CAPA · "+item.filename:item.filename;
  const controls=document.createElement("div");controls.className="action-photo-controls";
  if(!item.isCover){
   const cover=document.createElement("button");cover.type="button";cover.className="outline";cover.textContent="Definir capa";
   cover.addEventListener("click",async()=>{
    cover.disabled=true;
    try{await call("POST","/api/admin/actions/"+actionId+"/images/"+item.id+"/cover",{});await loadActions();actionMessage("Capa atualizada.",true)}
    catch(e){actionMessage(e.message)}finally{cover.disabled=false}
   });controls.append(cover);
  }
  const remove=document.createElement("button");remove.type="button";remove.className="outline";remove.textContent="Excluir foto";
  remove.addEventListener("click",async()=>{
   if(!confirm("Excluir esta foto da ação?"))return;
   remove.disabled=true;
   try{await call("DELETE","/api/admin/actions/"+actionId+"/images/"+item.id);await loadActions();actionMessage("Foto excluída.",true)}
   catch(e){actionMessage(e.message)}finally{remove.disabled=false}
  });
  controls.append(remove);card.append(img,name,controls);host.append(card);
 }
}
async function uploadActionPhotos(actionId){
 if(!pendingActionFiles.length)return 0;
 const count=pendingActionFiles.length;
 for(const file of [...pendingActionFiles]){
  actionMessage("Enviando foto "+file.name+"...");
  const data=await optimizeActionPhoto(file);
  await call("POST","/api/admin/actions/"+encodeURIComponent(actionId)+"/images",data);
  pendingActionFiles.shift();
 }
 renderPendingActionPhotos();
 return count;
}
function resetActionForm(){
 editingAction=null;pendingActionFiles=[];renderPendingActionPhotos();$("#actionExistingPhotos").replaceChildren();$("#actionForm").reset();
 $("#actionCount").value="100";$("#actionMax").value="10";$("#actionPrice").value="0.00";
 $("#actionSave").textContent="Criar ação e gerar link";$("#actionCancelEdit").hidden=true;
 $("#actionFormDetails").open=false;$("#actionFormSummary").textContent="+ Cadastrar nova ação";
}
function editAction(a){
 editingAction=a.id;
 const fields={
  actionType:a.category,actionTitle:a.title,actionDescription:a.description,
  actionCount:a.number_count,actionImage:a.image_url||"",
  actionPrice:(a.price_cents/100).toFixed(2),actionMax:a.max_numbers_per_person,
  actionPrize:a.prize_details||"",actionRules:a.rules_text||"",
  actionRegulation:a.regulation_url||"",
  actionStart:toLocalDateTime(a.starts_at),actionEnd:toLocalDateTime(a.ends_at)
 };
 for(const [id,value]of Object.entries(fields))$("#"+id).value=value;
 $("#actionSave").textContent="Salvar alterações";$("#actionCancelEdit").hidden=false;
 $("#actionFormDetails").open=true;$("#actionFormSummary").textContent="Editar ação: "+a.title;
 actionImagePreview(a.images||[],a.id);
 pendingActionFiles=[];renderPendingActionPhotos();
 actionMessage("Editando: "+a.title,true);
 $("#actionForm").scrollIntoView({behavior:"smooth",block:"start"});
}
function actionRow(a){
 const row=document.createElement("div");row.className="action-row";
 const left=document.createElement("div");left.className="action-row-text";
 const name=document.createElement("strong");name.textContent=a.title;
 const meta=document.createElement("small");
 meta.textContent=({product:"Produto",money:"Dinheiro",service:"Serviço"})[a.category]+
 " · "+a.number_count+" números · "+displayBRL(a.price_cents)+" por número (prévia) · "+
 (a.state==="preview"?"Prévia disponível":"Arquivada");
 left.append(name,meta);
 const buttons=document.createElement("div");buttons.className="action-buttons";
 const copy=document.createElement("button");copy.type="button";copy.className="outline";copy.textContent="Copiar link";
 copy.addEventListener("click",()=>GenCopy(PUBLIC_ACTION_URL+encodeURIComponent(a.slug)));
 const open=document.createElement("button");open.type="button";open.className="outline";open.textContent="Abrir";
 open.addEventListener("click",()=>window.open(PUBLIC_ACTION_URL+encodeURIComponent(a.slug),"_blank","noopener,noreferrer"));
 const edit=document.createElement("button");edit.type="button";edit.className="outline";edit.textContent="Editar";
 edit.addEventListener("click",()=>editAction(a));
 const toggle=document.createElement("button");toggle.type="button";toggle.className="outline";
 toggle.textContent=a.state==="preview"?"Arquivar":"Reativar prévia";
 toggle.addEventListener("click",async()=>{
  toggle.disabled=true;
  try{await call("POST","/api/admin/actions/"+encodeURIComponent(a.id)+"/state",{state:a.state==="preview"?"archived":"preview"});await loadActions()}
  catch(e){actionMessage(e.message)}finally{toggle.disabled=false}
 });
 buttons.append(copy,open,edit,toggle);row.append(left,buttons);return row;
}
async function loadActions(){
 try{
  const r=await call("GET","/api/admin/actions");
  actionList.replaceChildren();
  r.actions.forEach(a=>actionList.append(actionRow(a)));
  if(editingAction){const active=r.actions.find(a=>a.id===editingAction);if(active)actionImagePreview(active.images||[],active.id)}
  populateAuditActions(r.actions);await loadAudit();
  if(!r.actions.length)actionMessage("Nenhuma ação cadastrada ainda.",true);
 }catch(e){actionMessage(e.message)}
}
function actionInput(){
 const amount=Number($("#actionPrice").value);
 if(!Number.isFinite(amount)||amount<0||Math.abs(Math.round(amount*100)-amount*100)>0.00001)throw Error("O valor deve conter no máximo duas casas decimais.");
 const toIso=id=>$("#"+id).value?new Date($("#"+id).value).toISOString():null;
 return {
  category:$("#actionType").value,title:$("#actionTitle").value,
  description:$("#actionDescription").value,
  numberCount:Number($("#actionCount").value),
  imageUrl:$("#actionImage").value,
  priceCents:Math.round(amount*100),maxPerPerson:Number($("#actionMax").value),
  prizeDetails:$("#actionPrize").value,rulesText:$("#actionRules").value,
  regulationUrl:$("#actionRegulation").value,
  startsAt:toIso("actionStart"),endsAt:toIso("actionEnd")
 };
}
$("#actionForm").addEventListener("submit",async e=>{
 e.preventDefault();const submit=$("#actionSave");submit.disabled=true;
 try{
  const editing=Boolean(editingAction);
  const r=await call(editing?"PUT":"POST",editing?"/api/admin/actions/"+encodeURIComponent(editingAction):"/api/admin/actions",actionInput());
  const id=r.action.id;
  try{
   const sent=await uploadActionPhotos(id);
   resetActionForm();await loadActions();
   actionMessage((editing?"Alterações salvas.":"Ação criada.")+(sent?" "+sent+" foto(s) enviada(s).":"")+" Link: "+PUBLIC_ACTION_URL+r.action.slug,true);
  }catch(uploadError){
   editingAction=id;
   $("#actionFormDetails").open=true;
   $("#actionFormSummary").textContent="Continuar edição e envio de fotos";
   $("#actionSave").textContent="Salvar e continuar envio";
   await loadActions();
   actionMessage("Ação salva, mas o envio de fotos ficou incompleto: "+uploadError.message+" Clique em Salvar novamente para tentar enviar as fotos restantes.");
  }
 }catch(err){actionMessage(err.message)}finally{submit.disabled=false}
});
$("#actionCancelEdit").addEventListener("click",()=>{resetActionForm();actionMessage("Edição cancelada.",true)});
$("#actionReload").addEventListener("click",loadActions);

// No personal contact details are exposed by the reservation audit API.
let auditCursor=null,auditLoading=false;
const auditNames={created:"Reservado",released:"Liberado",expired:"Expirado",conflict:"Conflito"};
function auditMessage(msg){$("#auditMessage").textContent=msg}
function populateAuditActions(actions){
 const select=$("#auditAction"),saved=select.value;
 select.replaceChildren();
 const all=document.createElement("option");all.value="";all.textContent="Todas as ações";select.append(all);
 for(const a of actions){
  const option=document.createElement("option");option.value=a.slug;
  option.textContent=a.title+(a.state==="archived"?" (arquivada)":"");
  select.append(option);
 }
 if([...select.options].some(x=>x.value===saved))select.value=saved;
}
function renderAuditSummary(summary){
 const target=$("#auditSummary");target.replaceChildren();
 for(const key of ["created","released","expired","conflict"]){
  const entry=document.createElement("span");entry.className="audit-metric";
  const n=document.createElement("strong");n.textContent=String(summary[key]||0);
  entry.append(document.createTextNode(auditNames[key]+": "),n);target.append(entry);
 }
}
function appendAuditRows(events){
 const container=$("#auditList");
 for(const a of events){
  const row=document.createElement("div");row.className="audit-row";
  const headline=document.createElement("strong");headline.textContent=auditNames[a.event_type]||a.event_type;
  headline.className="audit-type audit-"+a.event_type;
  const meta=document.createElement("span");meta.textContent="Nº "+String(a.number).padStart(3,"0")+" · "+a.action_slug;
  const time=document.createElement("small");time.textContent=new Date(a.occurred_at).toLocaleString("pt-BR");
  row.append(headline,meta,time);container.append(row);
 }
}
async function loadAudit(append=false){
 if(auditLoading)return;
 auditLoading=true;
 $("#auditRefresh").disabled=true;$("#auditMore").disabled=true;
 try{
  const params=new URLSearchParams();
  if($("#auditAction").value)params.set("action",$("#auditAction").value);
  if($("#auditType").value)params.set("type",$("#auditType").value);
  if(append&&auditCursor)params.set("before",auditCursor);
  const r=await call("GET","/api/admin/reservation-audit?"+params);
  if(!append)$("#auditList").replaceChildren();
  appendAuditRows(r.events||[]);
  renderAuditSummary(r.summary||{});
  auditCursor=r.nextCursor||null;
  $("#auditMore").hidden=!r.hasMore;
  auditMessage(r.events.length?"Eventos encontrados: "+r.events.length:"Nenhum evento neste filtro.");
 }catch(e){auditMessage(e.message)}
 finally{auditLoading=false;$("#auditRefresh").disabled=false;$("#auditMore").disabled=false}
}
$("#auditAction").addEventListener("change",()=>loadAudit());
$("#auditType").addEventListener("change",()=>loadAudit());
$("#auditRefresh").addEventListener("click",()=>loadAudit());
$("#auditMore").addEventListener("click",()=>loadAudit(true));
function checkoutNotice(message,good=false){
 const p=$("#checkoutConfigMessage");p.textContent=message;p.className=good?"good":"error";
}
async function loadCheckoutMode(){
 try{
  const x=await call("GET","/api/admin/checkout-mode");
  $("#checkoutMode").value=x.mode;
  $("#rayaEndpoint").value=x.rayaEndpoint;
  $("#rayaDestination").value=x.destinationPhone;
  $("#rayaBearer").value="";
  $("#rayaTokenState").textContent=x.tokenConfigured?"Token cadastrado e protegido. Deixe em branco para manter.":"Nenhum token cadastrado.";
  $("#checkoutModeNote").textContent=x.mode==="whatsapp"?
   "Modo ativo: finalizar gera reserva e notificação via Raya; não confirma pagamento.":
   "Modo automático selecionado: o checkout de números ainda não está conectado ao Asaas. Não há cobrança automática nesta tela.";
  checkoutNotice("Configurações carregadas.",true);
 }catch(e){checkoutNotice(e.message)}
}
$("#checkoutMode").addEventListener("change",()=>{
 $("#checkoutModeNote").textContent=$("#checkoutMode").value==="whatsapp"?
 "O participante informa nome e WhatsApp após escolher os números. Reservamos e enviamos o pedido à Raya.":
 "Selecionar automático não conecta cobranças aos números sem a integração de checkout específica.";
});
$("#checkoutModeForm").addEventListener("submit",async e=>{
 e.preventDefault();const button=$("#checkoutModeSave");button.disabled=true;
 try{
  const token=$("#rayaBearer").value.trim();
  const body={mode:$("#checkoutMode").value,rayaEndpoint:$("#rayaEndpoint").value.trim(),
   destinationPhone:$("#rayaDestination").value.replace(/\D/g,"")};
  if(token)body.token=token;
  await call("PUT","/api/admin/checkout-mode",body);
  checkoutNotice("Modo salvo. Novas solicitações usarão a forma selecionada.",true);
  await loadCheckoutMode();
 }catch(err){checkoutNotice(err.message)}finally{button.disabled=false}
});
$("#checkoutModeRefresh").addEventListener("click",loadCheckoutMode);
$("#rayaSendTest").addEventListener("click",async()=>{
 const button=$("#rayaSendTest");button.disabled=true;
 try{
  const result=await call("POST","/api/admin/checkout-mode/test",{});
  checkoutNotice(result.message||"A Raya aceitou o pedido de teste.",true);
 }catch(e){checkoutNotice("Falha no envio de teste: "+e.message)}
 finally{button.disabled=false}
});
function manualOrderMessage(message){$("#manualOrdersMessage").textContent=message}
const manualOrderStatusNames={
 reserved:"Aguardando validação",approved:"Aprovado",rejected:"Não aprovado",
 released:"Liberado",expired:"Expirado"
};
async function reviewManualOrder(order,decision){
 const approving=decision==="approved";
 const question=approving?
  "Aprovar este pedido e manter os números "+order.numbers.join(", ")+" bloqueados? A aprovação manual não confirma pagamento.":
  "Não aprovar o pedido e liberar imediatamente os números "+order.numbers.join(", ")+"?";
 if(!confirm(question))return;
 const note=prompt("Observação da validação (opcional):","") ;
 if(note===null)return;
 if(note.length>500){manualOrderMessage("Observação muito longa (máximo 500 caracteres).");return}
 try{
  const r=await call("POST","/api/admin/manual-requests/"+order.id+"/decision",{decision,note});
  manualOrderMessage(r.status==="approved"?"Pedido aprovado; números mantidos bloqueados.":"Pedido não aprovado; números liberados.");
  await loadManualOrders();
 }catch(e){manualOrderMessage("Não foi possível registrar a decisão: "+e.message)}
}
async function loadManualOrders(){
 try{
  const data=await call("GET","/api/admin/manual-requests");
  const target=$("#manualOrdersList");target.replaceChildren();
  manualOrderMessage(data.orders.length+" pedido(s) registrados.");
  for(const o of data.orders){
   const row=document.createElement("article");row.className="manual-order-row";
   const title=document.createElement("strong");title.textContent=o.title+" · "+(manualOrderStatusNames[o.status]||o.status);
   const info=document.createElement("p");
   info.textContent="Pedido "+o.id.slice(0,8)+"… · Cliente: "+o.contact_name+
    " · WhatsApp: "+o.contact_phone.replace(/^\+/,"")+
    " · Números: "+o.numbers.join(", ")+
    " · "+o.quantity+" × "+displayBRL(o.unit_price_cents)+" = "+displayBRL(Number(o.total_cents));
   const meta=document.createElement("small");meta.textContent="Raya: "+o.notification_status+
    " · Criado em "+new Date(o.created_at).toLocaleString("pt-BR")+
    " · Até "+new Date(o.expires_at).toLocaleString("pt-BR");
   if(o.reviewed_at){
    const review=document.createElement("small");
    review.textContent="Validado em "+new Date(o.reviewed_at).toLocaleString("pt-BR")+
     (o.review_note?" · Observação: "+o.review_note:"");
    row.append(review);
   }
   const actions=document.createElement("div");actions.className="action-buttons";
   if(o.status==="reserved"&&new Date(o.expires_at).getTime()>Date.now()){
    const approve=document.createElement("button");approve.type="button";
    approve.className="manual-approve";approve.textContent="Aprovar";
    approve.addEventListener("click",()=>reviewManualOrder(o,"approved"));
    const reject=document.createElement("button");reject.type="button";
    reject.className="manual-reject";reject.textContent="Não aprovar · liberar";
    reject.addEventListener("click",()=>reviewManualOrder(o,"rejected"));
    actions.append(approve,reject);
   }
   if(o.status==="reserved"&&o.notification_status==="failed"){
    const retry=document.createElement("button");retry.type="button";retry.className="outline";retry.textContent="Reenviar";
    retry.addEventListener("click",async()=>{
     retry.disabled=true;
     try{const result=await call("POST","/api/admin/manual-requests/"+o.id+"/retry",{});
      manualOrderMessage(result.accepted?"Notificação aceita pela Raya.":"Envio ainda pendente; confira o token e o canal.");
      await loadManualOrders();
     }catch(e){manualOrderMessage(e.message)}finally{retry.disabled=false}
    });actions.append(retry);
   }
   if(o.status==="reserved"){
    const release=document.createElement("button");release.type="button";release.className="outline";release.textContent="Liberar números";
    release.addEventListener("click",async()=>{
     if(!confirm("Liberar os números desse pedido?"))return;
     release.disabled=true;
     try{await call("POST","/api/admin/manual-requests/"+o.id+"/release",{});await loadManualOrders()}
     catch(e){manualOrderMessage(e.message)}finally{release.disabled=false}
    });actions.append(release);
   }
   row.append(title,info,meta,actions);target.append(row);
  }
 }catch(e){manualOrderMessage(e.message)}
}
$("#manualOrdersRefresh").addEventListener("click",loadManualOrders);
refreshTabs();checkSession();
