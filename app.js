// Exam Writer — no timer; Center Number + Candidate Name; plain-text printing

let fileHandle = null;
let autosaveTimer = null;
let dirty = false;

const $ = (s) => document.querySelector(s);

async function registerSW() {
  if ('serviceWorker' in navigator) {
    try {
      await navigator.serviceWorker.register('./service-worker.js', { scope: './' });
      console.log('✅ Service Worker registered from deployed root');
    } catch (err) {
      console.error('❌ Service Worker registration failed:', err);
    }
  }
}

window.addEventListener('load', registerSW);

function setDirty(v) {
  dirty = v;
  $('#dirtyDot').hidden = !v;
}
function updateWordCount() {
  const text = $('#editor').value.trim();
  const words = text ? text.match(/\b\w+\b/g)?.length ?? 0 : 0;
  $('#wordCount').textContent = `${words} word${words === 1 ? '' : 's'}`;
}

async function ensurePersistence() {
  if (navigator.storage?.persist) {
    try { await navigator.storage.persist(); } catch {}
  }
}

/* ---------- First Save Gate ---------- */
async function showFirstSaveGate() {
  const dlg = $('#firstSaveDialog');
  if (!dlg.open) dlg.showModal();
}
async function hideFirstSaveGate() {
  const dlg = $('#firstSaveDialog');
  if (dlg.open) dlg.close();
}

async function firstSaveFlow() {
  try {
    fileHandle = await window.showSaveFilePicker({
      suggestedName: buildSuggestedName(),
      types: [{ description: 'Exam Document', accept: { 'text/plain': ['.txt'] } }],
    });
    await writeToFile('');          // create an empty file right away
    await afterSuccessfulSavePick();
  } catch (err) {
    console.warn('First save cancelled or failed', err);
  }
}

/* ---------- Core helpers ---------- */
function buildSuggestedName() {
  const center = ($('#centerNumber').value || 'center').replace(/\s+/g, '_');
  const id = ($('#candidateId').value || 'candidate').replace(/\s+/g, '_');
  const title = ($('#examTitle').value || 'exam').replace(/\s+/g, '_');
  const date = new Date().toISOString().slice(0,10);
  return `${center}-${id}-${title}-${date}.txt`;
}
async function writeToFile(text) {
  if (!fileHandle) return;
  const w = await fileHandle.createWritable();
  await w.write(text);
  await w.close();
  setDirty(false);
}
async function writeOPFSBackup(text) {
  if (!navigator.storage?.getDirectory) return;
  const root = await navigator.storage.getDirectory();
  const fh = await root.getFileHandle('autosave-backup.txt', { create: true });
  const w = await fh.createWritable();
  await w.write(text);
  await w.close();
}

function buildDocumentText() {
  const header =
`Center Number: ${$('#centerNumber').value || ''}\n` +
`Candidate ID: ${$('#candidateId').value || ''}\n` +
`Candidate Name: ${$('#candidateName').value || ''}\n` +
`Exam Title: ${$('#examTitle').value || ''}\n` +
`Saved: ${new Date().toLocaleString()}\n---\n\n`;
  return header + $('#editor').value;
}

function startAutosave() {
  if (autosaveTimer) clearInterval(autosaveTimer);
  autosaveTimer = setInterval(async () => {
    try {
      $('#autosaveStatus').textContent = 'Autosave: saving…';
      const text = buildDocumentText();
      if (fileHandle) await writeToFile(text);
      else { await writeOPFSBackup(text); setDirty(false); }
      $('#autosaveStatus').textContent = 'Autosave: up to date';
    } catch (e) {
      $('#autosaveStatus').textContent = 'Autosave: error';
      console.error(e);
    }
  }, 60_000);
}

async function afterSuccessfulSavePick() {
  await hideFirstSaveGate();
  const wasDisabled = $('#editor').disabled;
  $('#editor').disabled = false;
  if (wasDisabled) $('#editor').focus();
  if (!autosaveTimer) startAutosave();
}

/* ---------- Commands ---------- */
async function newDoc() {
  $('#editor').value = '';
  setDirty(false);
  fileHandle = null;
  updateWordCount();
  await showFirstSaveGate();
}
async function saveAs() {
  try {
    fileHandle = await window.showSaveFilePicker({
      suggestedName: buildSuggestedName(),
      types: [{ description: 'Exam Document', accept: { 'text/plain': ['.txt'] } }],
    });
    await writeToFile(buildDocumentText());
    await afterSuccessfulSavePick();
  } catch {}
}
function printDoc() {
  // Prepare print-only elements
  syncPrintViews();
  window.print();
}
function toggleFullscreen() {
  if (!document.fullscreenElement)
    document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(()=>{});
  else document.exitFullscreen().catch(()=>{});
}

/* ---------- Print sync ---------- */
function syncPrintViews() {
  // header
  $('#pCenter').textContent = $('#centerNumber').value || '';
  $('#pId').textContent = $('#candidateId').value || '';
  $('#pName').textContent = $('#candidateName').value || '';
  $('#pTitle').textContent = $('#examTitle').value || '';
  // body
  $('#printView').textContent = $('#editor').value;
}
window.addEventListener('beforeprint', syncPrintViews);

/* ---------- Shortcuts ---------- */
function bindShortcuts() {
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key.toLowerCase() === 'n') { e.preventDefault(); newDoc(); }
    if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 's') { e.preventDefault(); saveAs(); }
    if (e.ctrlKey && e.key.toLowerCase() === 'p') { /* default print ok */ }
  });
}

/* ---------- Init ---------- */
window.addEventListener('DOMContentLoaded', async () => {
  registerSW();
  ensurePersistence();

  // UI
  $('#newBtn').addEventListener('click', newDoc);
  $('#saveAsBtn').addEventListener('click', saveAs);
  $('#printBtn').addEventListener('click', printDoc);
  $('#fullscreenBtn').addEventListener('click', toggleFullscreen);
  bindShortcuts();

  $('#firstSaveConfirm').addEventListener('click', async (ev) => { ev.preventDefault(); await firstSaveFlow(); });
  $('#firstSaveCancel').addEventListener('click', () => {});

  $('#editor').addEventListener('input', () => { setDirty(true); updateWordCount(); });
  updateWordCount();

  // Force first save before typing
  await showFirstSaveGate();

  window.addEventListener('beforeunload', (e) => {
    if (dirty) { e.preventDefault(); e.returnValue = ''; }
  });

  // Autosave loop (backs up to OPFS until user picks a file)
  startAutosave();
});
