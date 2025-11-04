// Exam Writer – admin PIN, open/save, autosave, paste-block, theme,
// Manual pagination with header date + page number, Help dialog, and zoom shortcuts.

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
function setDirty(v) {
  dirty = v;
  const dot = $("#dirtyDot");
  dot.hidden = false;

  // State color updates
  if (v) {
    dot.className = "dot dirty"; // unsaved (red)
  } else {
    dot.className = "dot saved"; // saved (green)
  }
}
async function ensurePersistence(){ if(navigator.storage?.persist){ try{ await navigator.storage.persist(); }catch{} }}

/* ---------- Theme ---------- */
function applyTheme(t){ document.documentElement.setAttribute("data-theme", t); localStorage.setItem("theme", t); }
function initTheme(){ applyTheme(localStorage.getItem("theme") || "dark"); }
function toggleTheme(){ applyTheme((localStorage.getItem("theme")||"dark")==="dark"?"light":"dark"); }

/* ---------- Zoom (editor only) ---------- */
const BASE_EDITOR_REM = 1.05; // keep in sync with CSS default
function applyZoom(level){ // level is a multiplier, e.g., 1.0, 1.1, 0.9
  const clamped = Math.min(2.0, Math.max(0.6, level));
  document.documentElement.style.setProperty("--editor-size", `${BASE_EDITOR_REM * clamped}rem`);
  localStorage.setItem("editorZoom", String(clamped));
}
function initZoom(){
  const z = parseFloat(localStorage.getItem("editorZoom") || "1");
  applyZoom(isFinite(z) ? z : 1);
}
function zoomIn(){ applyZoom((parseFloat(localStorage.getItem("editorZoom")||"1")) + 0.1); }
function zoomOut(){ applyZoom((parseFloat(localStorage.getItem("editorZoom")||"1")) - 0.1); }
function zoomReset(){ applyZoom(1); }

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
function startAutosave() {
  if (autosaveTimer) clearInterval(autosaveTimer);
  autosaveTimer = setInterval(async () => {
    try {
      $("#autosaveStatus").textContent = "Autosave: saving…";
      $("#dirtyDot").className = "dot saving"; // amber while saving

      const text = buildDocumentText();
      if (fileHandle) {
        await writeToFile(text);
      } else {
        await writeOPFSBackup(text);
        setDirty(false);
      }

      $("#autosaveStatus").textContent = "Autosave: up to date";
      $("#dirtyDot").className = "dot saved"; // green after save
    } catch (e) {
      $("#autosaveStatus").textContent = "Autosave: error";
      $("#dirtyDot").className = "dot dirty"; // red if failed
      console.error(e);
    }
  }, 60_000);
}

/* ---------- PRINT: paginated header with date + page number ---------- */
function buildFooterOnlyPages() {
  const stack = document.getElementById('printStack');
  stack.innerHTML = '';

  const text = document.getElementById('editor').value || '';
  const lines = text.split(/\r?\n/);

  // Offscreen measuring block using real mm-based dimensions
  const measure = document.createElement('div');
  Object.assign(measure.style, {
    position: 'absolute',
    visibility: 'hidden',
    left: '-9999px',
    top: '0',
    whiteSpace: 'pre-wrap',
    wordWrap: 'break-word',
    width: 'calc(210mm - 18mm - 18mm)', // A4 width - L/R margins
    font: '12pt/1.5 "Courier New", ui-monospace, Menlo, Consolas, monospace'
  });
  document.body.appendChild(measure);

  // ---- DIMENSIONS (sync with CSS) ----
  const PAGE_H_MM   = 297;
  const TOP_MM      = 16;
  const BOTTOM_MM   = 18;
  const HEADER_MM   = 22;  // visual header height incl. hr
  const FUDGE_MM    = 5;   // matches CSS --print-fudge
  const BODY_PAD_MM = 2;   // safety
  const PAGE_CONTENT_MM = PAGE_H_MM - TOP_MM - BOTTOM_MM - FUDGE_MM;
  const BODY_MAX_MM     = PAGE_CONTENT_MM - HEADER_MM - BODY_PAD_MM;
  measure.style.maxHeight = `${BODY_MAX_MM}mm`;
  // ------------------------------------

  // Greedy pagination by binary search per page
  let start = 0;
  const pages = [];
  while (start < lines.length) {
    let lo = start + 1, hi = lines.length, fit = start + 1;
    while (lo <= hi) {
      const mid = Math.floor((lo + hi) / 2);
      measure.textContent = lines.slice(start, mid).join('\n');
      if (measure.scrollHeight <= measure.clientHeight) {
        fit = mid; lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    pages.push([start, fit]);
    start = fit;
  }

  const total = Math.max(1, pages.length);
  const fmtDate = new Date().toLocaleDateString('en-GB');

  // Render each page block with header meta (date left, page right)
  pages.forEach(([s,e], i) => {
    const page = document.createElement('div');
    page.className = 'p-page';

    const header = document.createElement('div');
    header.className = 'p-header';
    header.innerHTML = `
      <div class="ids">
        <div><strong>Center Number:</strong> ${document.getElementById('centerNumber').value || ''}</div>
        <div><strong>Candidate ID:</strong> ${document.getElementById('candidateId').value || ''}</div>
        <div><strong>Candidate Name:</strong> ${document.getElementById('candidateName').value || ''}</div>
        <div><strong>Exam Title:</strong> ${document.getElementById('examTitle').value || ''}</div>
      </div>
      <div class="p-meta">
        <span>${fmtDate}</span>
        <span>Page ${i+1} of ${total}</span>
      </div>
      <hr />
    `;

    const body = document.createElement('div');
    body.className = 'p-body';
    body.textContent = lines.slice(s, e).join('\n');

    page.appendChild(header);
    page.appendChild(body);
    stack.appendChild(page);
  });

  document.body.removeChild(measure);
}

function printDoc(){
  buildFooterOnlyPages();
  window.print();
}

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

/* ---------- Help modal ---------- */
function openHelp(){ $("#helpDialog").showModal(); }
function initHelp(){
  $("#helpBtn").addEventListener("click", openHelp);
  $("#helpCloseBtn").addEventListener("click", ()=> $("#helpDialog").close());
}

/* ---------- Shortcuts ---------- */
function bindShortcuts(){
  document.addEventListener("keydown",(e)=>{
    // New
    if(e.ctrlKey && e.key.toLowerCase()==="n"){e.preventDefault();newDoc();}
    // Open (Ctrl+Shift+O)
    if(e.ctrlKey && e.shiftKey && e.key.toLowerCase()==="o"){e.preventDefault();openExisting();}
    // Save (Ctrl+Shift+S)
    if(e.ctrlKey && e.shiftKey && e.key.toLowerCase()==="s"){e.preventDefault();saveAs();}
    // Print (Ctrl+P) – keep default behavior
    if(e.ctrlKey && e.key.toLowerCase()==="p"){ /* allow default */ }

    // Zoom In: Ctrl+Shift+'+'  (also treat '=' when Shift is held)
    if(e.ctrlKey && e.shiftKey && (e.key==='+' || e.key==='=')){ e.preventDefault(); zoomIn(); }
    // Zoom Out: Ctrl+Shift+'-'
    if(e.ctrlKey && e.shiftKey && e.key==='-'){ e.preventDefault(); zoomOut(); }
    // Zoom Reset: Ctrl+Shift+'0'
    if(e.ctrlKey && e.shiftKey && e.key==='0'){ e.preventDefault(); zoomReset(); }
  });
}

/* ---------- Init ---------- */
window.addEventListener("DOMContentLoaded",async()=>{
  registerSW(); ensurePersistence(); initTheme(); initZoom();

  $("#newBtn").addEventListener("click",newDoc);
  $("#openBtn").addEventListener("click",openExisting);
  $("#saveAsBtn").addEventListener("click",saveAs);
  $("#printBtn").addEventListener("click",printDoc);
  $("#fullscreenBtn").addEventListener("click",toggleFullscreen);
  $("#themeBtn").addEventListener("click",toggleTheme);
  initHelp();
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
