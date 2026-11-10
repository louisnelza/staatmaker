// Browser-only wiring: tabs, the import dropzone, the in-page dialog, and start-up.
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

/* ---------------- EVENTS ---------------- */
const tabEls = [...document.querySelectorAll('.tab')];
function showTab(name){
  const tab = tabEls.find(t=>t.dataset.view===name) || tabEls[0];
  tabEls.forEach(t=>{ const on = t===tab; t.classList.toggle('active', on); t.setAttribute('aria-selected', on); t.tabIndex = on ? 0 : -1; });
  document.querySelectorAll('.view').forEach(v=>v.classList.toggle('active', v.id==='view-'+tab.dataset.view));
  try{ localStorage.setItem('staatmaker:tab', tab.dataset.view); }catch(e){ /* a remembered tab is only a convenience */ }
  const bar = tab.parentElement; // on narrow screens the tab strip scrolls sideways: keep the active tab in sight
  if(bar.scrollWidth > bar.clientWidth) bar.scrollLeft = Math.max(0, tab.offsetLeft - bar.offsetLeft - 24);
  return tab;
}
tabEls.forEach((tab,i)=>{
  tab.addEventListener('click', ()=>showTab(tab.dataset.view));
  tab.addEventListener('keydown', e=>{
    const step = e.key==='ArrowRight' ? 1 : e.key==='ArrowLeft' ? -1 : 0;
    if(!step) return;
    e.preventDefault();
    const next = showTab(tabEls[(i+step+tabEls.length)%tabEls.length].dataset.view);
    next.focus(); next.scrollIntoView({block:'nearest', inline:'nearest'});
  });
});
try{ showTab(localStorage.getItem('staatmaker:tab')); }catch(e){ showTab(); }

const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('file-input');
async function importFiles(list){
  if(!list.length) return;
  dropzone.classList.add('busy');
  try{ await processFiles(list, document.getElementById('bank-picker').value); }
  finally{ dropzone.classList.remove('busy'); }
}
dropzone.addEventListener('click', ()=>fileInput.click());
dropzone.addEventListener('keydown', e=>{ if(e.key==='Enter' || e.key===' '){ e.preventDefault(); fileInput.click(); } });
dropzone.addEventListener('dragover', e=>{e.preventDefault(); dropzone.classList.add('drag');});
dropzone.addEventListener('dragleave', ()=>dropzone.classList.remove('drag'));
dropzone.addEventListener('drop', e=>{
  e.preventDefault(); dropzone.classList.remove('drag');
  importFiles([...e.dataTransfer.files]);
});
fileInput.addEventListener('change', e=>{
  const list = [...e.target.files];
  fileInput.value = '';
  importFiles(list);
});
document.getElementById('rule-kw').addEventListener('keydown', e=>{ if(e.key==='Enter') addRule(); });

// In-page replacement for alert / confirm / prompt. Resolves to true (OK), false (cancelled), or, with
// opts.input, the typed text (null if cancelled). Calls queue up so one dialog never replaces another.
let dialogQueue = Promise.resolve();
function showDialog(opts){
  const run = () => new Promise(resolve=>{
    const dlg = document.getElementById('dlg'), input = document.getElementById('dlg-input');
    const ok = document.getElementById('dlg-ok'), cancel = document.getElementById('dlg-cancel');
    document.getElementById('dlg-title').textContent = opts.title || (opts.confirm ? 'Are you sure?' : 'Heads up');
    document.getElementById('dlg-msg').textContent = opts.msg;
    input.hidden = !opts.input; input.value = '';
    cancel.hidden = !opts.confirm;
    ok.textContent = opts.okLabel || 'OK';
    ok.className = 'btn' + (opts.danger ? ' danger solid' : '');
    dlg.returnValue = 'cancel';
    dlg.onclose = () => {
      const yes = dlg.returnValue === 'ok';
      resolve(opts.input ? (yes ? input.value : null) : yes);
    };
    dlg.showModal();
    (opts.input ? input : ok).focus();
  });
  const result = dialogQueue.then(run);
  dialogQueue = result.catch(()=>{});
  return result;
}

/* ---------------- INIT ---------------- */
(async function init(){
  await loadData();
  renderAll();
  lastSaveStatus = {ok:true, time:null};
  const el = document.getElementById('save-indicator');
  if(el){
    el.textContent = transactions.length ? `Loaded ${transactions.length} transactions from this browser's storage` : `Ready — nothing saved in this browser yet`;
  }
})();
