// Fact Garden. One script, three modes set by the page:
//   window.FG_MODE = "server"  progress saved per kid through api.php
//   window.FG_MODE = "demo"    nothing saved, all levels open
//   (unset)                    progress saved in this browser only
(function(){
"use strict";
const MODE = window.FG_MODE || "local";
const API = window.FG_API || "api.php";

// ---------- levels ----------
const L = [
  {id:"a5",  name:"Adding to 5",          op:"+", gen:()=>pairs(0,5,0,5).filter(([a,b])=>a+b<=5)},
  {id:"a10", name:"Adding to 10",         op:"+", gen:()=>pairs(0,10,0,10).filter(([a,b])=>a+b<=10&&a+b>5)},
  {id:"a20", name:"Adding into the teens",op:"+", gen:()=>pairs(2,9,2,9).filter(([a,b])=>a+b>10)},
  {id:"s10", name:"Taking away from 10",  op:"−", gen:()=>pairs(0,10,0,10).filter(([a,b])=>b<=a)},
  {id:"s20", name:"Taking away from teens",op:"−",gen:()=>pairs(2,9,2,9).filter(([x,y])=>x+y>10).map(([x,y])=>[x+y,y])},
  {id:"m1",  name:"Times 0, 1, 2, 5, 10", op:"×", gen:()=>[0,1,2,5,10].flatMap(a=>range(0,10).map(b=>[a,b]))},
  {id:"m2",  name:"Times 3 and 4",        op:"×", gen:()=>[3,4].flatMap(a=>range(0,10).map(b=>[a,b]))},
  {id:"m3",  name:"Times 6 to 9",         op:"×", gen:()=>[6,7,8,9].flatMap(a=>range(0,10).map(b=>[a,b]))},
];
function range(a,b){const r=[];for(let i=a;i<=b;i++)r.push(i);return r}
function pairs(a1,a2,b1,b2){return range(a1,a2).flatMap(a=>range(b1,b2).map(b=>[a,b]))}
L.forEach(l=>l.facts=l.gen().map(([a,b])=>({k:`${a}${l.op}${b}`,a,b,op:l.op,ans:l.op=="+"?a+b:l.op=="−"?a-b:a*b})));
const ALL = Object.fromEntries(L.flatMap(l=>l.facts).map(f=>[f.k,f]));

const ROUND=10, UNLOCK=0.8, WAIT_OK=2000, WAIT_FIX=2500;
const esc=s=>String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const blank=()=>({lv:0,f:{},rounds:0,fast:8});
const fix=s=>Object.assign(blank(),s||{});

// ---------- state and saving ----------
let S=blank(), KID=null, saveTimer=null, saveFailed=false;
function lsGet(k){try{return localStorage.getItem(k)}catch(e){return null}}
function lsSet(k,v){try{localStorage.setItem(k,v)}catch(e){}}

async function api(a, body){
  const opt = body ? {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body),credentials:"same-origin"} : {credentials:"same-origin"};
  try{
    const r = await fetch(`${API}?a=${a}`, opt);
    return await r.json();
  }catch(e){ return {ok:false,error:"Can't reach the server. Check the internet connection."} }
}

function save(now){
  if(MODE=="demo") return;
  if(MODE=="local"){ lsSet("factgarden",JSON.stringify(S)); return }
  clearTimeout(saveTimer);
  saveTimer=setTimeout(flush, now?0:800);
}
async function flush(){
  const r = await api("save",{state:S});
  saveFailed = !r.ok;
  const n=document.getElementById("savenote");
  if(n) n.textContent = saveFailed ? "Progress not saved yet. It will try again after the next card." : "";
  if(!r.ok && /Not signed in/.test(r.error||"")) login("Please sign in again.");
}

// ---------- learning logic ----------
const st=k=>S.f[k]||{s:0,miss:0};
const known=l=>l.facts.filter(f=>st(f.k).s>=3).length/l.facts.length;
const unlocked=i=>MODE=="demo"||i==0||known(L[i-1])>=UNLOCK||L.slice(i).some(l=>l.facts.some(f=>S.f[f.k]));
const shuffle=a=>a.map(x=>[Math.random(),x]).sort((p,q)=>p[0]-q[0]).map(p=>p[1]);

function buildRound(lvIdx){
  const lv=L[lvIdx], pick=[];
  const learning=shuffle(lv.facts.filter(f=>{const s=st(f.k).s;return s>0&&s<3}));
  const fresh=shuffle(lv.facts.filter(f=>st(f.k).s==0));
  const knownF=shuffle(lv.facts.filter(f=>st(f.k).s>=3));
  const old=shuffle(L.slice(0,lvIdx).flatMap(l=>l.facts).filter(f=>st(f.k).s>=3));
  pick.push(...learning.slice(0,5));
  pick.push(...fresh.slice(0,Math.max(2,6-pick.length)));
  pick.push(...old.slice(0,2));
  for(const pool of [knownF,learning,fresh,old]) for(const f of pool){if(pick.length>=ROUND)break;if(!pick.includes(f))pick.push(f)}
  return shuffle(pick.slice(0,ROUND));
}

// ---------- screens ----------
const app=document.getElementById("app");
let R=null;

function header(){
  if(MODE=="server"&&KID) return `<header class="top"><h1>Fact Garden</h1><div class="who"><span class="muted">Hi, ${esc(KID.name)}</span><button class="ghost" id="switch">Switch player</button></div></header>`;
  return `<header class="top"><h1>Fact Garden</h1><span class="muted small">${S.rounds} rounds played</span></header>`;
}
function wireHeader(){
  const b=document.getElementById("switch");
  if(b) b.onclick=async()=>{await api("logout",{});KID=null;S=blank();login()};
}

function home(){
  R=null;
  const lv=L[S.lv], pct=Math.round(known(lv)*100);
  app.innerHTML=`
    ${header()}
    ${MODE=="demo"?`<p class="banner">This is a demo. Nothing is saved, and all levels are open.</p>`:""}
    <button class="go" id="start">Play 10 cards</button>
    <p class="note" id="savenote">${saveFailed?"Progress not saved yet. It will try again after the next card.":""}</p>
    <section class="panel">
      <h2>${esc(lv.name)}: ${pct}% grown</h2>
      <div class="grid" id="grid"></div>
      <div class="legend">
        <span><i style="background:var(--seed)"></i>Not yet</span>
        <span><i style="background:var(--sprout)"></i>Sprouting</span>
        <span><i style="background:var(--grow)"></i>Growing</span>
        <span><i style="background:var(--rainbow)"></i>Got it</span>
      </div>
    </section>
    <section class="panel">
      <h2>Levels</h2>
      ${MODE=="demo"?"":`<p class="muted small" style="margin:0">The next level opens at ${UNLOCK*100}% grown. Grown-ups can tap a locked level twice to open it early.</p>`}
      <div class="levels">${L.map((l,i)=>{const p=Math.round(known(l)*100);const u=unlocked(i);
        return `<button class="lv ${i==S.lv?"on":""} ${u?"":"locked"}" data-i="${i}">
          <b>${esc(l.name)}</b><span class="pct">${u?p+"%":"locked"}</span>
          <span class="bar"><i style="width:${p}%"></i></span></button>`}).join("")}</div>
    </section>
    <section class="panel">
      <h2>Time to beat</h2>
      <p class="muted small" style="margin:0">Right answers inside this time make the rainbow and count toward Got it. Slower right answers still count as sprouting.</p>
      <div class="speed">${[4,6,8,10,15].map(n=>`<button class="${n==S.fast?"on":""}" data-s="${n}">${n} sec</button>`).join("")}</div>
    </section>
    <div class="row">
      ${MODE=="server"?`<a class="ghost small" href="#grownups" id="gu">Grown-ups</a>`:""}
      ${MODE=="local"?`<button class="ghost" id="reset">Reset all progress</button>`:""}
    </div>`;
  wireHeader();
  drawGrid(lv);
  document.getElementById("start").onclick=play;
  app.querySelectorAll(".lv").forEach(b=>b.onclick=()=>{
    const i=+b.dataset.i;
    if(!unlocked(i)&&b.dataset.armed!="1"){b.dataset.armed="1";b.querySelector(".pct").textContent="tap again";return}
    S.lv=i;save();home()});
  app.querySelectorAll(".speed button").forEach(b=>b.onclick=()=>{S.fast=+b.dataset.s;save();home()});
  const gu=document.getElementById("gu"); if(gu) gu.onclick=e=>{e.preventDefault();grownups()};
  const rs=document.getElementById("reset");
  if(rs) rs.onclick=()=>{if(rs.dataset.armed){S=Object.assign(blank(),{fast:S.fast});save();home()}else{rs.dataset.armed=1;rs.textContent="Tap again to erase everything"}};
}

function drawGrid(lv){
  const g=document.getElementById("grid");
  const cols=Math.min(11,Math.ceil(Math.sqrt(lv.facts.length*1.6)));
  g.style.gridTemplateColumns=`repeat(${cols},1fr)`;
  g.innerHTML=lv.facts.map((f,i)=>{const s=st(f.k).s;return `<div style="--h:${Math.round(i*330/lv.facts.length)}" class="cell ${s?"s"+Math.min(s,3):""}" title="${f.a} ${f.op} ${f.b}">${f.a}${f.op}${f.b}</div>`}).join("");
}

function play(){
  R={cards:buildRound(S.lv),i:0,typed:"",results:[],t0:0,fixing:false,lock:false,timer:null};
  app.innerHTML=`
    <div class="top"><button class="ghost" id="quit">Stop</button><div class="dots" id="dots"></div></div>
    <div class="card" id="card"><div class="prob" id="prob"></div><div class="tbar"><i id="tb"></i></div><div class="hint" id="hint"></div><div class="tap" id="tap"></div></div>
    <div class="pad" id="pad">${[7,8,9,4,5,6,1,2,3].map(n=>`<button data-k="${n}">${n}</button>`).join("")}
      <button class="del" data-k="del">⌫</button><button data-k="0">0</button><button class="enter" data-k="ok">✓</button></div>`;
  document.getElementById("quit").onclick=()=>{clearTimeout(R.timer);save(true);home()};
  document.getElementById("pad").onclick=e=>{const k=e.target.closest("button")?.dataset.k;if(k)key(k)};
  show();
}

function show(){
  R.typed="";R.fixing=false;R.lock=false;R.timer=null;R.t0=performance.now();
  document.getElementById("card").className="card";
  document.getElementById("hint").textContent="";
  document.getElementById("tap").textContent="";
  const tb=document.getElementById("tb");tb.style.animation="none";void tb.offsetWidth;tb.style.animation=`drain ${S.fast}s linear forwards`;
  render();
  document.getElementById("dots").innerHTML=R.cards.map((_,i)=>`<span style="--h:${i*36}" class="dot ${R.results[i]==null?"":R.results[i]?"ok":"no"}"></span>`).join("");
}
function render(){
  const c=R.cards[R.i];
  document.getElementById("prob").innerHTML=`${c.a} ${c.op} ${c.b} = <span class="ans">${R.typed||"&nbsp;"}</span>`;
}

function key(k){
  if(!R) return;
  if(R.lock){if(k=="ok"&&R.timer){clearTimeout(R.timer);R.timer=null;next()}return}
  if(k=="del"){R.typed=R.typed.slice(0,-1);render();return}
  if(k=="ok"){check();return}
  if(R.typed.length<3){R.typed+=k;render()}
}

function check(){
  if(!R.typed)return;
  const c=R.cards[R.i], ok=+R.typed==c.ans, card=document.getElementById("card"), hint=document.getElementById("hint");
  if(R.fixing){
    if(ok){R.lock=true;card.className="card right";hint.textContent="Yes. Remember that one.";document.getElementById("tap").textContent="Tap ✓ to go on";R.timer=setTimeout(next,WAIT_FIX)}
    else{R.typed="";render()}
    return;
  }
  const ms=performance.now()-R.t0, s=st(c.k), win=ms<=S.fast*1000;
  document.getElementById("tb").style.animationPlayState="paused";
  if(ok){
    s.s = win ? Math.min(3,s.s+1) : Math.max(s.s,1);
    R.results[R.i]=true;R.lock=true;
    card.className= win ? "card right rainbow" : "card right";
    hint.textContent= win ? ["Rainbow!","Nice!","Fast!","You got it!"][Math.floor(Math.random()*4)] : "Right! Try to beat the rainbow next time.";
    document.getElementById("tap").textContent="Tap ✓ to go on";
    S.f[c.k]=s;R.timer=setTimeout(next,WAIT_OK);
  }else{
    s.s=Math.max(0,Math.min(s.s,1)-1);s.miss=(s.miss||0)+1;S.f[c.k]=s;
    R.results[R.i]=false;R.fixing=true;
    card.className="card wrong";
    hint.textContent=`${c.a} ${c.op} ${c.b} = ${c.ans}. Type it in.`;
    R.typed="";render();
    if(R.cards.length<ROUND+4) R.cards.splice(Math.min(R.cards.length,R.i+3),0,c);
  }
  save();
}

function next(){R.i++;if(R.i>=R.cards.length)done();else show()}

function done(){
  S.rounds++;
  let msg="";
  if(known(L[S.lv])>=UNLOCK&&S.lv<L.length-1&&!S.f["_told"+S.lv]){S.f["_told"+S.lv]=1;msg=`New level open: ${L[S.lv+1].name}`}
  save(true);
  const right=R.results.filter(Boolean).length, total=R.results.length;
  const seen=[...new Set(R.cards)];
  const tough=seen.filter(c=>R.cards.some((d,j)=>d===c&&R.results[j]===false));
  const grown=seen.filter(c=>st(c.k).s>=3);
  app.innerHTML=`
    <section class="panel">
      ${msg?`<p class="chip" style="text-align:center">${esc(msg)}</p>`:""}
      <div class="big">${right} / ${total}</div>
      <p class="muted" style="text-align:center;margin:0">${right==total?"Perfect round!":right>=total*.7?"Good work.":"Every round makes these stick."}</p>
      ${grown.length?`<h2>Got it</h2><div class="grew">${grown.map(c=>`<span class="chip">${c.a} ${c.op} ${c.b} = ${c.ans}</span>`).join("")}</div>`:""}
      ${tough.length?`<h2>Keep practicing</h2><div class="grew">${tough.map(c=>`<span class="chip tough">${c.a} ${c.op} ${c.b} = ${c.ans}</span>`).join("")}</div>`:""}
    </section>
    <div class="row"><button class="go" id="again">One more round</button></div>
    <button class="ghost" id="back">See the garden</button>`;
  R=null;
  document.getElementById("again").onclick=play;
  document.getElementById("back").onclick=home;
}

// ---------- sign-in (server mode) ----------
function login(msg){
  R=null;
  app.innerHTML=`
    <header class="top"><h1>Fact Garden</h1></header>
    <form class="panel" id="lf" autocomplete="off">
      <h2>Who's playing?</h2>
      <div class="field"><label for="ln">Name</label><input id="ln" name="ln" autocapitalize="words" maxlength="40" value="${esc(lsGet("fg_last")||"")}"></div>
      <div class="field"><label for="lp">PIN</label><input id="lp" name="lp" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="4"></div>
      <p class="err" id="le">${esc(msg||"")}</p>
      <button class="go" type="submit">Start</button>
    </form>
    <a class="ghost small" href="#grownups" id="gu">Grown-ups</a>`;
  const n=document.getElementById("ln"), p=document.getElementById("lp");
  (n.value?p:n).focus();
  document.getElementById("gu").onclick=e=>{e.preventDefault();grownups()};
  document.getElementById("lf").onsubmit=async e=>{
    e.preventDefault();
    const r=await api("login",{name:n.value,pin:p.value});
    if(!r.ok){document.getElementById("le").textContent=r.error;p.value="";p.focus();return}
    lsSet("fg_last",r.kid.name);
    KID=r.kid; S=fix(r.state); home();
  };
}

// ---------- grown-ups (server mode) ----------
async function grownups(){
  R=null;
  const r=await api("parent");
  if(!r.ok||!r.parent) return parentLogin(r.ok?"":r.error);
  const k=await api("kids");
  if(!k.ok) return parentLogin(k.error);
  app.innerHTML=`
    <header class="top"><h1>Fact Garden</h1><div class="who"><button class="ghost" id="pout">Sign out</button><button class="ghost" id="pback">Back to the game</button></div></header>
    <section class="panel">
      <h2>Players</h2>
      ${k.kids.length?k.kids.map(kidCard).join(""):`<p class="muted" style="margin:0">No players yet. Add one below.</p>`}
    </section>
    <form class="panel" id="addf" autocomplete="off">
      <h2>Add a player</h2>
      <div class="inline">
        <div class="field"><label for="an">Name</label><input id="an" maxlength="40" autocapitalize="words"></div>
        <div class="field"><label for="ap">4-digit PIN</label><input id="ap" inputmode="numeric" pattern="[0-9]*" maxlength="4"></div>
      </div>
      <p class="err" id="ae"></p>
      <button class="go" type="submit">Add player</button>
    </form>`;
  document.getElementById("pout").onclick=async()=>{await api("parent_logout",{});back()};
  document.getElementById("pback").onclick=back;
  document.getElementById("addf").onsubmit=async e=>{
    e.preventDefault();
    const a=await api("add_kid",{name:document.getElementById("an").value,pin:document.getElementById("ap").value});
    if(!a.ok){document.getElementById("ae").textContent=a.error;return}
    grownups();
  };
  app.querySelectorAll("[data-act]").forEach(b=>b.onclick=()=>kidAction(b));
}

function kidCard(k){
  const s=fix(k.state), lv=L[s.lv]||L[0];
  const old=S; S=s; const pct=Math.round(known(lv)*100); S=old;
  const missed=Object.entries(s.f).filter(([key,v])=>ALL[key]&&v.miss>0).sort((a,b)=>b[1].miss-a[1].miss).slice(0,8);
  const last=k.updated_at?new Date(k.updated_at.replace(" ","T")).toLocaleDateString(undefined,{month:"short",day:"numeric"}):"not yet";
  return `<div class="kid">
    <h3>${esc(k.name)}</h3>
    <p class="muted small" style="margin:0">${esc(lv.name)}: ${pct}% grown · ${s.rounds} rounds · last played ${esc(last)} · time to beat ${s.fast} sec</p>
    ${missed.length?`<div class="grew" style="justify-content:flex-start">${missed.map(([key,v])=>{const f=ALL[key];return `<span class="chip tough">${f.a} ${f.op} ${f.b} = ${f.ans} · missed ${v.miss}</span>`}).join("")}</div>`:`<p class="muted small" style="margin:0">No missed facts yet.</p>`}
    <div class="btns">
      <button class="btn" data-act="pin" data-id="${k.id}">New PIN</button>
      <button class="btn" data-act="reset" data-id="${k.id}">Reset progress</button>
      <button class="btn danger" data-act="del" data-id="${k.id}">Remove player</button>
    </div>
    <div id="pinrow${k.id}" hidden class="inline">
      <div class="field"><label for="np${k.id}">New 4-digit PIN</label><input id="np${k.id}" inputmode="numeric" pattern="[0-9]*" maxlength="4"></div>
      <button class="btn primary" data-act="savepin" data-id="${k.id}">Save PIN</button>
    </div>
    <p class="note" id="kn${k.id}"></p>
  </div>`;
}

async function kidAction(b){
  const id=+b.dataset.id, act=b.dataset.act, note=document.getElementById("kn"+id);
  if(act=="pin"){document.getElementById("pinrow"+id).hidden=false;document.getElementById("np"+id).focus();return}
  if(act=="savepin"){
    const r=await api("set_pin",{id,pin:document.getElementById("np"+id).value});
    note.textContent=r.ok?"PIN changed.":r.error;
    if(r.ok) document.getElementById("pinrow"+id).hidden=true;
    return;
  }
  if(!b.dataset.armed){b.dataset.armed=1;b.textContent=act=="del"?"Tap again to remove":"Tap again to reset";return}
  const r=await api(act=="del"?"delete_kid":"reset_progress",{id});
  if(!r.ok){note.textContent=r.error;return}
  if(KID&&KID.id==id){ if(act=="del"){KID=null} else {S=blank()} }
  grownups();
}

function parentLogin(msg){
  app.innerHTML=`
    <header class="top"><h1>Fact Garden</h1><button class="ghost" id="pback">Back to the game</button></header>
    <form class="panel" id="pf">
      <h2>Grown-ups</h2>
      <p class="muted small" style="margin:0">Add players, change PINs, and see which facts each player keeps missing.</p>
      <div class="field"><label for="pp">Password</label><input id="pp" type="password" autocomplete="current-password"></div>
      <p class="err" id="pe">${esc(msg||"")}</p>
      <button class="go" type="submit">Sign in</button>
    </form>`;
  document.getElementById("pback").onclick=back;
  document.getElementById("pp").focus();
  document.getElementById("pf").onsubmit=async e=>{
    e.preventDefault();
    const r=await api("parent_login",{pass:document.getElementById("pp").value});
    if(!r.ok){document.getElementById("pe").textContent=r.error;return}
    grownups();
  };
}

function back(){ KID?home():login() }

// ---------- keyboard ----------
document.addEventListener("keydown",e=>{
  if(!R||!document.getElementById("pad"))return;
  if(/^[0-9]$/.test(e.key))key(e.key);
  else if(e.key=="Backspace")key("del");
  else if(e.key=="Enter")key("ok");
});

// ---------- start ----------
(async function boot(){
  if(MODE=="local"){ try{S=fix(JSON.parse(lsGet("factgarden")||"null"))}catch(e){S=blank()} home(); return }
  if(MODE=="demo"){ home(); return }
  app.innerHTML=`<header class="top"><h1>Fact Garden</h1></header><p class="muted">Loading…</p>`;
  const r=await api("me");
  if(!r.ok){ app.innerHTML=`<header class="top"><h1>Fact Garden</h1></header><section class="panel"><h2>Can't load the game</h2><p class="muted" style="margin:0">${esc(r.error)}</p></section>`; return }
  if(location.hash=="#grownups") return grownups();
  if(r.kid){ KID=r.kid; S=fix(r.state); home() } else login();
})();
})();
