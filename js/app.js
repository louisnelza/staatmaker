// Storage, statement parsing, categorisation, tax and rental calculations, and rendering.
// Nothing here runs on load except declarations, so the test runner can load it with a stubbed DOM.
/* ---------------- STORAGE ---------------- */
// This runs standalone in the browser (not inside a Claude chat), so it saves straight to this
// browser's own localStorage. Failures are surfaced in the UI rather than hidden, since silent
// failure is exactly what caused data to vanish on refresh before.
let lastSaveStatus = {ok:true, time:null};

async function storeGet(key){
  try{
    return localStorage.getItem(key);
  }catch(e){ console.error('Could not read from localStorage:', e); return null; }
}

async function storeSet(key, value){
  try{
    localStorage.setItem(key, value);
    lastSaveStatus = {ok:true, time:new Date()};
  }catch(e){
    console.error('Could not save to localStorage:', e);
    lastSaveStatus = {ok:false, time:new Date()};
  }
  updateSaveIndicator();
}

function updateSaveIndicator(){
  const el = document.getElementById('save-indicator');
  if(!el) return;
  if(lastSaveStatus.ok){
    el.textContent = `Saved to this browser${lastSaveStatus.time ? ' at ' + lastSaveStatus.time.toLocaleTimeString() : ''}`;
    el.className = '';
  }else{
    el.textContent = `Save failed. This browser's storage may be full or disabled. Download a backup from the Data panel now.`;
    el.className = 'failed';
  }
}

async function loadData(){
  try{
    const t = await storeGet('staatmaker:transactions');
    transactions = t ? JSON.parse(t) : [];
  }catch(e){ transactions = []; }
  try{
    const r = await storeGet('staatmaker:rules');
    rules = r ? JSON.parse(r) : DEFAULT_RULES.map(([kw,cat,tax])=>({kw,cat,tax}));
  }catch(e){ rules = DEFAULT_RULES.map(([kw,cat,tax])=>({kw,cat,tax})); }
  try{
    const f = await storeGet('staatmaker:files');
    files = f ? JSON.parse(f) : [];
  }catch(e){ files = []; }
  await loadHomeOffice();
  await loadRentalSettings();
  await loadViewYear();
  await loadProjectionSettings();
}
async function saveTransactions(){ await storeSet('staatmaker:transactions', JSON.stringify(transactions)); }
async function saveRules(){ await storeSet('staatmaker:rules', JSON.stringify(rules)); }
async function saveFiles(){ await storeSet('staatmaker:files', JSON.stringify(files)); }

let homeOffice = {officeArea:'', homeArea:'', equipment:'', costs:{}, checklist:{}};
// accrued: rent owed to the owner at the end of each tax year, keyed by the year's end year (e.g. {2026:'1500'}).
const RENTAL_SETTINGS_DEFAULT = () => ({cottageArea:'', propertyArea:'', monthsLet:'12', bondInterest:'', basisNote:'', treatment:{}, accrued:{}});
let rentalSettings = RENTAL_SETTINGS_DEFAULT();
async function loadRentalSettings(){
  try{
    const r = await storeGet('staatmaker:rental');
    if(r){ const o = JSON.parse(r); rentalSettings = Object.assign(RENTAL_SETTINGS_DEFAULT(), o, {treatment: Object.assign({}, o.treatment||{}), accrued: Object.assign({}, o.accrued||{})}); }
  }catch(e){ /* no saved settings yet */ }
}
async function saveRentalSettings(){ await storeSet('staatmaker:rental', JSON.stringify(rentalSettings)); }
let projectionSettings = {yearOffset:0, income:'', ageBand:'under65', medicalMembers:''};
async function loadProjectionSettings(){
  try{
    const p = await storeGet('staatmaker:projection');
    if(p) projectionSettings = Object.assign(projectionSettings, JSON.parse(p));
  }catch(e){ /* no saved settings yet */ }
}
// Sourced SARS figures (verify against sars.gov.za before relying on them — these change every Budget Speech).
// 2026 tax year: 1 Mar 2025 – 28 Feb 2026. 2027 tax year: 1 Mar 2026 – 28 Feb 2027 (adjusted 3.4% for inflation, Feb 2026 budget).
const TAX_YEAR_TABLES = {
  2026: {
    brackets: [
      {min:0, rate:0.18, base:0},
      {min:237101, rate:0.26, base:42678},
      {min:370501, rate:0.31, base:77362},
      {min:512801, rate:0.36, base:121475},
      {min:673001, rate:0.39, base:179147},
      {min:857901, rate:0.41, base:251258},
      {min:1817001, rate:0.45, base:644489}
    ],
    primaryRebate:17235, secondaryRebate:9444, tertiaryRebate:3145,
    medicalMain:364, medicalAdditional:246, raCapRand:350000
  },
  2027: {
    brackets: [
      {min:0, rate:0.18, base:0},
      {min:245101, rate:0.26, base:44118},
      {min:383101, rate:0.31, base:79998},
      {min:530201, rate:0.36, base:125599},
      {min:695801, rate:0.39, base:185215},
      {min:887001, rate:0.41, base:259783},
      {min:1878601, rate:0.45, base:666339}
    ],
    primaryRebate:17820, secondaryRebate:9765, tertiaryRebate:3249,
    medicalMain:376, medicalAdditional:254, raCapRand:430000
  }
};
function taxTableFor(endYear){
  if(TAX_YEAR_TABLES[endYear]) return {table:TAX_YEAR_TABLES[endYear], exact:true};
  // fall back to the nearest year we have real figures for
  const known = Object.keys(TAX_YEAR_TABLES).map(Number).sort((a,b)=>Math.abs(a-endYear)-Math.abs(b-endYear));
  return {table:TAX_YEAR_TABLES[known[0]], exact:false, fallbackYear:known[0]};
}
function computeBracketTax(income, brackets){
  if(income<=0) return 0;
  let b = brackets[0];
  for(const br of brackets){ if(income>=br.min) b = br; else break; }
  // SARS bands are "the amount above R237 100" etc., i.e. min-1 for every band after the first
  const floor = b.min > 0 ? b.min - 1 : 0;
  return b.base + b.rate*(income-floor);
}

async function saveProjectionSettings(){
  projectionSettings.yearOffset = parseInt(document.getElementById('proj-year-select').value) || 0;
  projectionSettings.income = document.getElementById('proj-income').value;
  projectionSettings.ageBand = document.getElementById('proj-age').value;
  projectionSettings.medicalMembers = document.getElementById('proj-medical-members').value;
  await storeSet('staatmaker:projection', JSON.stringify(projectionSettings));
}
async function persistProjectionSettings(){ await storeSet('staatmaker:projection', JSON.stringify(projectionSettings)); }



// South African tax years run 1 March to end of February. offset=0 is the current tax year,
// offset=1 is the previous one, etc.
function taxYearBounds(offset){
  const today = new Date();
  let startYear = today.getMonth() >= 2 ? today.getFullYear() : today.getFullYear() - 1; // month 2 = March
  startYear -= offset;
  const start = new Date(startYear, 2, 1); // 1 March
  const endActual = new Date(startYear+1, 2, 0); // last day of February
  return {start, end: endActual, endYear: startYear+1, label: `1 Mar ${startYear} – 28/29 Feb ${startYear+1}`};
}

// Local calendar date as YYYY-MM-DD. Transaction dates are plain YYYY-MM-DD strings, so ranges are compared
// as strings: new Date('2026-02-28') is UTC midnight, which in SA (UTC+2) falls before a local 28 Feb and
// used to drop the last day of the tax year.
function ymd(d){ return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
function dateInRange(dateStr, start, end){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(dateStr||'')) return false;
  return dateStr >= ymd(start) && dateStr <= ymd(end);
}

/* ---------------- TAX YEAR FILTER ---------------- */
// SA tax years run 1 March to end February and are named by the year they end in (2026 = Mar 2025 - Feb 2026).
function taxYearOf(dateStr){
  const m = /^(\d{4})-(\d{2})-\d{2}$/.exec(dateStr||'');
  if(!m) return null;
  return +m[2] >= 3 ? +m[1] + 1 : +m[1];
}
function taxYearLabel(y){ return `${y} tax year (1 Mar ${y-1} – ${new Date(y,2,0).getDate()} Feb ${y})`; }
let viewYear = null; // a tax year (number), 'all', or null = not chosen yet
function yearsWithData(){ return [...new Set(transactions.map(t=>taxYearOf(t.date)).filter(Boolean))].sort((a,b)=>b-a); }
// Until the user picks one: the latest completed tax year that has data (the one being filed), else the latest with data.
function effectiveViewYear(){
  if(viewYear==='all' || typeof viewYear==='number') return viewYear;
  const yrs = yearsWithData();
  if(!yrs.length) return 'all';
  const current = taxYearOf(ymd(new Date()));
  const done = yrs.filter(y=>y<current);
  return done.length ? done[0] : yrs[0];
}
function inViewYear(t){ const y = effectiveViewYear(); return y==='all' || taxYearOf(t.date)===y; }
function viewTxns(){ return transactions.filter(inViewYear); }
// Moves between the user's own accounts (e.g. paying the credit card from the cheque account) appear on both
// statements; they are neither income nor spending, so they are left out of the in/out totals.
const OWN_TRANSFER = 'Transfers - Own Accounts';
function countsInTotals(t){ return t.category !== OWN_TRANSFER; }
async function loadViewYear(){
  try{ const v = await storeGet('staatmaker:viewyear'); viewYear = v==='all' ? 'all' : (parseInt(v) || null); }catch(e){ viewYear = null; }
}
async function setViewYear(v){
  viewYear = v==='all' ? 'all' : (parseInt(v) || null);
  await storeSet('staatmaker:viewyear', String(viewYear));
  renderAll();
}
function renderYearBar(){
  const sel = document.getElementById('view-year');
  const cur = effectiveViewYear();
  const yrs = yearsWithData();
  if(typeof cur==='number' && !yrs.includes(cur)) yrs.push(cur);
  yrs.sort((a,b)=>b-a);
  sel.innerHTML = yrs.map(y=>`<option value="${y}" ${y===cur?'selected':''}>${taxYearLabel(y)}</option>`).join('')
    + `<option value="all" ${cur==='all'?'selected':''}>All imported rows</option>`;
  const outside = transactions.length - viewTxns().length;
  const noDate = transactions.filter(t=>!taxYearOf(t.date)).length;
  const notes = [];
  if(cur!=='all' && outside>0) notes.push(`${outside} imported row(s) fall outside this tax year and are not counted.`);
  if(noDate>0) notes.push(`${noDate} row(s) have no valid date and only show under All imported rows.`);
  document.getElementById('view-year-note').textContent = notes.join(' ');
}

const PROJECTION_CATEGORIES = [
  {cat:'Retirement Annuity', label:'Retirement Annuity Contributions', capType:'ra'},
  {cat:'Medical Aid Contributions', label:'Medical Aid Contributions', capType:null},
  {cat:'Medical - Other', label:'Additional Medical Expenses', capType:null},
  {cat:'Income Protection', label:'Income Protection Premiums', capType:null},
  {cat:'Donations', label:'Donations (Section 18A)', capType:'donations'}
];

function renderProjection(){
  const sel = document.getElementById('proj-year-select');
  if(sel.options.length===0){
    for(let i=0;i<2;i++){
      const b = taxYearBounds(i);
      const opt = document.createElement('option');
      opt.value = i; opt.textContent = (i===0?'Current — ':'Previous — ') + b.label;
      sel.appendChild(opt);
    }
  }
  sel.value = projectionSettings.yearOffset || 0;
  document.getElementById('proj-income').value = projectionSettings.income || '';
  document.getElementById('proj-age').value = projectionSettings.ageBand || 'under65';
  document.getElementById('proj-medical-members').value = projectionSettings.medicalMembers || '';

  const offset = parseInt(sel.value)||0;
  const {start, end, endYear} = taxYearBounds(offset);
  const {table, exact, fallbackYear} = taxTableFor(endYear);
  const today = new Date();
  const effectiveToday = today < end ? (today < start ? start : today) : end;
  const totalDays = Math.round((end - start)/86400000) + 1;
  const elapsedDays = Math.max(1, Math.round((effectiveToday - start)/86400000) + 1);
  const scale = totalDays / elapsedDays;
  const pct = Math.min(100, Math.round((elapsedDays/totalDays)*100));

  document.getElementById('proj-progress').innerHTML =
    `${elapsedDays} of ${totalDays} days into this tax year (${pct}%) — year-to-date figures are scaled ×${scale.toFixed(2)} to estimate the full year.`
    + (exact ? '' : ` <span class="warn-text">Using ${fallbackYear} SARS figures as the closest available reference — verify current rates on sars.gov.za.</span>`);

  const income = parseFloat(document.getElementById('proj-income').value) || null;
  const raCap = income ? Math.min(table.raCapRand, income*0.275) : table.raCapRand;
  const donationsCap = income ? income*0.10 : null;

  const projByCat = {};
  const rows = PROJECTION_CATEGORIES.map(pc=>{
    const ytd = transactions.filter(t=>t.category===pc.cat && dateInRange(t.date, start, effectiveToday)).reduce((s,t)=>s+Math.abs(t.amount),0);
    const projected = ytd * scale;
    projByCat[pc.cat] = projected;
    let capNote = '';
    if(pc.capType==='ra'){
      capNote = `Cap: ${fmtR(raCap)}${income?` (27.5% of income, capped at ${fmtR(table.raCapRand)})`:` (statutory ceiling for this year — add income above for your actual %-based cap)`}`;
      if(projected > raCap) capNote += ` — <span class="neg-text">projected total exceeds this cap; the excess isn't lost, it carries forward to next year</span>`;
    } else if(pc.capType==='donations'){
      capNote = income ? `Cap: ${fmtR(donationsCap)} (10% of income)` : 'Add an income estimate above to see the 10% cap';
      if(income && projected > donationsCap) capNote += ` — <span class="neg-text">projected total exceeds this cap; amounts above it don't qualify for the deduction that year</span>`;
    }
    return `
      <tr>
        <td class="nowrap">${pc.label}</td>
        <td class="amount">${fmtR(ytd)}</td>
        <td class="amount">${fmtR(projected)}</td>
        <td class="muted" style="font-size:12px;min-width:150px;">${capNote}</td>
      </tr>`;
  }).join('');

  document.getElementById('proj-table').innerHTML = `
    <div class="table-wrap">
      <table>
        <thead><tr><th>Category</th><th class="num">Year-to-date</th><th class="num">Projected full year</th><th>Notes</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;

  // Estimated tax outcome — only meaningful once an income figure is provided
  const taxEl = document.getElementById('proj-tax-estimate');
  if(!income){
    taxEl.innerHTML = `<div class="empty boxed" style="padding:22px 18px;">Add your estimated taxable income above to see a rough tax outcome — bracket, rebate, medical credit, and roughly what your projected retirement annuity and donations are worth in tax terms.</div>`;
  } else {
    const raDeductible = Math.min(projByCat['Retirement Annuity']||0, raCap);
    const donationsDeductible = donationsCap!==null ? Math.min(projByCat['Donations']||0, donationsCap) : (projByCat['Donations']||0);
    const taxableAfterDeductions = Math.max(0, income - raDeductible - donationsDeductible);

    const grossTax = computeBracketTax(taxableAfterDeductions, table.brackets);
    const rebate = table.primaryRebate
      + (projectionSettings.ageBand==='65to74' ? table.secondaryRebate : 0)
      + (projectionSettings.ageBand==='75plus' ? (table.secondaryRebate+table.tertiaryRebate) : 0);

    const members = parseInt(document.getElementById('proj-medical-members').value) || 0;
    const monthlyMedicalCredit = members>0 ? (table.medicalMain*Math.min(members,2) + table.medicalAdditional*Math.max(members-2,0)) : 0;
    const annualMedicalCredit = monthlyMedicalCredit*12;

    const netTax = Math.max(0, grossTax - rebate - annualMedicalCredit);

    // rough marginal rate at this income level, for the "value of your deduction" line
    let marginalRate = table.brackets[0].rate;
    for(const br of table.brackets){ if(taxableAfterDeductions>=br.min) marginalRate = br.rate; }
    const deductionValue = (raDeductible+donationsDeductible) * marginalRate;

    taxEl.innerHTML = `
      <div class="receipt">
        <h4>Estimated Tax Outcome</h4>
        <div class="sub">ROUGH ESTIMATE — ${exact?endYear:fallbackYear} SARS TABLE</div>
        <div class="line"><span>Taxable income (as entered)</span><span>${fmtR(income)}</span></div>
        <div class="line"><span>Less: RA deduction (projected, capped)</span><span>-${fmtR(raDeductible)}</span></div>
        <div class="line"><span>Less: Donations deduction (projected, capped)</span><span>-${fmtR(donationsDeductible)}</span></div>
        <div class="line"><span>= Taxable income after deductions</span><span>${fmtR(taxableAfterDeductions)}</span></div>
        <div class="line"><span>Tax per bracket table</span><span>${fmtR(grossTax)}</span></div>
        <div class="line"><span>Less: rebate</span><span>-${fmtR(rebate)}</span></div>
        ${members>0 ? `<div class="line"><span>Less: medical scheme fees tax credit</span><span>-${fmtR(annualMedicalCredit)}</span></div>` : ''}
        <div class="line total"><span>Estimated annual tax</span><span>${fmtR(netTax)}</span></div>
        <div class="note">Your RA and donation contributions this year are on track to be worth roughly ${fmtR(deductionValue)} in tax at your ${(marginalRate*100).toFixed(0)}% marginal rate. This ignores other income, other deductions, the additional medical expenses credit, and any other credits you may qualify for — it's a steer for planning, not a filing figure. A registered tax practitioner or SARS eFiling will give you the real number.</div>
      </div>`;
  }

  // Rental projection (cottage share applied). The lender-certificate bond interest is an annual
  // figure, so only the elapsed part of the year counts towards YTD; scaling then gives the full year.
  const rentalYTD = computeRental(t=>dateInRange(t.date, start, effectiveToday), {manual:false});
  const bondAnnual = round2((parseFloat(rentalSettings.bondInterest) || 0) * rentalShare().share);
  const bondYTD = bondAnnual * elapsedDays / totalDays;
  const rentalIncomeYTD = rentalYTD.income;
  const rentalExpenseYTD = rentalYTD.totalDeduction + bondYTD;
  const rentalEl = document.getElementById('proj-rental');
  if(rentalIncomeYTD===0 && rentalExpenseYTD===0){
    rentalEl.innerHTML = '';
  } else {
    const netYTD = rentalIncomeYTD - rentalExpenseYTD;
    const netProjected = netYTD * scale;
    rentalEl.innerHTML = `
      <div class="receipt">
        <h4>Rental Income Projection</h4>
        <div class="sub">${elapsedDays} DAYS INTO TAX YEAR</div>
        <div class="line"><span>Rental income (YTD → projected)</span><span>${fmtR(rentalIncomeYTD)} → ${fmtR(rentalIncomeYTD*scale)}</span></div>
        <div class="line"><span>Rental expenses (YTD → projected)</span><span>${fmtR(rentalExpenseYTD)} → ${fmtR(rentalExpenseYTD*scale)}</span></div>
        <div class="line total"><span>${netProjected>=0?'Projected net rental income':'Projected net rental loss'}</span><span>${fmtR(netProjected)}</span></div>
      </div>`;
  }
}
async function loadHomeOffice(){
  try{
    const h = await storeGet('staatmaker:homeoffice');
    if(h) homeOffice = Object.assign(homeOffice, JSON.parse(h));
  }catch(e){ /* no saved settings yet */ }
}
async function saveHomeOffice(){ await storeSet('staatmaker:homeoffice', JSON.stringify(homeOffice)); }

// In the browser these open the in-page dialog (showDialog, defined with the event wiring below);
// without it (the test harness) they fall back to the native alert/confirm/prompt.
function notify(msg, title){ if(typeof showDialog==='function') showDialog({title:title||'Heads up', msg}); else alert(msg); }
async function askConfirm(msg, opts){
  return typeof showDialog==='function' ? (await showDialog(Object.assign({msg, confirm:true}, opts||{}))) === true : confirm(msg);
}
async function askPassword(msg){
  return typeof showDialog==='function' ? await showDialog({title:'Password needed', msg, input:true, confirm:true, okLabel:'Unlock'}) : prompt(msg);
}

async function clearAllData(){
  if(!(await askConfirm('This clears all imported transactions, files and custom rules from your saved storage.', {title:'Clear all saved data?', okLabel:'Clear everything', danger:true}))) return;
  transactions = []; files = []; rules = DEFAULT_RULES.map(([kw,cat,tax])=>({kw,cat,tax}));
  await saveTransactions(); await saveFiles(); await saveRules();
  renderAll();
}

function downloadBackup(){
  const backup = {version:1, exportedAt:new Date().toISOString(), transactions, rules, files, homeOffice, rentalSettings, projectionSettings, viewYear};
  const blob = new Blob([JSON.stringify(backup, null, 2)], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `staatmaker-backup-${new Date().toISOString().slice(0,10)}.json`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

async function restoreBackup(file){
  try{
    const text = await file.text();
    const data = JSON.parse(text);
    if(!data.transactions){ notify('This doesn\'t look like a Staatmaker backup file.', 'Could not restore'); return; }
    if(!(await askConfirm(`This will replace your current data with the backup from ${data.exportedAt ? new Date(data.exportedAt).toLocaleString() : 'this file'} (${data.transactions.length} transactions).`, {title:'Restore this backup?', okLabel:'Replace my data'}))) return;
    transactions = data.transactions || [];
    rules = data.rules || DEFAULT_RULES.map(([kw,cat,tax])=>({kw,cat,tax}));
    files = data.files || [];
    homeOffice = Object.assign({officeArea:'', homeArea:'', equipment:'', costs:{}, checklist:{}}, data.homeOffice || {});
    projectionSettings = Object.assign({yearOffset:0, income:'', ageBand:'under65', medicalMembers:''}, data.projectionSettings || {});
    rentalSettings = Object.assign(RENTAL_SETTINGS_DEFAULT(), data.rentalSettings || {}, {treatment: Object.assign({}, (data.rentalSettings||{}).treatment || {}), accrued: Object.assign({}, (data.rentalSettings||{}).accrued || {})});
    viewYear = (data.viewYear==='all' || typeof data.viewYear==='number') ? data.viewYear : null;
    await storeSet('staatmaker:viewyear', String(viewYear));
    await saveTransactions(); await saveRules(); await saveFiles(); await saveHomeOffice(); await saveRentalSettings(); await persistProjectionSettings();
    renderAll();
    notify('Backup restored.', 'Done');
  }catch(e){
    console.error(e);
    notify('Could not read that backup file. Make sure it\'s an unmodified .json file downloaded from Staatmaker.', 'Could not restore');
  }
}

/* ---------------- CATEGORISATION ---------------- */
function categorise(desc){
  const d = (desc||'').toUpperCase();
  for(const r of rules){
    if(d.includes(r.kw.toUpperCase())){
      return {category:r.cat, taxLabel: r.tax ? (TAX_LABELS[r.cat] || r.cat) : null};
    }
  }
  return {category:'Uncategorised', taxLabel:null};
}

function reapplyRules(){
  transactions.forEach(t=>{
    const {category, taxLabel} = categorise(t.desc);
    t.category = category; t.taxLabel = taxLabel;
  });
  saveTransactions();
  renderAll();
}

function addRule(){
  const kw = document.getElementById('rule-kw').value.trim();
  const cat = document.getElementById('rule-cat').value;
  const tax = document.getElementById('rule-tax').checked;
  if(!kw) return;
  rules.unshift({kw, cat, tax});
  document.getElementById('rule-kw').value='';
  document.getElementById('rule-tax').checked=false;
  saveRules();
  renderRulesList();
}
function removeRule(idx){
  rules.splice(idx,1);
  saveRules();
  renderRulesList();
}

/* ---------------- FILE PARSING ---------------- */
function detectColumns(headers){
  const H = headers.map(h=>String(h||'').trim().toLowerCase());
  const find = (cands)=>{
    for(const c of cands){
      const i = H.findIndex(h=>h.includes(c));
      if(i>-1) return i;
    }
    return -1;
  };
  return {
    date: find(['date','transaction date','posting date','value date']),
    desc: find(['description','details','narrative','transaction description','reference']),
    amount: find(['amount']),
    debit: find(['debit','money out','withdrawal']),
    credit: find(['credit','money in','deposit']),
    balance: find(['balance'])
  };
}

function parseAmount(v){
  if(v===undefined||v===null||v==='') return null;
  let s = String(v).replace(/R/gi,'').replace(/\s/g,'').replace(/,/g,'');
  let neg = false;
  if(/^\(.*\)$/.test(s)){ neg=true; s=s.replace(/[()]/g,''); }
  if(/-$/.test(s)){ neg=true; s=s.replace(/-$/,''); } // trailing minus, e.g. "735.00-"
  if(/^-/.test(s)){ neg=true; }
  s = s.replace(/-/g,'');
  const n = parseFloat(s);
  if(isNaN(n)) return null;
  return neg ? -Math.abs(n) : n;
}

function parseDate(v){
  if(!v) return '';
  const s = String(v).trim();
  const MONTHS = {jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12'};
  let m = s.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
  if(m) return `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`;
  m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
  if(m){
    let yr = m[3].length===2 ? '20'+m[3] : m[3];
    return `${yr}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
  }
  m = s.match(/^(\d{1,2})\s+([A-Za-z]{3,9})\.?\s+(\d{2,4})/);
  if(m){
    const mon = MONTHS[m[2].slice(0,3).toLowerCase()];
    if(mon){
      let yr = m[3].length===2 ? '20'+m[3] : m[3];
      return `${yr}-${mon}-${m[1].padStart(2,'0')}`;
    }
  }
  return s;
}

function idGen(){ return 'tx_' + Math.random().toString(36).slice(2,10); }

async function handleCSVFile(file, bank){
  return new Promise((resolve)=>{
    Papa.parse(file, {
      complete: (results)=>{
        const rows = results.data.filter(r=>r.length>1 && r.some(c=>String(c).trim()!==''));
        if(rows.length<2){ resolve([]); return; }
        const headers = rows[0];
        const cols = detectColumns(headers);
        const out = [];
        for(let i=1;i<rows.length;i++){
          const row = rows[i];
          const dateRaw = cols.date>-1 ? row[cols.date] : '';
          const desc = cols.desc>-1 ? row[cols.desc] : row.slice(0,3).join(' ');
          if(!dateRaw && !desc) continue;
          let amt = null;
          if(cols.amount>-1) amt = parseAmount(row[cols.amount]);
          else if(cols.debit>-1 || cols.credit>-1){
            const debit = cols.debit>-1 ? parseAmount(row[cols.debit]) : null;
            const credit = cols.credit>-1 ? parseAmount(row[cols.credit]) : null;
            if(credit) amt = Math.abs(credit);
            else if(debit) amt = -Math.abs(debit);
          }
          if(amt===null || !dateRaw) continue;
          const {category, taxLabel} = categorise(desc);
          out.push({id:idGen(), date:parseDate(dateRaw), desc:String(desc).trim(), bank, amount:amt, category, taxLabel});
        }
        resolve(out);
      },
      error: ()=>resolve([])
    });
  });
}

async function loadPdfWithPassword(file){
  let password;
  for(let attempt=0; attempt<4; attempt++){
    try{
      const buf = await file.arrayBuffer(); // fresh buffer each attempt — pdf.js detaches it
      const task = pdfjsLib.getDocument(password!==undefined ? {data:buf, password} : {data:buf});
      const pdf = await task.promise;
      return pdf;
    }catch(err){
      if(err && err.name === 'PasswordException'){
        const incorrect = err.code === pdfjsLib.PasswordResponses.INCORRECT_PASSWORD;
        const msg = incorrect
          ? `That password didn't work for "${file.name}". Try again — it's often your SA ID number, or your bank account/client number:`
          : `"${file.name}" is password protected. Enter the password — SA banks usually use your ID number, or your account/client number:`;
        password = await askPassword(msg);
        if(password === null || password === ''){ return null; } // user cancelled
        continue;
      }
      console.error(err);
      return null;
    }
  }
  return null;
}

const AFRIKAANS_MONTHS = {
  jan:'01', januarie:'01', feb:'02', februarie:'02', mar:'03', maart:'03', apr:'04', april:'04',
  may:'05', mei:'05', jun:'06', junie:'06', jul:'07', julie:'07', aug:'08', augustus:'08',
  sep:'09', september:'09', oct:'10', okt:'10', oktober:'10', nov:'11', november:'11',
  dec:'12', des:'12', desember:'12'
};

const AFRIKAANS_GLOSSARY = [
  ['IB-BETALING NA','Internet banking payment to'],
  ['IB-BETALING UIT','Internet banking payment reversed'],
  ['IB OORPLASING NA','Internet banking transfer to'],
  ['ONMIDDELLIKE BETALING','Immediate payment'],
  ['FOOI ONMIDDELLIKE BETALING','Fee: immediate payment'],
  ['FOOI-VP GEWEIER ONVOLD FONDSE','Fee: payment reversed, insufficient funds'],
  ['KREDIETOORPLASING TUSSEN BANKE','Inter-bank credit transfer'],
  ['ELEKTRONIESE BANK BETALING VAN','Electronic bank payment from'],
  ['OORPLASING IN WERKLIKE TYD VAN','Real-time transfer from'],
  ['PAYSHAP-BETALING AAN','PayShap payment to'],
  ['GELDE PAYSHAP-BETALING','PayShap payment fee'],
  ['MAGNEETBANDKREDIET','Bulk salary credit'],
  ['OORTREKKINGS RENTE','Overdraft interest'],
  ['OORSKRYDINGSRENTE','Over-limit interest'],
  ['OORTREKKING-DIENSGELD','Overdraft service fee'],
  ['REKENINGBETALING','Account payment'],
  ['DEBIETOORPLASING','Debit transfer'],
  ['VASTE MAANDELIKSE FOOI','Fixed monthly fee'],
  ['GEMIGREERDE DC-DEBIET','Migrated debit card charge'],
  ['VERSEKERINGSPREMIE','Insurance premium'],
  ['DIENSOOREENKOMS','Service agreement'],
  ["TRGGST-NIE VOORSIEN NIE",'Transaction reversal'],
  ['KOSTE-ONBETAALDE ITEM','Cost: unpaid item'],
  ['TJEKKAART-AANKOOP','Debit card purchase'],
  ['DEBICHECK-DEBIETORDER','DebiCheck debit order'],
  ['LIDMAATSKAPFOOI','Membership fee'],
  ['SALDO OORGEBRING','Balance brought forward']
];
function translateDesc(desc){
  let out = desc;
  for(const [af,en] of AFRIKAANS_GLOSSARY){
    if(out.toUpperCase().includes(af)) out += ` (${en})`;
  }
  return out;
}

const SB_STOP_MARKERS = [
  'VERIFIEER ASSEBLIEF','BESOEK ASSEBLIEF','DIE STANDARD BANK VAN','BTW-REG','ONS ONDERSKRYF',
  'KLIENTESORGSENTRUM','EPOS:','BANKSTAAT','ACHIEVA TJEKREKENING','BLADSY','STAAT VAN','MAANDELIKS E-POS',
  'REKENINGNOMMER','MAANDEINDESALDO','BESONDERHEDE','OPSOMMING','PERKSTRUKTUUR',
  'OORTREKKINGSBESONDERHEDE','HIERDIE FOOIE SLUIT BTW','SALDO OORGEBRING','STAATNOMMER',
  'STAATFREKWENSIE','P.BUS','MARSHALLTOWN'
];

function isStandardBankAfrikaans(fullText){
  const t = fullText.toUpperCase();
  return t.includes('BANKSTAAT') && t.includes('DIENSGELD') && t.includes('BESONDERHEDE');
}

function getStatementYears(fullText){
  const m = fullText.match(/Staat van\s+\d{1,2}\s+([A-Za-z]+)\s+(\d{4})\s+tot\s+\d{1,2}\s+([A-Za-z]+)\s+(\d{4})/i);
  if(m){
    const startMonth = AFRIKAANS_MONTHS[m[1].toLowerCase()];
    const startYear = m[2];
    const endMonth = AFRIKAANS_MONTHS[m[3].toLowerCase()];
    const endYear = m[4];
    if(startMonth && endMonth) return {startMonth, startYear, endMonth, endYear};
  }
  const y = new Date().getFullYear();
  return {startMonth:'01', startYear:String(y), endMonth:'12', endYear:String(y)};
}

function parseStandardBankAfrikaans(fullText, bank){
  const years = getStatementYears(fullText);
  const lineRe = /^(.*?)\s*(-?R?\s?\d[\d,]*\.\d{2}-?)\s+(\d{2})\s+(\d{2})\s+(-?R?\s?\d[\d,]*\.\d{2}-?)\s*$/;
  const lines = fullText.split('\n').map(l=>l.trim()).filter(Boolean);
  const out = [];
  let current = null;
  // Every row prints the running balance, so each row's amount must take the previous balance to this one.
  // A jump means a row was missed (or misread); it is reported on import rather than silently imported.
  let prevBalance = null, prevDate = null;
  const breaks = [];
  for(const line of lines){
    const upper = line.toUpperCase();
    if(SB_STOP_MARKERS.some(mk=>upper.includes(mk))){ current = null; continue; }
    const m = line.match(lineRe);
    if(m){
      const rawDesc = m[1].replace(/##/g,'').trim();
      const amt = parseAmount(m[2]);
      const month = m[3], day = m[4];
      if(amt===null){ current = null; continue; }
      // pick the year matching whichever end of the statement period this month belongs to
      const year = (month === years.endMonth) ? years.endYear : (month === years.startMonth) ? years.startYear : years.endYear;
      const date = `${year}-${month}-${day}`;
      const balance = parseAmount(m[5]);
      if(prevBalance !== null && balance !== null){
        const gap = round2(balance - (prevBalance + amt));
        if(Math.abs(gap) >= 0.005) breaks.push({from:prevDate, to:date, gap});
      }
      prevBalance = balance; prevDate = date;
      const {category, taxLabel} = categorise(rawDesc);
      current = {id:idGen(), date, desc:rawDesc, descEN:translateDesc(rawDesc), bank, amount:amt, category, taxLabel};
      out.push(current);
    } else if(current){
      current.desc = (current.desc + ' ' + line).trim();
      current.descEN = translateDesc(current.desc);
      const recat = categorise(current.desc);
      current.category = recat.category;
      current.taxLabel = recat.taxLabel;
    }
  }
  out.reconcile = {checked:true, ok:breaks.length===0, breaks,
    problem: breaks.map(b=>`running balance is out by ${fmtR(b.gap)} between ${b.from} and ${b.to}, so a row there is probably missing`).join('; ')};
  return out;
}


// Standard Bank credit card statements (English, two-column "Transaction details" layout).
// Debits are printed positive and credits negative, so signs are flipped to match bank-account CSVs
// (spend negative, payments positive). Balance / closing-balance lines are not transactions.
const MONTHS_EN = {jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12'};
// Statement-summary wording that can sit next to a date and an amount but is never a transaction.
const CARD_NOT_TRANSACTION = /payment due|minimum (payment|amount)|total amount due|amount due|interest rate|credit limit|available (credit|balance)|statement date/i;
function isStandardBankCard(fullText){
  const t = fullText.toUpperCase();
  return t.includes('CREDIT LIMIT') && t.includes('TRANSACTION DETAILS') && t.includes('CLOSING BALANCE');
}
function parseStandardBankCard(fullText, bank){
  const out = [];
  const re = /(\d{1,2})\s+([A-Za-z]{3})\s+(\d{2})\s+(.+?)\s+(-?\d[\d,]*\.\d{2})(?:\s+(-?\d[\d,]*\.\d{2}))?(?=\s|$)/g;
  const seen = fullText.indexOf('Transaction details');
  const body = seen >= 0 ? fullText.slice(seen) : fullText;
  // The first balance brought forward and the last closing balance are kept so the import can check
  // the statement reconciles (a stray non-transaction line or a misread column shows up as a difference).
  let opening = null, closing = null;
  for(const line of body.split('\n')){
    if(closing !== null) break; // the closing balance ends the transaction table; anything after it is summary or footer
    // On real statements the closing balance line has no date ("Closing balance   1,234.56"), so the
    // transaction pattern below never sees it; the brought-forward line is dated, but accept either form.
    const undated = line.match(/^\s*(closing balance|balance brought forward)\s+(-?\d[\d,]*\.\d{2}-?)\s*$/i);
    if(undated){
      const v = parseAmount(undated[2]);
      if(/closing/i.test(undated[1])) closing = v; else if(opening === null) opening = v;
      continue;
    }
    for(const m of line.matchAll(re)){
      const mon = MONTHS_EN[m[2].toLowerCase()];
      if(!mon) continue;
      const desc = m[4].replace(/\s{2,}/g,' ').trim();
      if(/balance brought forward|opening balance/i.test(desc)){
        if(opening === null) opening = parseAmount(m[6] || m[5]);
        continue;
      }
      if(/closing balance/i.test(desc)){ closing = parseAmount(m[6] || m[5]); continue; }
      if(/balance carried forward/i.test(desc)) continue; // page-break running total, not a transaction
      if(CARD_NOT_TRANSACTION.test(desc)) continue;
      // foreign-currency purchases print the foreign amount first and the rand amount second
      const raw = parseAmount(m[6] || m[5]);
      if(raw === null) continue;
      const {category, taxLabel} = categorise(desc);
      out.push({id:idGen(), date:`20${m[3]}-${mon}-${m[1].padStart(2,'0')}`, desc, descEN:desc, bank, amount:-raw, category, taxLabel});
    }
  }
  out.reconcile = reconcileCard(out, opening, closing);
  return out;
}

// Card balances are amounts owed, so closing = brought forward + spend - payments = opening - sum(amount).
function reconcileCard(rows, opening, closing){
  if(opening === null || closing === null) return {checked:false, problem:'balance brought forward or closing balance not found, so the rows could not be checked'};
  const sum = rows.reduce((s,t)=>s+t.amount, 0);
  const expected = round2(opening - sum);
  const difference = round2(closing - expected);
  return {checked:true, ok: Math.abs(difference) < 0.005, opening, closing, expected, difference,
    problem:`imported rows leave ${fmtR(difference)} unaccounted for (closing balance ${fmtR(closing)}, rows give ${fmtR(expected)})`};
}

async function handlePDFFile(file, bank){
  const pdf = await loadPdfWithPassword(file);
  if(!pdf) return null; // cancelled, or a non-password error
  let fullText = '';
  for(let p=1;p<=pdf.numPages;p++){
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    let lastY=null, line='';
    for(const item of content.items){
      if(lastY!==null && Math.abs(item.transform[5]-lastY)>2){ fullText+=line+'\n'; line=''; }
      line += item.str + ' ';
      lastY = item.transform[5];
    }
    fullText += line + '\n';
  }

  if(isStandardBankAfrikaans(fullText)){
    return parseStandardBankAfrikaans(fullText, bank);
  }

  if(isStandardBankCard(fullText)){
    return parseStandardBankCard(fullText, bank);
  }

  const lines = fullText.split('\n');
  const out = [];
  const dateRe = /(\d{2}[\/\-.]\d{2}[\/\-.]\d{2,4}|\d{1,2}\s+[A-Za-z]{3,9}\.?\s+\d{2,4})/;
  const amtRe = /(-?R?\s?\d[\d,]*\.\d{2})\s*(cr|dr)?/gi;
  for(const raw of lines){
    const line = raw.trim();
    if(!line) continue;
    const dm = line.match(dateRe);
    if(!dm) continue;
    const amounts = [...line.matchAll(amtRe)];
    if(amounts.length===0) continue;
    const lastMatch = amounts[amounts.length-1];
    let amt = parseAmount(lastMatch[1]);
    if(amt===null) continue;
    const suffix = (lastMatch[2]||'').toLowerCase();
    if(suffix==='dr') amt = -Math.abs(amt);
    else if(suffix==='cr') amt = Math.abs(amt);
    let desc = line.replace(dateRe,'').replace(new RegExp(amtRe.source,'gi'),'').trim();
    desc = desc.replace(/\s{2,}/g,' ');
    if(!desc) continue;
    if(/balance brought forward|closing balance|opening balance|saldo oorgebring/i.test(desc)) continue;
    const {category, taxLabel} = categorise(desc);
    out.push({id:idGen(), date:parseDate(dm[1]), desc, descEN:desc, bank, amount:amt, category, taxLabel});
  }
  return out;
}

function txnKey(t){ return [t.bank,t.date,String(t.desc).replace(/\s+/g,' ').trim().toUpperCase(),Number(t.amount).toFixed(2)].join('|'); }

async function processFiles(fileList, bank){
  const newTxns = [];
  let skipped = 0, dupes = 0;
  const unsupported = [];
  const unreconciled = [];
  // Multiset of rows already held: a repeat inside one file is a genuine repeat purchase, but a row
  // already imported from an earlier (overlapping) statement is a duplicate and is dropped.
  const held = {};
  transactions.forEach(t=>{ const k=txnKey(t); held[k]=(held[k]||0)+1; });
  for(const file of fileList){
    let parsed = [];
    const lname = file.name.toLowerCase();
    if(lname.endsWith('.csv')){
      parsed = await handleCSVFile(file, bank);
    }else if(lname.endsWith('.pdf')){
      parsed = await handlePDFFile(file, bank);
      if(parsed === null){ skipped++; continue; }
    }else{
      unsupported.push(file.name); continue;
    }
    if(parsed.reconcile && !(parsed.reconcile.checked && parsed.reconcile.ok)) unreconciled.push(`${file.name}: ${parsed.reconcile.problem}`);
    const budget = Object.assign({}, held);
    const fresh = [];
    for(const t of parsed){
      const k = txnKey(t);
      if(budget[k] > 0){ budget[k]--; dupes++; } else fresh.push(t);
    }
    fresh.forEach(t=>{ const k=txnKey(t); held[k]=(held[k]||0)+1; });
    newTxns.push(...fresh);
    files.push({name:file.name, bank, count:fresh.length, importedAt:new Date().toISOString()});
  }
  transactions.push(...newTxns);
  await saveTransactions();
  await saveFiles();
  renderAll();
  const today = new Date().toISOString().slice(0,10);
  const future = newTxns.filter(t=>t.date > today).length;
  const notes = [];
  if(skipped>0) notes.push(`${skipped} file(s) were skipped — no password was entered (or it kept failing). Drop the file in again to retry.`);
  if(unsupported.length) notes.push(`Not imported (only .csv and .pdf are supported): ${unsupported.join(', ')}. Save Excel (.xls/.xlsx) statements as CSV first.`);
  if(unreconciled.length) notes.push(`Statement doesn't reconcile. Check the imported rows against the statement:\n${unreconciled.join('\n')}`);
  if(dupes>0) notes.push(`${dupes} row(s) were already imported from an earlier statement and were skipped.`);
  if(future>0) notes.push(`${future} imported row(s) are dated in the future — check the year in the source file.`);
  if(newTxns.length===0 && skipped===0 && dupes===0 && unsupported.length===0 && unreconciled.length===0 && fileList.length>0){
    notes.push('No transactions could be detected in that file. PDF layouts vary a lot between banks — you can still add rows manually, or try exporting a CSV from your bank\'s app/site instead, which parses more reliably.');
  }
  if(notes.length) notify(notes.join('\n\n'), newTxns.length ? `Imported ${newTxns.length} row(s), with notes` : 'Import notes');
}

/* ---------------- RENDER ---------------- */
function fmtR(n){
  const sign = n<0 ? '-' : '';
  return sign + 'R ' + Math.abs(n).toLocaleString('en-ZA',{minimumFractionDigits:2,maximumFractionDigits:2});
}

function renderRulesList(){
  const el = document.getElementById('rules-list');
  const q = (document.getElementById('rules-filter').value||'').toLowerCase();
  const shown = rules.map((r,i)=>[r,i]).filter(([r])=>!q || String(r.kw).toLowerCase().includes(q) || String(r.cat).toLowerCase().includes(q));
  el.innerHTML = shown.length ? shown.map(([r,i])=>`
    <div class="rule-row">
      <span class="kw">${escapeHtml(r.kw)}</span><span class="arrow">→</span>
      <span class="cat">${escapeHtml(r.cat)}${r.tax?' <span title="Tax-relevant" class="warn-text">★</span>':''}</span>
      <button class="icon-btn" onclick="removeRule(${i})" title="Remove rule" aria-label="Remove rule ${escapeHtml(r.kw)}">×</button>
    </div>`).join('') : `<p class="hint" style="padding:10px 0;">No rules match.</p>`;
  document.getElementById('rules-count').textContent = rules.length;
  const sel = document.getElementById('rule-cat');
  if(!sel.innerHTML) sel.innerHTML = DEFAULT_CATEGORIES.map(c=>`<option value="${c}">${c}</option>`).join('');
}

function renderFileList(){
  const el = document.getElementById('file-list');
  if(files.length===0){ el.innerHTML = '<p class="hint">No files imported yet.</p>'; return; }
  el.innerHTML = files.map(f=>`<div class="file-row"><div class="name" title="${escapeHtml(f.name)}">${escapeHtml(f.name)}</div><div class="meta">${escapeHtml(f.bank)} · ${f.count} new row${f.count===1?'':'s'}</div></div>`).join('');
}

function allCategories(){
  const set = new Set(DEFAULT_CATEGORIES);
  transactions.forEach(t=>set.add(t.category));
  return [...set];
}

function renderStats(){
  const rows = viewTxns();
  const counted = rows.filter(countsInTotals);
  const income = counted.filter(t=>t.amount>0).reduce((s,t)=>s+t.amount,0);
  const spend = counted.filter(t=>t.amount<0).reduce((s,t)=>s+Math.abs(t.amount),0);
  const taxTotal = rows.filter(t=>t.taxLabel).reduce((s,t)=>s+Math.abs(t.amount),0);
  const ownNote = counted.length < rows.length ? ' title="Excludes Transfers - Own Accounts"' : '';
  const el = document.getElementById('stat-row');
  el.innerHTML = `
    <div class="stat-card positive"${ownNote}><div class="label">Money in</div><div class="value">${fmtR(income)}</div></div>
    <div class="stat-card negative"${ownNote}><div class="label">Money out</div><div class="value">${fmtR(spend)}</div></div>
    <div class="stat-card"><div class="label">Transactions</div><div class="value">${rows.length}</div></div>
    <div class="stat-card flagged"><div class="label">Flagged tax-relevant</div><div class="value">${fmtR(taxTotal)}</div></div>
  `;
}

const ICON_DOC = `<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4M10 12h5M10 16h5"/></svg>`;
const ICON_HOME = `<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 11l8-7 8 7"/><path d="M6 10v10h12V10M10 20v-6h4v6"/></svg>`;

function renderTransactions(){
  const q = (document.getElementById('search-box').value||'').toLowerCase();
  const body = document.getElementById('txn-body');
  const cats = allCategories();
  // Category filter: rebuilt each time so new categories appear, keeping the current choice.
  const filterEl = document.getElementById('cat-filter');
  const catQ = cats.includes(filterEl.value) ? filterEl.value : '';
  filterEl.innerHTML = `<option value="">All categories</option>` + cats.map(c=>`<option value="${escapeHtml(c)}" ${c===catQ?'selected':''}>${escapeHtml(c)}</option>`).join('');
  const inYear = viewTxns();
  const rows = inYear
    .filter(t=>(!q || String(t.desc).toLowerCase().includes(q) || String(t.descEN||'').toLowerCase().includes(q)) && (!catQ || t.category===catQ))
    .sort((a,b)=> (b.date||'').localeCompare(a.date||''));
  document.getElementById('txn-count').textContent = !inYear.length ? '' : rows.length===inYear.length ? `${rows.length} rows` : `${rows.length} of ${inYear.length} rows`;
  if(rows.length===0){
    body.innerHTML = `<tr><td colspan="7">${
      transactions.length===0 ? `<div class="empty"><div class="icon">${ICON_DOC}</div><h4>Start with a bank statement</h4>
        <p>Everything is read and stored in this browser. Nothing leaves your computer.</p>
        <div class="steps"><div><b>1. Pick the bank</b>Choose which bank the statements come from, in the Import panel.</div><div><b>2. Drop in statements</b>CSV or PDF, several at once. Overlapping statements are de-duplicated.</div><div><b>3. Check the categories</b>Fix anything mis-sorted, then read off the tax totals.</div></div></div>`
      : inYear.length===0 ? `<div class="empty"><div class="icon">${ICON_DOC}</div>No transactions in this tax year. Choose another year at the top, or import a statement that covers it.</div>`
      : `<div class="empty"><div class="icon">${ICON_DOC}</div>No transactions match this search or filter.</div>`
    }</td></tr>`;
    return;
  }
  // Keep the keyboard position across the re-render that follows an edit.
  const ae = document.activeElement;
  const focusKey = ae && ae.dataset && ae.dataset.id ? [ae.dataset.id, ae.dataset.f] : null;
  body.innerHTML = rows.map(t=>`
    <tr>
      <td><input type="text" class="cell-input date" data-id="${t.id}" data-f="date" aria-label="Date" value="${escapeHtml(t.date||'')}" onchange="updateField('${t.id}','date',this.value)"></td>
      <td><input type="text" class="cell-input desc" data-id="${t.id}" data-f="desc" aria-label="Description" value="${escapeHtml(t.desc)}" onchange="updateField('${t.id}','desc',this.value)">${(t.descEN && t.descEN!==t.desc) ? `<div class="gloss">${escapeHtml(t.descEN)}</div>` : ''}</td>
      <td class="bank">${escapeHtml(t.bank||'')}</td>
      <td>
        <select class="cat-select${t.category==='Uncategorised'?' todo':''}" data-id="${t.id}" data-f="cat" aria-label="Category" onchange="updateCategory('${t.id}', this.value)">
          ${cats.map(c=>`<option value="${escapeHtml(c)}" ${c===t.category?'selected':''}>${escapeHtml(c)}</option>`).join('')}
        </select>
      </td>
      <td class="amount"><input type="number" step="0.01" class="cell-input amt ${t.amount<0?'neg':'pos'}" data-id="${t.id}" data-f="amt" aria-label="Amount" value="${Number(t.amount).toFixed(2)}" onchange="updateField('${t.id}','amount',parseFloat(this.value)||0)"></td>
      <td class="tight">${t.taxLabel ? `<span class="badge" title="Counts towards: ${escapeHtml(t.taxLabel)}">Tax</span>` : ''}</td>
      <td class="tight"><button class="icon-btn" onclick="deleteTxn('${t.id}')" title="Delete row" aria-label="Delete row">×</button></td>
    </tr>`).join('');
  if(focusKey && body.querySelector){
    const again = body.querySelector(`[data-id="${focusKey[0]}"][data-f="${focusKey[1]}"]`);
    if(again) again.focus();
  }
}

function escapeHtml(s){ return String(s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

// Re-render once the browser has finished moving focus (a change event fires mid-Tab), so the
// table can put the cursor back where the user was heading.
function renderSoon(){ if(typeof setTimeout==='function') setTimeout(renderAll, 0); else renderAll(); }

function updateField(id, field, value){
  const t = transactions.find(t=>t.id===id);
  if(!t) return;
  t[field] = value;
  if(field==='desc'){
    t.descEN = translateDesc(value);
    const {category, taxLabel} = categorise(value);
    // only auto-recategorise if it was still on the default guess, so manual overrides aren't clobbered
    if(t.category==='Uncategorised'){ t.category = category; t.taxLabel = taxLabel; }
  }
  saveTransactions();
  renderSoon();
}

function deleteTxn(id){
  transactions = transactions.filter(t=>t.id!==id);
  saveTransactions();
  renderAll();
}

function addManualTxn(){
  const bank = document.getElementById('bank-picker').value;
  transactions.unshift({id:idGen(), date:new Date().toISOString().slice(0,10), desc:'New transaction', descEN:'', bank, amount:0, category:'Uncategorised', taxLabel:null});
  saveTransactions();
  renderAll();
}

function updateCategory(id, cat){
  const t = transactions.find(t=>t.id===id);
  if(!t) return;
  t.category = cat;
  t.taxLabel = TAX_LABELS[cat] || null;
  saveTransactions();
  renderSoon();
}

function renderCategories(){
  const map = {};
  viewTxns().filter(t=>t.amount<0 && countsInTotals(t)).forEach(t=>{
    map[t.category] = map[t.category] || {total:0,count:0};
    map[t.category].total += Math.abs(t.amount);
    map[t.category].count += 1;
  });
  const entries = Object.entries(map).sort((a,b)=>b[1].total-a[1].total);
  const max = entries.length ? entries[0][1].total : 0;
  const sum = entries.reduce((s,e)=>s+e[1].total,0);
  const body = document.getElementById('cat-body');
  body.innerHTML = entries.length ? entries.map(([cat,v])=>`
    <tr><td>${cat}</td><td class="bar-cell"><div class="bar"><span style="width:${max ? (v.total/max*100).toFixed(1) : 0}%"></span></div></td><td class="amount">${fmtR(v.total)}</td><td class="amount">${sum ? (v.total/sum*100).toFixed(1) : '0.0'}%</td><td class="amount">${v.count}</td></tr>
  `).join('') : `<tr><td colspan="5"><div class="empty">No spending in this view yet.</div></td></tr>`;
}

function renderTax(){
  const map = {};
  viewTxns().filter(t=>t.taxLabel).forEach(t=>{
    map[t.taxLabel] = (map[t.taxLabel]||0) + Math.abs(t.amount);
  });
  const entries = Object.entries(map);
  const total = entries.reduce((s,[,v])=>s+v,0);
  const vy = effectiveViewYear();
  const el = document.getElementById('tax-receipt');
  if(entries.length===0){
    el.innerHTML = `<div class="empty boxed"><div class="icon">${ICON_DOC}</div>No tax-relevant items detected yet. Import statements, or add categorisation rules in the side panel (e.g. your retirement annuity or medical aid provider's name) so Staatmaker can flag them.</div>`;
    return;
  }
  el.innerHTML = `
    <div class="receipt">
      <h4>Tax-Relevant Summary</h4>
      <div class="sub">${vy==='all' ? 'ALL IMPORTED ROWS · CHOOSE A TAX YEAR FOR A RETURN' : taxYearLabel(vy).toUpperCase()}</div>
      ${entries.map(([label,v])=>`<div class="line"><span>${label}</span><span>${fmtR(v)}</span></div>`).join('')}
      <div class="line total"><span>Total flagged</span><span>${fmtR(total)}</span></div>
      <div class="note">These figures come from matching transaction descriptions and are estimates only. SARS requires the actual certificates for each deduction — your medical aid tax certificate, RA contribution certificate(s), and Section 18A donation receipts — so reconcile these totals against those documents before submitting your return.</div>
    </div>
  `;
}

/* ---------------- RENTAL APPORTIONMENT ---------------- */
function treatmentFor(cat){
  return (rentalSettings.treatment && rentalSettings.treatment[cat]) || (RENTAL_COST_MODEL[cat] && RENTAL_COST_MODEL[cat].treatment) || 'none';
}

// Cottage share of costs that serve the whole property: area ratio x months held out for letting / 12.
function rentalShare(){
  const c = parseFloat(rentalSettings.cottageArea) || 0;
  const p = parseFloat(rentalSettings.propertyArea) || 0;
  let m = parseFloat(rentalSettings.monthsLet);
  if(isNaN(m)) m = 12;
  m = Math.min(12, Math.max(0, m));
  const areaRatio = (p>0 && c>0) ? Math.min(1, c/p) : 0;
  return {areaRatio, months:m, share: areaRatio * m / 12, ready: p>0 && c>0};
}

const round2 = n => Math.round((n + Number.EPSILON) * 100) / 100;

// inRange: optional (txn)=>bool to limit the dates counted. opts.manual=false leaves out the typed-in bond interest.
function computeRental(inRange, opts){
  opts = opts || {};
  const inR = inRange || inViewYear;
  const sh = rentalShare();
  // Received: deposits tagged Rental Income (a refund paid back to a tenant, tagged the same way, reduces it).
  const received = round2(transactions.filter(t=>t.category==='Rental Income' && inR(t)).reduce((s,t)=>s+t.amount,0));
  // Received or accrued, whichever comes first: + owed at this year end, - owed at the start (already taxed last year).
  // Only for a single tax year from the year selector; a custom date range (the projection) uses cash received.
  const acc = rentalAccrual(inRange ? null : effectiveViewYear());
  const income = round2(received + acc.closing - acc.opening);
  const rows = [];
  Object.keys(RENTAL_COST_MODEL).forEach(cat=>{
    // expenses are negative amounts; a refund (positive) in the same category nets off
    const paid = -transactions.filter(t=>t.category===cat && inR(t)).reduce((s,t)=>s+t.amount,0);
    if(round2(paid)===0) return;
    const treatment = treatmentFor(cat);
    const factor = treatment==='apportion' ? sh.share : treatment==='full' ? 1 : 0;
    rows.push({label:cat, category:cat, line:RENTAL_COST_MODEL[cat].line, treatment, paid:round2(paid), factor, deductible: round2(paid*factor)});
  });
  const bond = parseFloat(rentalSettings.bondInterest) || 0;
  if(opts.manual!==false && bond>0){
    rows.push({label:'Bond interest (lender certificate)', category:null, line:'interest', treatment:'apportion', paid:round2(bond), factor:sh.share, deductible: round2(bond*sh.share)});
  }
  const byLine = {};
  rows.forEach(r=>{ byLine[r.line] = round2((byLine[r.line]||0) + r.deductible); });
  const totalDeduction = round2(Object.values(byLine).reduce((a,b)=>a+b,0));
  const needsAreas = !sh.ready && rows.some(r=>r.treatment==='apportion' && r.paid!==0);
  const excluded = rows.filter(r=>r.treatment==='none');
  return {income, received, accrual: acc, rows, byLine, totalDeduction, net: round2(income - totalDeduction), share: sh, needsAreas, excluded};
}

function rentalAccrual(year){
  if(typeof year !== 'number') return {year:null, opening:0, closing:0};
  const a = rentalSettings.accrued || {};
  const v = y => Math.max(0, parseFloat(a[y]) || 0);
  return {year, opening: v(year-1), closing: v(year)};
}

function setAccrued(year, value){
  rentalSettings.accrued = rentalSettings.accrued || {};
  if(value === '' || value === null) delete rentalSettings.accrued[year]; else rentalSettings.accrued[year] = value;
  saveRentalSettings();
  renderRentalResult();
}

function renderRentalAccrual(){
  const el = document.getElementById('rs-accrual');
  const y = effectiveViewYear();
  if(typeof y !== 'number'){
    el.innerHTML = `<p class="hint">Choose a tax year at the top to enter rent owed at its start and end.</p>`;
    return;
  }
  const a = rentalSettings.accrued || {};
  const feb = yr => `${new Date(yr,2,0).getDate()} Feb ${yr}`;
  const input = (yr, label) => `
    <div class="field">
      <label for="rs-acc-${yr}">${label}</label>
      <input type="number" id="rs-acc-${yr}" min="0" step="0.01" value="${escapeHtml(a[yr] ?? '')}" oninput="setAccrued(${yr}, this.value)">
    </div>`;
  el.innerHTML = input(y, `Owed to you at ${feb(y)}, the end of this tax year (R)`)
    + input(y-1, `Owed to you at ${feb(y-1)}, the start of this tax year (R), already taxed in ${y-1}`);
}

function saveRentalInputs(){
  rentalSettings.cottageArea = document.getElementById('rs-cottage').value;
  rentalSettings.propertyArea = document.getElementById('rs-property').value;
  rentalSettings.monthsLet = document.getElementById('rs-months').value;
  rentalSettings.bondInterest = document.getElementById('rs-bond').value;
  rentalSettings.basisNote = document.getElementById('rs-note').value;
  saveRentalSettings();
  renderRentalResult();
}

function setTreatment(cat, val){
  rentalSettings.treatment[cat] = val;
  saveRentalSettings();
  renderRentalTreatments();
  renderRentalResult();
}

function resetTreatments(){
  rentalSettings.treatment = {};
  saveRentalSettings();
  renderRentalTreatments();
  renderRentalResult();
}

function renderRentalTreatments(){
  const sums = {};
  transactions.forEach(t=>{ sums[t.category] = (sums[t.category]||0) - t.amount; });
  const opts = [['apportion','Apportion (cottage share)'],['full','100% cottage'],['none','Not a rental deduction']];
  document.getElementById('rs-treatments').innerHTML = `
    <div class="table-wrap">
      <table>
        <thead><tr><th>Category</th><th>Treatment and ITR12 line</th><th class="num">Paid</th></tr></thead>
        <tbody>
          ${Object.keys(RENTAL_COST_MODEL).map(cat=>{
            const m = RENTAL_COST_MODEL[cat];
            const cur = treatmentFor(cat);
            const changed = cur !== m.treatment;
            const paid = sums[cat] || 0;
            return `<tr>
              <td>${escapeHtml(cat)}<div class="sub">${escapeHtml(m.note)}</div></td>
              <td style="width:236px;"><select class="${changed?'changed':''}" aria-label="Treatment for ${escapeHtml(cat)}" onchange="setTreatment('${cat.replace(/'/g,"\\'")}', this.value)">
                ${opts.map(([v,l])=>`<option value="${v}" ${v===cur?'selected':''}>${l}${v===m.treatment?' (default)':''}</option>`).join('')}
              </select><div class="sub">${ITR12_RENTAL_LINES[m.line]}</div></td>
              <td class="amount">${paid ? fmtR(paid) : ''}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>
    <div><button class="btn secondary small" onclick="resetTreatments()">Reset all to defaults</button></div>`;
}

function renderRentalSettings(){
  document.getElementById('rs-cottage').value = rentalSettings.cottageArea || '';
  document.getElementById('rs-property').value = rentalSettings.propertyArea || '';
  document.getElementById('rs-months').value = rentalSettings.monthsLet===undefined ? '12' : rentalSettings.monthsLet;
  document.getElementById('rs-bond').value = rentalSettings.bondInterest || '';
  document.getElementById('rs-note').value = rentalSettings.basisNote || '';
  renderRentalAccrual();
  renderRentalTreatments();
}

function renderRental(){
  renderRentalSettings();
  renderRentalResult();
}

function renderRentalResult(){
  const r = computeRental();
  const sh = r.share;
  const pct = (sh.share*100);
  document.getElementById('rs-ratio').innerHTML = sh.ready
    ? `Cottage share of whole-property costs: <b class="mono">${pct.toFixed(4)}%</b> <span class="muted">(${(parseFloat(rentalSettings.cottageArea)||0)} / ${(parseFloat(rentalSettings.propertyArea)||0)} m² × ${sh.months}/12 months)</span>`
    : `Enter the cottage area and the total property area to apportion shared costs.`;

  // warnings
  const warns = [];
  if(effectiveViewYear()==='all'){
    const rentalYears = new Set(transactions.filter(t=>t.category==='Rental Income' || RENTAL_COST_MODEL[t.category]).map(t=>taxYearOf(t.date)).filter(Boolean));
    if(rentalYears.size>1) warns.push(`These figures mix ${rentalYears.size} tax years. Choose a tax year at the top, because the cottage share and months let apply to one year.`);
  }
  if(r.accrual.opening > 0 && r.received < r.accrual.opening) warns.push(`Rent owed at the start of the year (${fmtR(r.accrual.opening)}) is more than the rent received this year (${fmtR(r.received)}). If part of it is still unpaid, include that part in the amount owed at year end too, or the income comes out too low.`);
  if(r.needsAreas) warns.push(`Costs marked <b>Apportion</b> are counted as R 0.00 until you enter both areas above.`);
  const ho = parseFloat(homeOffice.homeArea) || 0;
  const rp = parseFloat(rentalSettings.propertyArea) || 0;
  if(ho>0 && rp>0 && Math.abs(ho-rp) > 0.001) warns.push(`Work from home uses a total area of ${ho} m² but this page uses ${rp} m². Use the same basis for both, and keep the two areas separate so no cost is claimed twice.`);
  if(r.excluded.length) warns.push(`Not included in the deduction: ${r.excluded.map(x=>`${escapeHtml(x.label)} (${fmtR(x.paid)})`).join(', ')}. Re-tag or change the treatment above if part of this belongs to the cottage.`);
  document.getElementById('rs-warnings').innerHTML = warns.map(w=>`<div class="notice">${w}</div>`).join('');

  const el = document.getElementById('rental-receipt');
  const detailEl = document.getElementById('rental-detail');
  if(r.income===0 && r.received===0 && r.rows.length===0){
    detailEl.innerHTML = '';
    el.innerHTML = `<div class="empty boxed"><div class="icon">${ICON_HOME}</div>No rental transactions tagged yet. In the Transactions tab, set the category on rent deposits to <b>Rental Income</b>, and property costs to the matching <b>Rental – …</b> category.</div>`;
    return;
  }
  const lineOrder = ['rates_elec','insurance','interest','levies','repairs','agent','other'];
  detailEl.innerHTML = r.rows.length ? `
    <h3 class="section-title">Costs this year</h3>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Cost</th><th>Treatment</th><th class="num">Paid</th><th class="num">Share</th><th class="num">Deduction</th></tr></thead>
        <tbody>
          ${r.rows.map(x=>`<tr>
            <td>${escapeHtml(x.label)}<div class="sub">${ITR12_RENTAL_LINES[x.line]}</div></td>
            <td>${x.treatment==='apportion'?'Apportioned':x.treatment==='full'?'100% cottage':'Excluded'}</td>
            <td class="amount">${fmtR(x.paid)}</td>
            <td class="amount">${(x.factor*100).toFixed(x.treatment==='apportion'?4:0)}%</td>
            <td class="amount">${fmtR(x.deductible)}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>` : '';
  el.innerHTML = `
    <div class="receipt">
      <h4>Rental Income Summary</h4>
      <div class="sub">COTTAGE SHARE ${sh.ready?pct.toFixed(4)+'%':'NOT SET'}${rentalSettings.basisNote?' · '+escapeHtml(rentalSettings.basisNote).toUpperCase():''}</div>
      ${(r.accrual.opening || r.accrual.closing) ? `
      <div class="line"><span>Rent received (bank records)</span><span>${fmtR(r.received)}</span></div>
      ${r.accrual.closing ? `<div class="line"><span>Plus rent owed at year end, not yet received</span><span>${fmtR(r.accrual.closing)}</span></div>` : ''}
      ${r.accrual.opening ? `<div class="line"><span>Less rent owed at the start, taxed in ${r.accrual.year-1}</span><span>-${fmtR(r.accrual.opening)}</span></div>` : ''}
      <div class="line"><span>Rental income (received or accrued)</span><span>${fmtR(r.income)}</span></div>` : `
      <div class="line"><span>Rental income</span><span>${fmtR(r.income)}</span></div>`}
      ${lineOrder.filter(k=>r.byLine[k]).map(k=>`<div class="line"><span>${ITR12_RENTAL_LINES[k]}</span><span>-${fmtR(r.byLine[k])}</span></div>`).join('')}
      <div class="line"><span>Total expenditure</span><span>-${fmtR(r.totalDeduction)}</span></div>
      <div class="line total"><span>${r.net>=0?'Net rental income':'Net rental loss'}</span><span>${fmtR(r.net)}</span></div>
      <div class="note">The expenditure lines match the ITR12 rental expenditure fields. Income is the rent tagged Rental Income in your bank records, adjusted for rent owed at the start and end of the year (entered above), because tax is on the amount received or accrued, whichever comes first. If rent you were owed will never be paid, a bad-debt deduction may apply instead; a tax practitioner can confirm. Keep proof of each expense (levy statements, insurance schedules, agent invoices, bond interest certificate), because SARS can ask for them. If this is a loss, ring-fencing rules can restrict offsetting it against other income. A tax practitioner can confirm how that applies to you.</div>
    </div>
  `;
}

function homeOfficeCostTotals(){
  const totals = {};
  Object.entries(HOME_OFFICE_SOURCE_CATEGORIES).forEach(([cat,key])=>{
    const sum = viewTxns().filter(t=>t.category===cat).reduce((s,t)=>s+Math.abs(t.amount),0);
    if(sum>0) totals[key] = (totals[key]||0) + sum;
  });
  return totals;
}

function renderHomeOfficeChecklist(){
  const el = document.getElementById('ho-checklist');
  const items = [
    {key:'exclusive', label:'The space is set up specifically for work and used almost exclusively for it (not a corner of a shared living room).'},
    {key:'regular', label:'You use it regularly, not occasionally.'},
    {key:'majority', label:'You perform more than half of your total working duties there, or earn mainly commission and do most of that work from home.'}
  ];
  const allChecked = items.every(i=>homeOffice.checklist[i.key]);
  el.innerHTML = `
    <h3>Do you qualify first?</h3>
    <p class="lede">SARS sets a genuinely high bar for salaried employees claiming home office expenses. All three must be true:</p>
    ${items.map(i=>`
      <label class="check" style="margin-bottom:10px;">
        <input type="checkbox" id="ho-chk-${i.key}" ${homeOffice.checklist[i.key]?'checked':''} onchange="updateHOChecklist('${i.key}', this.checked)">
        <span>${i.label}</span>
      </label>`).join('')}
    ${!allChecked ? `<div class="notice"><b>Heads up:</b> based on what's ticked, you likely don't meet SARS's requirements yet. The calculation below will still run so you can see the numbers, but check with a tax practitioner before claiming it.</div>` : ''}
  `;
}
function updateHOChecklist(key, val){
  homeOffice.checklist[key] = val;
  saveHomeOffice();
  renderHomeOfficeChecklist();
}

function renderHomeOffice(){
  renderHomeOfficeChecklist();
  document.getElementById('ho-office-area').value = homeOffice.officeArea || '';
  document.getElementById('ho-home-area').value = homeOffice.homeArea || '';
  document.getElementById('ho-equipment').value = homeOffice.equipment || '';

  const prefill = homeOfficeCostTotals();
  const costsEl = document.getElementById('ho-costs');
  costsEl.innerHTML = HOME_OFFICE_FIELDS.map(f=>{
    const val = (homeOffice.costs[f.key]!==undefined && homeOffice.costs[f.key]!=='') ? homeOffice.costs[f.key] : (prefill[f.key]||'');
    return `<div class="field"><label for="ho-cost-${f.key}">${f.label}</label><input type="number" id="ho-cost-${f.key}" step="0.01" min="0" data-hofield="${f.key}" value="${val}" onchange="updateHOCost('${f.key}', this.value)"></div>`;
  }).join('');

  computeHomeOfficeResult();
}

function updateHOCost(key, val){
  homeOffice.costs[key] = val;
  saveHomeOffice();
  computeHomeOfficeResult();
}

function computeHomeOfficeResult(){
  const officeArea = parseFloat(document.getElementById('ho-office-area').value) || 0;
  const homeArea = parseFloat(document.getElementById('ho-home-area').value) || 0;
  const pct = homeArea>0 ? (officeArea/homeArea)*100 : 0;
  document.getElementById('ho-pct').textContent = pct.toFixed(1)+'%';

  let apportionable = 0;
  HOME_OFFICE_FIELDS.forEach(f=>{
    const input = document.querySelector(`[data-hofield="${f.key}"]`);
    apportionable += input ? (parseFloat(input.value)||0) : 0;
  });
  const equipment = parseFloat(document.getElementById('ho-equipment').value) || 0;
  const apportioned = apportionable * (pct/100);
  const total = apportioned + equipment;

  const el = document.getElementById('ho-result');
  el.innerHTML = `
    <div class="receipt">
      <h4>Home Office Deduction</h4>
      <div class="sub">ESTIMATE</div>
      <div class="line"><span>Apportionable costs</span><span>${fmtR(apportionable)}</span></div>
      <div class="line"><span>Work-use percentage</span><span>${pct.toFixed(1)}%</span></div>
      <div class="line"><span>Apportioned amount</span><span>${fmtR(apportioned)}</span></div>
      <div class="line"><span>Equipment wear &amp; tear</span><span>${fmtR(equipment)}</span></div>
      <div class="line total"><span>Estimated deduction</span><span>${fmtR(total)}</span></div>
      <div class="note">This is only worth claiming if you tick all three requirements above. Employer confirmation (a letter or clause in your contract about working from home) strengthens the claim. Keep your floor plan measurements and cost records on file.</div>
    </div>
  `;
}

function saveHomeOfficeInputs(){
  homeOffice.officeArea = document.getElementById('ho-office-area').value;
  homeOffice.homeArea = document.getElementById('ho-home-area').value;
  homeOffice.equipment = document.getElementById('ho-equipment').value;
  saveHomeOffice();
}

function renderAll(){
  renderYearBar();
  renderStats();
  renderTransactions();
  renderCategories();
  renderTax();
  renderRental();
  renderHomeOffice();
  renderProjection();
  renderRulesList();
  renderFileList();
  const vy = effectiveViewYear();
  const shown = viewTxns().length;
  if(document.body.classList) document.body.classList.toggle('is-empty', !transactions.length);
  document.getElementById('tax-year-label').textContent = !transactions.length ? 'No statements imported yet'
    : vy==='all' ? `${transactions.length} records across all tax years`
    : `${shown} of ${transactions.length} imported records fall in the ${vy} tax year`;
}

/* ---------------- EXPORT ---------------- */
function exportXLSX(){
  if(transactions.length===0){ notify('Nothing to export yet. Import some statements first.', 'Nothing to export'); return; }
  const rowsInYear = viewTxns();
  if(rowsInYear.length===0){ notify('No rows in the selected tax year. Choose another year at the top.', 'Nothing to export'); return; }
  const vy = effectiveViewYear();
  const wb = XLSX.utils.book_new();

  const txnSheet = rowsInYear
    .slice()
    .sort((a,b)=>(a.date||'').localeCompare(b.date||''))
    .map(t=>({Date:t.date, Description:t.desc, 'Description (English)':(t.descEN&&t.descEN!==t.desc)?t.descEN:'', Bank:t.bank, Category:t.category, 'Tax Relevant':t.taxLabel||'', 'Amount (R)':t.amount}));
  const ws1 = XLSX.utils.json_to_sheet(txnSheet);
  XLSX.utils.book_append_sheet(wb, ws1, 'Transactions');

  const catMap = {};
  rowsInYear.filter(t=>t.amount<0 && countsInTotals(t)).forEach(t=>{
    catMap[t.category] = (catMap[t.category]||0) + Math.abs(t.amount);
  });
  const ws2 = XLSX.utils.json_to_sheet(Object.entries(catMap).map(([Category,Total])=>({Category,'Total (R)':Total})));
  XLSX.utils.book_append_sheet(wb, ws2, 'Category Summary');

  const taxMap = {};
  rowsInYear.filter(t=>t.taxLabel).forEach(t=>{
    taxMap[t.taxLabel] = (taxMap[t.taxLabel]||0) + Math.abs(t.amount);
  });
  const ws3 = XLSX.utils.json_to_sheet(Object.entries(taxMap).map(([Item,Total])=>({Item,'Total (R)':Total})));
  XLSX.utils.book_append_sheet(wb, ws3, 'Tax Summary');

  const rr = computeRental();
  if(rr.income!==0 || rr.rows.length){
    const rentalRows = rr.rows.map(x=>({Cost:x.label, Treatment:x.treatment==='apportion'?'Apportioned':x.treatment==='full'?'100% cottage':'Excluded', 'ITR12 line':ITR12_RENTAL_LINES[x.line], 'Paid (R)':x.paid, 'Share (%)':Math.round(x.factor*1000000)/10000, 'Deduction (R)':x.deductible}));
    rentalRows.push({});
    if(rr.accrual.opening || rr.accrual.closing){
      rentalRows.push({Cost:'Rent received (bank records)', 'Deduction (R)':rr.received});
      rentalRows.push({Cost:'Plus rent owed at year end', 'Deduction (R)':rr.accrual.closing});
      rentalRows.push({Cost:'Less rent owed at start (taxed last year)', 'Deduction (R)':-rr.accrual.opening});
    }
    rentalRows.push({Cost:'Rental income', 'Deduction (R)':rr.income});
    rentalRows.push({Cost:'Total expenditure', 'Deduction (R)':rr.totalDeduction});
    rentalRows.push({Cost:rr.net>=0?'Net rental income':'Net rental loss', 'Deduction (R)':rr.net});
    rentalRows.push({Cost:'Cottage area (m2)', 'Deduction (R)':parseFloat(rentalSettings.cottageArea)||0});
    rentalRows.push({Cost:'Total property area (m2)', 'Deduction (R)':parseFloat(rentalSettings.propertyArea)||0});
    rentalRows.push({Cost:'Months held out for letting', 'Deduction (R)':rr.share.months});
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rentalRows), 'Rental');
  }

  XLSX.writeFile(wb, `staatmaker-${vy==='all' ? 'all-years' : vy+'-tax-year'}-${ymd(new Date())}.xlsx`);
}
