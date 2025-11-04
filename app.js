// Exam Writer – full version with admin PIN exit panel

let fileHandle = null;
let autosaveTimer = null;
let dirty = false;
let adminPinHash = localStorage.getItem("adminPinHash") || null;

const $ = (s) => document.querySelector(s);

/* ---------- SW ---------- */
async function registerSW() {
  if ("serviceWorker" in navigator) {
    try { await navigator.serviceWorker.register("./service-worker.js", { scope: "./" }); } catch {}
  }
}

/* ---------- UI helpers ---------- */
function setDirty(v){ dirty=v; $("#dirtyDot").hidden=!v; }
function updateWordCount(){
  const t=$("#editor").value.trim();
  const w=t ? (t.match(/\b\w+\b/g)?.length ?? 0) : 0;
  $("#wordCount").textContent=`${w} word${w===1?'':'s'}`;
}
async function ensurePersistence(){ if(navigator.storage?.persist){ try{ await navigator.storage.persist(); }catch{} }}

/* ---------- Theme ---------- */
function applyTheme(t){ document.documentElement.setAttribute("data-theme", t); localStorage.setItem("theme", t); }
function initTheme(){ applyTheme(localStorage.getItem("theme") || "dark"); }
function toggleTheme(){ applyTheme((localStorage.getItem("theme")||"dark")==="dark"?"light":"dark"); }

/* ---------- File helpers ---------- */
function buildSuggestedName(){
  const c=($("#centerNumber").value||"center").replace(/\s+/g,"_");
  const id=($("#candidateId").value||"candidate").replace(/\s+/g,"_");
  const title=($("#examTitle").value||"exam").replace(/\s+/g,"_");
  const date=new Date().toISOString().slice(0,10);
  return `${c}-${id}-${title}-${date}.txt`;
}
async function writeToFile(text){
  if(!fileHandle) return;
  const w=await fileHandle.createWritable();
  await w.write(text); await w.close(); setDirty(false);
}
async function writeOPFSBackup(text){
  if(!navigator.storage?.getDirectory) return;
  const root=await navigator.storage.getDirectory();
  const fh=await root.getFileHandle("autosave-backup.txt",{create:true});
  const w=await fh.createWritable(); await w.write(text); await w.close();
}

/* ---------- Document text ---------- */
function buildDocumentText(){
  const header =
`Center Number: ${$("#centerNumber").value||""}\n`+
`Candidate ID: ${$("#candidateId").value||""}\n`+
`Candidate Name: ${$("#candidateName").value||""}\n`+
`Exam Title: ${$("#examTitle").value||""}\n`+
`Saved: ${new Date().toLocaleString()}\n---\n\n`;
  return header + $("#editor").value;
}

/* ---------- Open/Save/New ---------- */
async function openExisting(){
  try{
    const [h]=await window.showOpenFilePicker({types:[{description:"Text",accept:{"text/plain":[".txt"]}}]});
    if(!h) return;
    fileHandle=h;
    const f=await h.getFile(); const text=await f.text(); loadFromText(text);
    await afterSuccessfulSavePick();
  }catch{}
}
function loadFromText(text){
  const sep=/\r?\n---\r?\n\r?\n?/;
  if(sep.test(text)){
    const [hdr,body=""]=text.split(sep,2);
    const get=(l)=>(hdr.match(new RegExp(`^${l}:\\s*(.*)$`,"mi"))||[])[1]||"";
    $("#centerNumber").value=get("Center Number");
    $("#candidateId").value=get("Candidate ID");
    $("#candidateName").value=get("Candidate Name");
    $("#examTitle").value=get("Exam Title");
    $("#editor").value=body;
  }else $("#editor").value=text;
  updateWordCount();
}
async function newDoc(){ $("#editor").value=""; setDirty(false); fileHandle=null; updateWordCount(); await showFirstSaveGate(); }
async function saveAs(){
  try{
    fileHandle=await window.showSaveFilePicker({suggestedName:buildSuggestedName(),types:[{description:"Exam Document",accept:{"text/plain":[".txt"]}}]});
    await writeToFile(buildDocumentText());
    await afterSuccessfulSavePick();
  }catch{}
}

/* ---------- First Save Gate ---------- */
async function showFirstSaveGate(){ const d=$("#firstSaveDialog"); if(!d.open) d.showModal(); }
async function hideFirstSaveGate(){ const d=$("#firstSaveDialog"); if(d.open) d.close(); }
async function firstSaveFlow(){
  try{
    fileHandle=await window.showSaveFilePicker({suggestedName:buildSuggestedName(),types:[{description:"Exam Document",accept:{"text/plain":[".txt"]}}]});
    await writeToFile(""); await afterSuccessfulSavePick();
  }catch(e){console.warn("firstSaveFlow failed",e);}
}
async function afterSuccessfulSavePick(){
  await hideFirstSaveGate(); $("#editor").disabled=false; $("#editor").focus(); if(!autosaveTimer) startAutosave();
}

/* ---------- Autosave ---------- */
function startAutosave(){
  if(autosaveTimer) clearInterval(autosaveTimer);
  autosaveTimer=setInterval(async()=>{
    try{
      $("#autosaveStatus").textContent="Autosave: saving…";
      const t=buildDocumentText();
      if(fileHandle) await writeToFile(t); else { await writeOPFSBackup(t); setDirty(false); }
      $("#autosaveStatus").textContent="Autosave: up to date";
    }catch(e){$("#autosaveStatus").textContent="Autosave: error"; console.error(e);}
  },60_000);
}

/* ---------- Print ---------- */
function syncPrintViews(){
  $("#pCenter").textContent=$("#centerNumber").value||"";
  $("#pId").textContent=$("#candidateId").value||"";
  $("#pName").textContent=$("#candidateName").value||"";
  $("#pTitle").textContent=$("#examTitle").value||"";
  $("#printView").textContent=$("#editor").value;
}
window.addEventListener("beforeprint",syncPrintViews);
function printDoc(){ syncPrintViews(); window.print(); }

/* ---------- Fullscreen ---------- */
function toggleFullscreen(){ if(!document.fullscreenElement) document.documentElement.requestFullscreen({navigationUI:"hide"}).catch(()=>{}); else document.exitFullscreen().catch(()=>{}); }

/* ---------- Editor hardening ---------- */
function hardenEditor(){
  const ed=$("#editor"); const block=(e)=>{e.preventDefault();e.stopPropagation();};
  ed.addEventListener("paste",block);
  ed.addEventListener("drop",block);
  ed.addEventListener("contextmenu",block);
}

/* ---------- Admin PIN ---------- */
async function sha256Hex(str){
  const buf=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,"0")).join("");
}
async function verifyAdminPin(pin){
  if(!adminPinHash) return pin==="0000"; // default 0000
  return (await sha256Hex(pin))===adminPinHash;
}
function setAdminPin(pin){ sha256Hex(pin).then(h=>{adminPinHash=h;localStorage.setItem("adminPinHash",h);}); }

function openAdminDialog(){ $("#adminDialog").showModal(); $("#adminPanel").hidden=true; $("#adminPin").value=""; }
function initAdminTriggers(){
  let taps=0,timer;
  $("#brandHotspot").addEventListener("click",()=>{
    taps++; clearTimeout(timer); timer=setTimeout(()=>{taps=0;},1500);
    if(taps>=5){taps=0;openAdminDialog();}
  });
  document.addEventListener("keydown",(e)=>{
    if(e.ctrlKey && e.shiftKey && e.key.toLowerCase()==="e"){e.preventDefault();openAdminDialog();}
    if(e.ctrlKey && e.altKey && e.key.toLowerCase()==="k"){e.preventDefault();openAdminDialog();}
  });
  $("#adminCancel").addEventListener("click",()=>$("#adminDialog").close());
  $("#adminUnlock").addEventListener("click",async()=>{
    const ok=await verifyAdminPin($("#adminPin").value);
    if(!ok){alert("Incorrect PIN");return;}
    $("#adminPanel").hidden=false;
  });
  $("#forceSaveBtn").addEventListener("click",async()=>{
    if(fileHandle) await writeToFile(buildDocumentText());
    else await writeOPFSBackup(buildDocumentText());
  });
  $("#exitAppBtn").addEventListener("click",()=>{ try{window.close();}catch{} });
}

/* ---------- Shortcuts ---------- */
function bindShortcuts(){
  document.addEventListener("keydown",(e)=>{
    if(e.ctrlKey && e.key.toLowerCase()==="n"){e.preventDefault();newDoc();}
    if(e.ctrlKey && e.key.toLowerCase()==="o"){e.preventDefault();openExisting();}
    if(e.ctrlKey && e.shiftKey && e.key.toLowerCase()==="s"){e.preventDefault();saveAs();}
  });
}

/* ---------- Init ---------- */
window.addEventListener("DOMContentLoaded",async()=>{
  registerSW(); ensurePersistence(); initTheme();

  $("#newBtn").addEventListener("click",newDoc);
  $("#openBtn").addEventListener("click",openExisting);
  $("#saveAsBtn").addEventListener("click",saveAs);
  $("#printBtn").addEventListener("click",printDoc);
  $("#fullscreenBtn").addEventListener("click",toggleFullscreen);
  $("#themeBtn").addEventListener("click",toggleTheme);
  bindShortcuts();

  $("#firstSaveConfirm").addEventListener("click",async(ev)=>{ev.preventDefault();await firstSaveFlow();});
  $("#editor").addEventListener("input",()=>{setDirty(true);updateWordCount();});
  updateWordCount();
  hardenEditor();

  await showFirstSaveGate();
  window.addEventListener("beforeunload",(e)=>{if(dirty){e.preventDefault();e.returnValue="";}});
  startAutosave();

  initAdminTriggers();
});
