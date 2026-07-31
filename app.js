/* ===================== FocusDo ===================== */
"use strict";

/* ---------- Supabase client ---------- */
let sb = null;
function initClient(){
  const url = window.SUPABASE_URL, key = window.SUPABASE_KEY;
  if(!url || !key || url.includes("PASTE_") || key.includes("PASTE_")) return false;
  sb = supabase.createClient(url, key);
  return true;
}

/* ---------- State ---------- */
let user = null;
let state = { lists:[], tasks:[], steps:[] };
let activeView = "myday";          // myday | important | planned | search | focus | <listId>
let selectedTaskId = null;
let searchQuery = "";

/* ---------- Tiny helpers ---------- */
const $ = s => document.querySelector(s);
const el = (t,c) => { const e=document.createElement(t); if(c) e.className=c; return e; };
const esc = s => (s||"").replace(/[&<>"]/g, m => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[m]));
function todayStr(d=new Date()){ return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; }
function toast(msg){ const t=$("#toast"); t.textContent=msg; t.classList.remove("hidden"); clearTimeout(t._h); t._h=setTimeout(()=>t.classList.add("hidden"),2200); }
function defaultList(){ return state.lists.find(l=>l.is_default) || state.lists[0]; }
function listById(id){ return state.lists.find(l=>l.id===id); }

function fmtDate(str){
  if(!str) return "";
  const d = new Date(str+"T00:00:00"), t = new Date(); t.setHours(0,0,0,0);
  const diff = Math.round((d - t)/86400000);
  if(diff===0) return "Today"; if(diff===1) return "Tomorrow"; if(diff===-1) return "Yesterday";
  const opts = d.getFullYear()===t.getFullYear() ? {weekday:"short",month:"short",day:"numeric"} : {month:"short",day:"numeric",year:"numeric"};
  return d.toLocaleDateString(undefined,opts);
}
function isOverdue(str){ if(!str) return false; return str < todayStr(); }

/* ================= AUTH ================= */
function showAuthError(msg){ const e=$("#auth-error"); e.textContent=msg; e.classList.toggle("hidden",!msg); }
let authMode = "signin";

function wireAuth(){
  $("#auth-toggle").onclick = () => {
    authMode = authMode==="signin" ? "signup" : "signin";
    $("#auth-submit").textContent = authMode==="signin" ? "Sign in" : "Create account";
    $("#auth-switch-text").textContent = authMode==="signin" ? "New here?" : "Already have an account?";
    $("#auth-toggle").textContent = authMode==="signin" ? "Create an account" : "Sign in";
    showAuthError("");
  };
  const submit = async () => {
    const email=$("#auth-email").value.trim(), password=$("#auth-password").value;
    if(!email || !password){ showAuthError("Enter an email and password."); return; }
    $("#auth-submit").disabled=true;
    try{
      let res;
      if(authMode==="signup"){
        res = await sb.auth.signUp({ email, password });
        if(!res.error && !res.data.session){ showAuthError("Check your email to confirm, then sign in. (Or disable email confirmation in Supabase for instant access.)"); authMode="signin"; }
      } else {
        res = await sb.auth.signInWithPassword({ email, password });
      }
      if(res.error) showAuthError(res.error.message);
    } catch(e){ showAuthError(e.message||"Something went wrong."); }
    $("#auth-submit").disabled=false;
  };
  $("#auth-submit").onclick = submit;
  $("#auth-password").addEventListener("keydown", e=>{ if(e.key==="Enter") submit(); });
}

/* ================= DATA ================= */
async function loadAll(){
  const [L,T,S] = await Promise.all([
    sb.from("lists").select("*").order("position").order("created_at"),
    sb.from("tasks").select("*").order("position").order("created_at"),
    sb.from("steps").select("*").order("position").order("created_at"),
  ]);
  if(L.error||T.error||S.error){ toast("Load failed — check your database setup."); console.error(L.error||T.error||S.error); return; }
  state.lists=L.data; state.tasks=T.data; state.steps=S.data;
  if(!state.lists.some(l=>l.is_default)){
    const {data,error}=await sb.from("lists").insert({name:"Tasks",emoji:"✓",color:"#4b57c4",is_default:true,position:0}).select().single();
    if(!error && data) state.lists.unshift(data);
  }
  renderAll();
}

async function db(table, op, payload, match){
  try{
    let q=sb.from(table);
    if(op==="insert"){ const {data,error}=await q.insert(payload).select().single(); if(error)throw error; return data; }
    if(op==="update"){ const {data,error}=await q.update(payload).eq("id",match).select().single(); if(error)throw error; return data; }
    if(op==="delete"){ const {error}=await q.delete().eq("id",match); if(error)throw error; return true; }
  }catch(e){ toast("Save failed."); console.error(e); throw e; }
}

/* ----- task mutations ----- */
async function addTask(title){
  title=title.trim(); if(!title) return;
  const patch={ title, list_id: currentListId() , is_important:false, position: Date.now()%100000 };
  if(activeView==="myday") patch.my_day_date=todayStr();
  if(activeView==="important") patch.is_important=true;
  if(activeView==="planned") patch.due_date=todayStr();
  const t=await db("tasks","insert",patch); state.tasks.unshift(t); renderMain(); renderSidebar();
}
function currentListId(){
  if(["myday","important","planned","search","focus"].includes(activeView)) return defaultList()?.id || null;
  return activeView;
}
async function toggleComplete(t){
  if(t.repeat && t.repeat!=="none" && !t.is_completed){
    const next=advanceDate(t.due_date||todayStr(), t.repeat);
    const upd=await db("tasks","update",{due_date:next, my_day_date:null}, t.id);
    Object.assign(t,upd); toast("Rescheduled for "+fmtDate(next)); renderMain(); renderSidebar(); if(selectedTaskId===t.id) renderDetail(); return;
  }
  const done=!t.is_completed;
  const upd=await db("tasks","update",{is_completed:done, completed_at: done?new Date().toISOString():null}, t.id);
  Object.assign(t,upd); renderMain(); renderSidebar(); if(selectedTaskId===t.id) renderDetail();
}
function advanceDate(str,rep){
  const d=new Date(str+"T00:00:00");
  if(rep==="daily") d.setDate(d.getDate()+1);
  else if(rep==="weekly") d.setDate(d.getDate()+7);
  else if(rep==="monthly") d.setMonth(d.getMonth()+1);
  else if(rep==="weekdays"){ do{ d.setDate(d.getDate()+1);}while(d.getDay()===0||d.getDay()===6); }
  return todayStr(d);
}
async function patchTask(t, patch){ const upd=await db("tasks","update",patch,t.id); Object.assign(t,upd); }
async function toggleImportant(t){ await patchTask(t,{is_important:!t.is_important}); renderMain(); renderSidebar(); if(selectedTaskId===t.id) renderDetail(); }
async function toggleMyDay(t){ await patchTask(t,{my_day_date: t.my_day_date?null:todayStr()}); renderMain(); renderSidebar(); renderDetail(); }
async function deleteTask(t){ await db("tasks","delete",null,t.id); state.tasks=state.tasks.filter(x=>x.id!==t.id); state.steps=state.steps.filter(s=>s.task_id!==t.id); if(selectedTaskId===t.id) closeDetail(); renderMain(); renderSidebar(); }

/* ----- steps ----- */
async function addStep(taskId,title){ title=title.trim(); if(!title)return; const s=await db("steps","insert",{task_id:taskId,title,position:Date.now()%100000}); state.steps.push(s); renderDetail(); renderMain(); }
async function toggleStep(s){ const u=await db("steps","update",{is_done:!s.is_done},s.id); Object.assign(s,u); renderDetail(); renderMain(); }
async function deleteStep(s){ await db("steps","delete",null,s.id); state.steps=state.steps.filter(x=>x.id!==s.id); renderDetail(); renderMain(); }

/* ----- lists ----- */
async function createList(name,emoji,color){ const l=await db("lists","insert",{name,emoji,color,position:state.lists.length}); state.lists.push(l); activeView=l.id; renderAll(); }
async function renameList(l,name){ const u=await db("lists","update",{name},l.id); Object.assign(l,u); renderAll(); }
async function deleteList(l){ await db("lists","delete",null,l.id); state.lists=state.lists.filter(x=>x.id!==l.id); state.tasks=state.tasks.filter(t=>t.list_id!==l.id); activeView="myday"; closeDetail(); renderAll(); }

/* ================= VIEW SELECTION ================= */
function tasksFor(view){
  const all=state.tasks;
  if(view==="myday") return all.filter(t=>t.my_day_date===todayStr());
  if(view==="important") return all.filter(t=>t.is_important);
  if(view==="planned") return all.filter(t=>t.due_date);
  if(view==="search"){ const q=searchQuery.toLowerCase(); return all.filter(t=>t.title.toLowerCase().includes(q)||(t.notes||"").toLowerCase().includes(q)); }
  return all.filter(t=>t.list_id===view);
}
function countActive(view){ return tasksFor(view).filter(t=>!t.is_completed).length; }

/* ================= RENDER ================= */
function renderAll(){ renderSidebar(); renderMain(); renderDetail(); }

function renderSidebar(){
  const greet=greeting();
  const smart=[
    {id:"myday", ico:"☀️", label:"My Day"},
    {id:"important", ico:"⭐", label:"Important"},
    {id:"planned", ico:"🗓️", label:"Planned"},
    {id:"focus", ico:"🎯", label:"Focus Protocol"},
  ];
  const dflt=defaultList();
  const nav=$("#smart-nav"); nav.innerHTML="";
  smart.forEach(s=>{
    const b=el("button","nav-item"+(activeView===s.id?" active":""));
    b.innerHTML=`<span class="ico">${s.ico}</span><span>${s.label}</span>`;
    if(s.id!=="focus"){ const c=countActive(s.id); if(c) b.insertAdjacentHTML("beforeend",`<span class="count">${c}</span>`); }
    b.onclick=()=>select(s.id); nav.appendChild(b);
  });
  if(dflt){
    const b=el("button","nav-item"+(activeView===dflt.id?" active":""));
    b.innerHTML=`<span class="ico">${dflt.emoji||"✓"}</span><span>${esc(dflt.name)}</span>`;
    const c=countActive(dflt.id); if(c) b.insertAdjacentHTML("beforeend",`<span class="count">${c}</span>`);
    b.onclick=()=>select(dflt.id); nav.appendChild(b);
  }
  const ln=$("#list-nav"); ln.innerHTML="";
  state.lists.filter(l=>!l.is_default).forEach(l=>{
    const b=el("button","nav-item"+(activeView===l.id?" active":""));
    b.innerHTML=`<span class="ico">${l.emoji||"📋"}</span><span>${esc(l.name)}</span>`;
    const c=countActive(l.id); if(c) b.insertAdjacentHTML("beforeend",`<span class="count">${c}</span>`);
    b.onclick=()=>select(l.id); ln.appendChild(b);
  });
  $("#user-email").textContent=user?.email||"";
}

function select(view){ activeView=view; selectedTaskId=null; closeDetail(); closeSidebar(); renderAll(); $("#main").scrollTop=0; }

function greeting(){ const h=new Date().getHours(); return h<12?"Good morning":h<17?"Good afternoon":"Good evening"; }

function renderMain(){
  const m=$("#main");
  if(activeView==="focus"){ renderFocus(m); return; }
  m.innerHTML="";
  const head=el("div","page-head");
  let title, sub;
  if(activeView==="myday"){ title="☀️ My Day"; sub=new Date().toLocaleDateString(undefined,{weekday:"long",month:"long",day:"numeric"}); }
  else if(activeView==="important"){ title="⭐ Important"; sub="Everything you've starred"; }
  else if(activeView==="planned"){ title="🗓️ Planned"; sub="Tasks with a due date"; }
  else if(activeView==="search"){ title="🔎 Search"; sub=searchQuery?`Results for “${esc(searchQuery)}”`:"Type to search"; }
  else { const l=listById(activeView); title=`${l?.emoji||"✓"} ${esc(l?.name||"List")}`; sub=""; }

  const titleEl=el("h1","page-title"); titleEl.innerHTML=title;
  const left=el("div"); left.appendChild(titleEl);
  head.appendChild(left);
  const l=listById(activeView);
  if(l && !l.is_default){ const mb=el("button","list-menu-btn"); mb.textContent="⋯"; mb.title="List options"; mb.onclick=()=>listOptions(l); head.appendChild(mb); }
  m.appendChild(head);
  if(sub){ const p=el("p","page-sub"); p.textContent=sub; m.appendChild(p); }

  if(activeView!=="search"){
    const bar=el("div","add-task");
    bar.innerHTML=`<span class="plus">＋</span><input type="text" placeholder="Add a task"/>`;
    const inp=bar.querySelector("input");
    inp.addEventListener("keydown",e=>{ if(e.key==="Enter"&&inp.value.trim()){ addTask(inp.value); inp.value=""; }});
    m.appendChild(bar);
  }

  let items=tasksFor(activeView);
  if(activeView==="search" && !searchQuery){ m.appendChild(emptyState("🔎","Search your tasks","Start typing in the box on the left.")); return; }

  const active=items.filter(t=>!t.is_completed);
  const done=items.filter(t=>t.is_completed);

  if(activeView==="planned"){
    renderPlanned(m, active);
  } else {
    if(!active.length && !done.length){ m.appendChild(emptyState(emptyIcon(),"Nothing here yet", emptyHint())); }
    active.forEach(t=>m.appendChild(taskRow(t)));
  }

  if(done.length){
    const lbl=el("div","section-label"); lbl.dataset.collapsed="0";
    lbl.innerHTML=`<span class="chev">▾</span> Completed <span style="color:var(--muted)">(${done.length})</span>`;
    const wrap=el("div"); done.forEach(t=>wrap.appendChild(taskRow(t)));
    lbl.onclick=()=>{ const c=lbl.classList.toggle("collapsed"); wrap.style.display=c?"none":""; };
    m.appendChild(lbl); m.appendChild(wrap);
  }
}

function renderPlanned(m, active){
  const groups={Overdue:[],Today:[],Tomorrow:[],"This week":[],Later:[]};
  const t=todayStr(); const now=new Date(); now.setHours(0,0,0,0);
  active.sort((a,b)=>(a.due_date||"").localeCompare(b.due_date||""));
  active.forEach(x=>{
    if(x.due_date<t) groups.Overdue.push(x);
    else if(x.due_date===t) groups.Today.push(x);
    else { const d=new Date(x.due_date+"T00:00:00"); const diff=Math.round((d-now)/86400000);
      if(diff===1) groups.Tomorrow.push(x); else if(diff<=7) groups["This week"].push(x); else groups.Later.push(x); }
  });
  let any=false;
  Object.entries(groups).forEach(([g,arr])=>{ if(!arr.length) return; any=true;
    const lbl=el("div","section-label"); lbl.style.color = g==="Overdue"?"var(--danger)":"var(--muted)"; lbl.textContent=g;
    m.appendChild(lbl); arr.forEach(x=>m.appendChild(taskRow(x)));
  });
  if(!any) m.appendChild(emptyState("🗓️","No planned tasks","Give a task a due date and it shows up here."));
}

function emptyIcon(){ return activeView==="myday"?"☀️":activeView==="important"?"⭐":"📝"; }
function emptyHint(){ if(activeView==="myday") return "Add what you'll focus on today. It resets each morning."; if(activeView==="important") return "Star a task to see it here."; return "Add your first task above."; }
function emptyState(big,title,hint){ const e=el("div","empty"); e.innerHTML=`<span class="big">${big}</span><div style="font-weight:600;color:var(--text)">${esc(title)}</div><div style="margin-top:6px">${esc(hint)}</div>`; return e; }

function taskRow(t){
  const row=el("div","task"+(t.is_completed?" done":""));
  const check=el("button","check"); check.innerHTML="✓";
  check.onclick=e=>{ e.stopPropagation(); toggleComplete(t); };
  const body=el("div","t-body");
  const title=el("div","t-title"); title.textContent=t.title;
  body.appendChild(title);
  const meta=el("div","t-meta");
  const steps=state.steps.filter(s=>s.task_id===t.id);
  const parts=[];
  if(!["myday"].includes(activeView) && t.my_day_date===todayStr()) parts.push(`<span class="m">☀️ My Day</span>`);
  if(t.due_date) parts.push(`<span class="m ${isOverdue(t.due_date)&&!t.is_completed?"overdue":""}">🗓️ ${fmtDate(t.due_date)}</span>`);
  if(steps.length) parts.push(`<span class="m">✔ ${steps.filter(s=>s.is_done).length}/${steps.length}</span>`);
  if(t.notes) parts.push(`<span class="m">📝</span>`);
  if(t.repeat&&t.repeat!=="none") parts.push(`<span class="m">🔁</span>`);
  if(["important","planned","search"].includes(activeView)){ const l=listById(t.list_id); if(l) parts.push(`<span class="m">${l.emoji||"✓"} ${esc(l.name)}</span>`); }
  if(parts.length){ meta.innerHTML=parts.join(""); body.appendChild(meta); }
  const star=el("button","star"+(t.is_important?" on":"")); star.innerHTML=t.is_important?"★":"☆";
  star.onclick=e=>{ e.stopPropagation(); toggleImportant(t); };
  row.append(check,body,star);
  row.onclick=()=>openDetail(t.id);
  return row;
}

/* ================= DETAIL ================= */
function openDetail(id){ selectedTaskId=id; $("#app").classList.add("detail-open"); renderDetail(); }
function closeDetail(){ selectedTaskId=null; $("#app").classList.remove("detail-open"); }
function renderDetail(){
  const d=$("#detail");
  const t=state.tasks.find(x=>x.id===selectedTaskId);
  if(!t){ d.innerHTML=""; return; }
  const steps=state.steps.filter(s=>s.task_id===t.id);
  const inner=el("div","detail-inner");

  const head=el("div","detail-head");
  const check=el("button","check"+(t.is_completed?"":"")); check.innerHTML="✓"; if(t.is_completed) check.style.cssText="background:var(--accent);border-color:var(--accent);color:#fff";
  check.onclick=()=>toggleComplete(t);
  const ta=el("textarea","detail-title"); ta.rows=1; ta.value=t.title;
  ta.addEventListener("input",()=>{ ta.style.height="auto"; ta.style.height=ta.scrollHeight+"px"; });
  ta.addEventListener("blur",()=>{ const v=ta.value.trim(); if(v&&v!==t.title) patchTask(t,{title:v}).then(()=>{renderMain();}); });
  const star=el("button","star"+(t.is_important?" on":"")); star.innerHTML=t.is_important?"★":"☆"; star.onclick=()=>toggleImportant(t);
  const close=el("button","d-close"); close.textContent="✕"; close.onclick=closeDetail;
  head.append(check,ta,star,close); inner.appendChild(head);
  setTimeout(()=>{ ta.style.height="auto"; ta.style.height=ta.scrollHeight+"px"; },0);

  // steps block
  const sb1=el("div","d-block");
  steps.forEach(s=>{
    const r=el("div","step"+(s.is_done?" done":""));
    const c=el("button","check"); c.innerHTML="✓"; c.onclick=()=>toggleStep(s);
    const i=el("input"); i.value=s.title; i.addEventListener("blur",()=>{ const v=i.value.trim(); if(v&&v!==s.title) db("steps","update",{title:v},s.id).then(u=>Object.assign(s,u)); });
    const rm=el("button","rm"); rm.textContent="✕"; rm.onclick=()=>deleteStep(s);
    r.append(c,i,rm); sb1.appendChild(r);
  });
  const addS=el("div","add-step"); addS.innerHTML=`<span class="plus">＋</span><input placeholder="Add step"/>`;
  const sInp=addS.querySelector("input"); sInp.addEventListener("keydown",e=>{ if(e.key==="Enter"&&sInp.value.trim()){ addStep(t.id,sInp.value); sInp.value=""; }});
  sb1.appendChild(addS); inner.appendChild(sb1);

  // actions block
  const ab=el("div","d-block");
  const myday=el("button","d-row"+(t.my_day_date===todayStr()?" on":"")); myday.innerHTML=`<span class="ic">☀️</span> ${t.my_day_date===todayStr()?"Added to My Day":"Add to My Day"}`; myday.onclick=()=>toggleMyDay(t); ab.appendChild(myday);

  const dueRow=el("label","d-row"); dueRow.innerHTML=`<span class="ic">🗓️</span> Due date`;
  const dueInp=el("input"); dueInp.type="date"; dueInp.value=t.due_date||""; dueInp.onchange=()=>patchTask(t,{due_date:dueInp.value||null}).then(()=>{renderMain();renderSidebar();}); dueRow.appendChild(dueInp); ab.appendChild(dueRow);

  const remRow=el("label","d-row"); remRow.innerHTML=`<span class="ic">⏰</span> Remind`;
  const remInp=el("input"); remInp.type="date"; remInp.value=t.remind_at?t.remind_at.slice(0,10):""; remInp.onchange=()=>patchTask(t,{remind_at:remInp.value?remInp.value+"T09:00:00Z":null}); remRow.appendChild(remInp); ab.appendChild(remRow);

  const repRow=el("label","d-row"); repRow.innerHTML=`<span class="ic">🔁</span> Repeat`;
  const sel=el("select"); ["none","daily","weekdays","weekly","monthly"].forEach(o=>{ const op=el("option"); op.value=o; op.textContent=o==="none"?"Never":o[0].toUpperCase()+o.slice(1); if(t.repeat===o)op.selected=true; sel.appendChild(op); });
  sel.onchange=()=>patchTask(t,{repeat:sel.value}).then(()=>renderMain()); repRow.appendChild(sel); ab.appendChild(repRow);
  inner.appendChild(ab);

  // notes
  const notes=el("textarea","notes"); notes.placeholder="Add notes"; notes.value=t.notes||"";
  notes.addEventListener("blur",()=>{ if(notes.value!==(t.notes||"")) patchTask(t,{notes:notes.value}).then(()=>renderMain()); });
  inner.appendChild(notes);

  // footer
  const foot=el("div","d-foot");
  const created=new Date(t.created_at).toLocaleDateString(undefined,{month:"short",day:"numeric",year:"numeric"});
  foot.innerHTML=`<span>Created ${created}</span>`;
  const del=el("button","d-del"); del.textContent="Delete task"; del.onclick=()=>{ if(confirm("Delete this task?")) deleteTask(t); };
  foot.appendChild(del); inner.appendChild(foot);

  d.innerHTML=""; d.appendChild(inner);
}

/* ================= LIST DIALOGS ================= */
const EMOJIS=["📋","✓","🏠","💼","🛒","🎯","💡","📚","💪","🌱","✈️","🔧","💰","🎨","📞","🍳"];
const COLORS=["#4b57c4","#2fb5a8","#e8a13a","#8b6cf0","#e0607a","#43b56a","#5b7cfa","#e07b39"];
function popup(node){ const p=el("div","pop"); p.appendChild(node); p.addEventListener("mousedown",e=>{ if(e.target===p) p.remove(); }); document.body.appendChild(p); return p; }
function newListDialog(existing){
  const card=el("div","pop-card");
  let emoji=existing?.emoji||"📋", color=existing?.color||COLORS[0];
  card.innerHTML=`<h3>${existing?"Rename list":"New list"}</h3>
    <label class="field"><span>Name</span><input id="nl-name" value="${esc(existing?.name||"")}" placeholder="e.g. Pulsco, Groceries, PE Study"/></label>
    <div class="emoji-row"></div><div class="color-row"></div>
    <div class="pop-actions"><button class="btn-ghost" id="nl-cancel">Cancel</button><button class="btn-primary" id="nl-save" style="margin:0">${existing?"Save":"Create"}</button></div>`;
  const er=card.querySelector(".emoji-row"); EMOJIS.forEach(e=>{ const b=el("button"); b.textContent=e; if(e===emoji)b.classList.add("sel"); b.onclick=()=>{emoji=e; er.querySelectorAll("button").forEach(x=>x.classList.remove("sel")); b.classList.add("sel");}; er.appendChild(b); });
  const cr=card.querySelector(".color-row"); COLORS.forEach(c=>{ const b=el("button"); b.style.background=c; if(c===color)b.classList.add("sel"); b.onclick=()=>{color=c; cr.querySelectorAll("button").forEach(x=>x.classList.remove("sel")); b.classList.add("sel");}; cr.appendChild(b); });
  const p=popup(card);
  card.querySelector("#nl-cancel").onclick=()=>p.remove();
  card.querySelector("#nl-save").onclick=()=>{ const name=card.querySelector("#nl-name").value.trim(); if(!name)return; if(existing){ existing.emoji=emoji; existing.color=color; renameListFull(existing,name,emoji,color);} else createList(name,emoji,color); p.remove(); };
  card.querySelector("#nl-name").focus();
}
async function renameListFull(l,name,emoji,color){ const u=await db("lists","update",{name,emoji,color},l.id); Object.assign(l,u); renderAll(); }
function listOptions(l){
  const card=el("div","pop-card");
  card.innerHTML=`<h3>${l.emoji||"📋"} ${esc(l.name)}</h3>
    <div class="pop-actions" style="justify-content:stretch;flex-direction:column;gap:8px">
      <button class="btn-ghost" id="lo-rename">Rename / edit</button>
      <button class="btn-danger" id="lo-del">Delete list & its tasks</button>
      <button class="btn-ghost" id="lo-cancel">Cancel</button>
    </div>`;
  const p=popup(card);
  card.querySelector("#lo-cancel").onclick=()=>p.remove();
  card.querySelector("#lo-rename").onclick=()=>{ p.remove(); newListDialog(l); };
  card.querySelector("#lo-del").onclick=()=>{ if(confirm(`Delete "${l.name}" and all its tasks? This can't be undone.`)){ deleteList(l); p.remove(); } };
}

/* ================= FOCUS PROTOCOL ================= */
const BLOCKS=[
  {key:"strategic",time:"7:00 – 8:30 AM",name:"Strategic Review & Planning",goal:"Relaxed alertness — calm enough to see the big picture, sharp enough to prioritize.",
   pure:"Alpha 8–12 Hz / 528 Hz",mixed:"Light rain + green noise",pureQ:"alpha waves 8-12 hz focus music",mixedQ:"green noise rain sounds study",start:420,end:510,color:"#5b7cfa"},
  {key:"deep",time:"8:30 – 11:30 AM",name:"Deep Work — Eat the Frog",goal:"High-binding efficiency for your hardest, most cognitively demanding task.",
   pure:"40 Hz gamma isochronic",mixed:"Brown noise + gamma",pureQ:"40 hz gamma isochronic tones focus",mixedQ:"brown noise deep focus 3 hours",start:510,end:690,color:"#e8a13a"},
  {key:"comms",time:"11:30 – 12:30 PM",name:"Communications",goal:"Steady, responsive focus for email, calls, and quick turnarounds.",
   pure:"Beta 14–20 Hz",mixed:"Lo-fi / café ambience",pureQ:"beta waves 14-20 hz concentration",mixedQ:"lofi hip hop beats to work",start:690,end:750,color:"#2fb5a8"},
  {key:"midday",time:"12:30 – 1:30 PM",name:"Midday Reset",goal:"Real recovery. Lead with a 20-min NSDR session — the most evidence-backed item here.",
   pure:"NSDR (20 min guided)",mixed:"Theta 4–7 Hz calm",pureQ:"NSDR 20 minute non sleep deep rest",mixedQ:"theta waves relaxation 432 hz",start:750,end:810,color:"#43b56a"},
  {key:"creative",time:"1:30 – 4:00 PM",name:"Creative Synthesis",goal:"Loose, associative thinking — connect ideas, draft, design.",
   pure:"Alpha–theta / 432 Hz",mixed:"Café noise + ambient",pureQ:"alpha theta creativity 432 hz",mixedQ:"coffee shop background noise creative",start:810,end:960,color:"#8b6cf0"},
];
const CHECKLIST=[
  "Get early daylight — 5–10 min outside or by a window",
  "Hydrate before caffeine",
  "Name today's #1 priority (below)",
  "Delay caffeine ~90 min after waking",
  "Phone out of reach for the first deep block",
];
const SCIENCE=[
  ["The cue is a conditioned trigger","A sound that reliably precedes focus becomes a Pavlovian “go” signal. Stack an implementation intention — “when I press play, I open the one task” — and you've combined two of the most robust findings in behavior science. Your ritual works because you built that association."],
  ["Steady noise masks distraction","Brown and pink noise physically cover the sudden sounds that hijack attention, so the work environment stops interrupting you."],
  ["Wordless audio matches energy without stealing language","Lyrics compete with verbal work for the same brain resources. Instrumental tones and noise raise arousal without pulling on the words you're trying to think in."],
  ["Ultradian structure with real recovery","Attention runs in ~90-minute cycles. Structuring work into blocks and taking genuine rest — NSDR beats scrolling — is what sustains output across a day. NSDR is the single most evidence-supported piece of this protocol."],
];
const yt=q=>`https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`;

function clHeights(){ const d=new Date(); return d.getHours()*60+d.getMinutes(); }
function renderFocus(m){
  const nowMin=clHeights(); const cur=BLOCKS.find(b=>nowMin>=b.start && nowMin<b.end);
  const dayKey="focus.cl."+todayStr();
  const clState=JSON.parse(localStorage.getItem(dayKey)||"{}");
  const priKey="focus.pri."+todayStr();

  m.innerHTML="";
  const head=el("div","focus-head");
  head.innerHTML=`<h1 class="page-title">🎯 Focus Protocol</h1>
    <p class="page-sub">${greeting()}, Rob — here's the day's rhythm. Sound is your cue to work; the schedule is the scaffold.</p>`;
  m.appendChild(head);

  if(cur){ const tag=el("div","now-tag"); tag.textContent=`● Now: ${cur.name}`; m.appendChild(tag); }

  // Today's #1 priority — writes into My Day
  const pri=el("div","focus-priority");
  pri.innerHTML=`<span class="star">★</span><input placeholder="Today's #1 priority — press Enter to add it to My Day"/>`;
  const pinp=pri.querySelector("input");
  pinp.addEventListener("keydown",async e=>{ if(e.key==="Enter"&&pinp.value.trim()){ const v=pinp.value.trim();
    const t=await db("tasks","insert",{title:v,list_id:defaultList()?.id||null,is_important:true,my_day_date:todayStr(),position:Date.now()%100000});
    state.tasks.unshift(t); pinp.value=""; toast("Added to My Day ☀️"); renderSidebar(); }});
  m.appendChild(pri);

  // Morning checklist
  const cl=el("div","checklist");
  CHECKLIST.forEach((txt,i)=>{
    const item=el("div","check-item"+(clState[i]?" on":""));
    item.innerHTML=`<button class="check" ${clState[i]?'style="background:var(--accent);border-color:var(--accent);color:#fff"':''}>✓</button><span class="cl-label">${esc(txt)}</span>`;
    item.onclick=()=>{ clState[i]=!clState[i]; localStorage.setItem(dayKey,JSON.stringify(clState)); renderFocus(m); };
    cl.appendChild(item);
  });
  m.appendChild(cl);

  // Blocks
  BLOCKS.forEach(b=>{
    const card=el("div","block"+(b===cur?" current":"")); card.style.setProperty("--bk",b.color);
    card.innerHTML=`
      <div class="block-top"><span class="block-time">${b.time}</span></div>
      <h3>${esc(b.name)}</h3>
      <p class="goal">${esc(b.goal)}</p>
      <div class="audio">
        <a href="${yt(b.pureQ)}" target="_blank" rel="noopener"><span class="kind">Pure</span> ${esc(b.pure)} ↗</a>
        <a href="${yt(b.mixedQ)}" target="_blank" rel="noopener"><span class="kind">Mixed</span> ${esc(b.mixed)} ↗</a>
      </div>`;
    m.appendChild(card);
  });

  // Science accordion
  const acc=el("div","accordion");
  acc.innerHTML=`<div class="acc-head">How this actually works <span class="chev">›</span></div><div class="acc-body"></div>`;
  const body=acc.querySelector(".acc-body");
  SCIENCE.forEach(([h,p])=>{ const s=el("div","sci"); s.innerHTML=`<h4>${esc(h)}</h4><p>${esc(p)}</p>`; body.appendChild(s); });
  const dis=el("div","disclaimer"); dis.innerHTML="The specific Hz values (Solfeggio tones, exact frequencies) aren't clinically proven — treat them as conditioned triggers and expectancy effects, which are real and worth keeping. The mechanisms above are what carry the load.";
  body.appendChild(dis);
  acc.querySelector(".acc-head").onclick=()=>acc.classList.toggle("open");
  m.appendChild(acc);
}

/* ================= SHELL WIRING ================= */
function openSidebar(){ $("#sidebar").classList.add("open"); $("#scrim").classList.remove("hidden"); }
function closeSidebar(){ $("#sidebar").classList.remove("open"); $("#scrim").classList.add("hidden"); }
function wireShell(){
  $("#menu-btn").onclick=openSidebar;
  $("#scrim").onclick=closeSidebar;
  $("#add-list").onclick=()=>newListDialog(null);
  $("#signout").onclick=async()=>{ await sb.auth.signOut(); };
  $("#theme-btn").onclick=()=>{ const cur=document.documentElement.getAttribute("data-theme")==="dark"?"light":"dark"; document.documentElement.setAttribute("data-theme",cur); localStorage.setItem("focus.theme",cur); };
  const s=$("#search"); s.addEventListener("input",()=>{ searchQuery=s.value; if(searchQuery&&activeView!=="search"){ activeView="search"; selectedTaskId=null; } if(!searchQuery&&activeView==="search"){ activeView="myday"; } renderAll(); });
  // Re-sync when returning to the tab (cross-device)
  document.addEventListener("visibilitychange",()=>{ if(document.visibilityState==="visible"&&user) loadAll(); });
}

/* ================= BOOT ================= */
function showScreen(which){ ["auth","setup","app"].forEach(id=>$("#"+id).classList.toggle("hidden",id!==which)); }
function applyTheme(){ const t=localStorage.getItem("focus.theme"); if(t) document.documentElement.setAttribute("data-theme",t); }

async function boot(){
  applyTheme();
  if(!initClient()){ showScreen("setup"); return; }
  wireAuth(); wireShell();
  sb.auth.onAuthStateChange(async (_evt,session)=>{
    user=session?.user||null;
    if(user){ showScreen("app"); await loadAll(); }
    else { showScreen("auth"); }
  });
  const {data}=await sb.auth.getSession();
  user=data.session?.user||null;
  if(user){ showScreen("app"); await loadAll(); } else { showScreen("auth"); }
}
document.addEventListener("DOMContentLoaded",boot);
