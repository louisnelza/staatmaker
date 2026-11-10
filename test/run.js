// Run with: node test/run.js
// Loads the app script from index.html into a VM with a stubbed DOM and localStorage, then checks the
// tax, rental, card-statement and import logic. Fixtures under test/fixtures are synthetic only.
const fs = require('fs'), vm = require('vm'), path = require('path'), assert = require('assert');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].pop()[1];
const code = script.slice(0, script.indexOf('/* ---------------- EVENTS')).replace(/\bconst\b/g, 'var').replace(/\blet\b/g, 'var');
const fixture = name => fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');

const store = {}, alerts = [], els = {};
const el = () => ({options:[], appendChild(c){ this.options.push(c); }, add(c){ this.options.push(c); },
  value:'', innerHTML:'', textContent:'', style:{}, classList:{add(){}, remove(){}, toggle(){}}});
const ctx = {console, Math, Date, JSON, Object, Number, String, Array, parseFloat, parseInt, isNaN, Promise,
  window:{}, pdfjsLib:{GlobalWorkerOptions:{}},
  localStorage:{getItem:k => store[k] ?? null, setItem:(k, v) => { store[k] = String(v); }},
  alert:m => alerts.push(m), confirm:() => true,
  document:{getElementById:id => els[id] || (els[id] = el()), querySelectorAll:() => [], createElement:el,
    body:{appendChild(){}, removeChild(){}}}};
vm.createContext(ctx);
vm.runInContext(code, ctx);
const R = s => vm.runInContext(s, ctx);
R('rules = DEFAULT_RULES.map(([kw,cat,tax])=>({kw,cat,tax})); renderAll = function(){}; persistProjectionSettings = async()=>{};');

const tests = [];
const t = (name, fn) => tests.push([name, fn]);
const close = (a, b, msg) => assert(Math.abs(a - b) < 0.005, `${msg || ''} got ${a}, want ${b}`);
const plain = v => JSON.parse(JSON.stringify(v)); // VM objects come from another realm
const setTx = a => { ctx.__a = a; R('transactions = __a.map((x,i)=>Object.assign({id:"t"+i, bank:"B", desc:"d"+i, date:"2026-04-01"}, x))'); };
const setRS = o => { ctx.__o = o; R('rentalSettings = Object.assign(RENTAL_SETTINGS_DEFAULT(), __o)'); };
const money = s => parseFloat(s.replace(/[^\d,.-]/g, '').replace(/\s/g, '').replace(/\.(?=\d{3})/g, '').replace(',', '.'));

/* ---------- Tax brackets (2026 SARS table) ---------- */
const tax = (n, y = 2026) => R('computeBracketTax')(n, R(`TAX_YEAR_TABLES[${y}].brackets`));
t('tax: R557,148 -> R137,440.28 (2026 assessment)', () => close(tax(557148), 137440.28));
t('tax: top of first band R237,100 -> R42,678', () => close(tax(237100), 42678));
t('tax: R237,101 -> R42,678.26', () => close(tax(237101), 42678.26));
t('tax: R100,000 -> R18,000', () => close(tax(100000), 18000));
t('tax: R2,000,000 -> R726,839', () => close(tax(2000000), 726839));
for (const y of [2026, 2027]) t(`tax ${y}: no jump at any band boundary`, () => {
  R(`TAX_YEAR_TABLES[${y}].brackets`).slice(1).forEach(b => {
    const d = tax(b.min, y) - tax(b.min - 1, y);
    assert(d > 0 && d < 1, `jump of ${d} at ${b.min}`);
  });
});

/* ---------- Cottage share ---------- */
const share = o => { setRS(o); return R('rentalShare()'); };
t('share: 60/240 x 12/12 = 25%', () => close(share({cottageArea:'60', propertyArea:'240', monthsLet:'12'}).share, 0.25));
t('share: 6 months halves it', () => close(share({cottageArea:'60', propertyArea:'240', monthsLet:'6'}).share, 0.125));
t('share: blank months counts as 12', () => close(share({cottageArea:'60', propertyArea:'240', monthsLet:''}).share, 0.25));
t('share: months capped at 12', () => close(share({cottageArea:'60', propertyArea:'240', monthsLet:'15'}).share, 0.25));
t('share: cottage area capped at property area', () => close(share({cottageArea:'300', propertyArea:'240', monthsLet:'12'}).share, 1));
t('share: missing area -> not ready, 0', () => { const s = share({cottageArea:'', propertyArea:'240'}); assert(!s.ready && s.share === 0); });

/* ---------- Rental deduction ---------- */
const scenario = () => {
  setRS({cottageArea:'60', propertyArea:'240', monthsLet:'12', bondInterest:'40000'});
  setTx([{category:'Rental Income', amount:8000}, {category:'Rental Income', amount:8000},
    {category:'Rental - Rates & Taxes', amount:-1200}, {category:'Rental - Insurance', amount:-800},
    {category:'Rental - Repairs & Maintenance', amount:-2500}, {category:'Rental - Agent Commission', amount:-1000},
    {category:'Rental - Electricity', amount:-2000}, {category:'Rental - Electricity', amount:400},
    {category:'Utilities', amount:-500}, {category:'Rent / Bond', amount:-12000}, {category:'Groceries', amount:-999}]);
};
t('rental: worked example', () => {
  scenario(); const r = R('computeRental()');
  // apportioned: rates 1200 + insurance 800 + electricity 1600 net + bond 40000 = 43600 x 25% = 10900; full: 3500
  close(r.income, 16000, 'income'); close(r.totalDeduction, 14400, 'deduction'); close(r.net, 1600, 'net');
  close(r.byLine.rates_elec, 700, 'rates_elec'); close(r.byLine.interest, 10000, 'interest');
  assert.deepStrictEqual(plain(r.excluded.map(x => x.label).sort()), ['Rent / Bond', 'Utilities']);
  assert(!r.rows.some(x => x.label === 'Groceries'), 'non-rental category included');
});
t('rental: manual:false leaves out the certificate bond interest', () => { scenario(); close(R('computeRental(null,{manual:false})').totalDeduction, 4400); });
t('rental: Utilities switched to apportion', () => { scenario(); R('rentalSettings.treatment["Utilities"]="apportion"'); close(R('computeRental()').totalDeduction, 14525); });
t('rental: Repairs switched to none', () => { scenario(); R('rentalSettings.treatment["Rental - Repairs & Maintenance"]="none"'); close(R('computeRental()').totalDeduction, 11900); });
t('rental: date filter', () => {
  scenario(); R('transactions.push({id:"x", bank:"B", desc:"old", date:"2025-01-01", category:"Rental - Agent Commission", amount:-5000})');
  close(R('computeRental(t=>t.date>="2025-03-01")').totalDeduction, 14400); close(R('computeRental()').totalDeduction, 19400);
});
t('rental: no areas -> warning, apportioned costs count as 0', () => {
  scenario(); setRS({}); const r = R('computeRental()'); assert(r.needsAreas); close(r.totalDeduction, 3500, 'only 100% cottage costs');
});

/* ---------- Rendering ---------- */
t('render: Rental tab draws and escapes the basis note', () => {
  scenario(); setRS({cottageArea:'60', propertyArea:'240', monthsLet:'12', basisNote:'<b>x</b>'}); R('renderRental()');
  assert(!els['rental-receipt'].innerHTML.includes('<B>X</B>')); assert(els['rs-treatments'].innerHTML.includes('Reset all'));
});
const projectedExpenses = () => {
  R('renderProjection()');
  const m = els['proj-rental'].innerHTML.match(/Rental expenses \(YTD → projected\)<\/span><span>([^<]*)<\/span>/);
  assert(m, 'rental expenses line missing');
  return m[1].split('→').map(money);
};
t('projection: certificate bond interest pro-rated into YTD, full cottage share projected', () => {
  setRS({cottageArea:'60', propertyArea:'240', monthsLet:'12', bondInterest:'40000'});
  R('transactions=[{id:"p1", bank:"B", desc:"rent", date:new Date().toISOString().slice(0,10), category:"Rental Income", amount:8000}]');
  const [ytd, projected] = projectedExpenses();
  close(projected, 10000, 'projected'); assert(ytd > 0 && ytd <= 10000, `YTD ${ytd}`);
});
t('projection: no certificate -> no bond interest', () => {
  setRS({cottageArea:'60', propertyArea:'240', monthsLet:'12'});
  const [ytd, projected] = projectedExpenses(); close(ytd, 0); close(projected, 0);
});

/* ---------- Settings and backup ---------- */
t('settings: saved and reloaded', async () => {
  setRS({cottageArea:'60', propertyArea:'240', treatment:{Utilities:'full'}});
  await R('saveRentalSettings()'); R('rentalSettings = RENTAL_SETTINGS_DEFAULT()'); await R('loadRentalSettings()');
  assert.strictEqual(R('rentalSettings.treatment["Utilities"]'), 'full'); assert.strictEqual(R('rentalSettings.cottageArea'), '60');
});
t('restore: old backup without rental settings resets them', async () => {
  ctx.__f = {text:async () => JSON.stringify({version:1, transactions:[]})};
  await R('restoreBackup(__f)');
  assert.strictEqual(R('rentalSettings.cottageArea'), ''); assert.deepStrictEqual(Object.keys(R('rentalSettings.treatment')), []);
});

/* ---------- Standard Bank card PDF parser ---------- */
const card = fixture('standard-bank-card.txt');
const parseCard = text => R('parseStandardBankCard')(text, 'SB Card');
t('card: detected, Afrikaans layout not misdetected', () => {
  assert(R('isStandardBankCard')(card)); assert(!R('isStandardBankCard')('Transaksiebesonderhede Saldo'));
});
t('card: rows, signs, rand amount on foreign lines, two-column lines, balance lines skipped', () => {
  assert.deepStrictEqual(plain(parseCard(card).map(r => [r.date, r.desc, r.amount])), [
    ['2026-03-03', 'WOOLWORTHS CAPE TOWN', -450.25], ['2026-03-05', 'NETFLIX.COM USD', -289.40],
    ['2026-03-07', 'PAYMENT THANK YOU', 5000], ['2026-03-09', 'DISCHEM PHARMACY', -1234.50],
    ['2026-03-10', 'ENGEN GARAGE', -800], ['2026-04-02', 'TAKEALOT ONLINE', -349], ['2026-04-04', 'TAKEALOT REFUND', 120]]);
});
t('card: reconciles using the first brought-forward and the last closing balance', () => {
  const r = plain(parseCard(card).reconcile);
  assert(r.checked && r.ok, JSON.stringify(r)); close(r.opening, 5000); close(r.closing, 3003.15);
});
t('card: an unrecognised stray line shows up as a difference', () => {
  const bad = card.replace('Page 1 of 2', '25 Mar 26 REWARDS ADJUSTMENT 500.00');
  const r = plain(parseCard(bad).reconcile);
  assert(r.checked && !r.ok); close(r.difference, -500);
});
t('card: a running-balance column read as the amount shows up as a difference', () => {
  const bad = card.replace('WOOLWORTHS CAPE TOWN 450.25', 'WOOLWORTHS CAPE TOWN 450.25 5,450.25');
  const r = plain(parseCard(bad).reconcile); assert(r.checked && !r.ok); close(r.difference, -5000);
});
t('card: summary wording inside the table is skipped', () => {
  const withSummary = card.replace('Page 1 of 2', '25 Apr 26 Minimum payment due 500.00\n25 Apr 26 Total amount due 3,003.15\n10 Mar 26 Interest rate 21.00 22.50');
  const rows = parseCard(withSummary);
  assert.strictEqual(rows.length, 7, rows.map(r => r.desc).join(', ')); assert(rows.reconcile.ok);
});
t('card: balance carried forward is not a transaction', () => {
  const rows = parseCard(card.replace('Page 1 of 2', '31 Mar 26 Balance carried forward 2,774.15'));
  assert.strictEqual(rows.length, 7); assert(rows.reconcile.ok);
});
t('card: nothing after the closing balance is imported', () => {
  const rows = parseCard(card.replace('Page 2 of 2', 'Page 2 of 2\n06 Apr 26 SOMETHING IN THE FOOTER 99.00'));
  assert.strictEqual(rows.length, 7); assert(rows.reconcile.ok);
});
t('card: real merchants with similar words are kept', () => {
  const rows = parseCard(card.replace('Page 1 of 2', '12 Mar 26 CREDIT CORNER CAFE 55.00\n13 Mar 26 DUE SOUTH COFFEE 40.00'));
  assert.strictEqual(rows.length, 9); assert(!rows.reconcile.ok); close(rows.reconcile.difference, -95);
});
t('card: missing closing balance -> not checked', () => {
  assert.strictEqual(parseCard(card.replace(/.*Closing balance.*\n/, '')).reconcile.checked, false);
});

/* ---------- Import: duplicates, warnings, reconciliation ---------- */
const mk = (d, desc, a) => ({id:Math.random() + '', date:d, desc, bank:'B', amount:a, category:'Uncategorised'});
const csv = {
  'a.csv':[mk('2026-03-01', 'COFFEE', -30), mk('2026-03-01', 'COFFEE', -30), mk('2026-03-05', 'SHOP', -100)],
  'b.csv':[mk('2026-03-01', 'COFFEE', -30), mk('2026-03-01', 'COFFEE', -30), mk('2026-03-05', 'shop ', -100), mk('2026-04-02', 'NEW', -50)],
  'f.csv':[mk('2099-01-01', 'X', -1)]};
ctx.__csv = csv; ctx.__pdf = {};
R('handleCSVFile = async f => __csv[f.name].map(x=>Object.assign({}, x)); handlePDFFile = async f => parseStandardBankCard(__pdf[f.name], "SB Card");');
const importFiles = async (...names) => {
  alerts.length = 0; ctx.__names = names;
  await R('processFiles(__names.map(name=>({name})), "B")');
  return alerts.join('\n');
};
t('import: overlap skipped, in-file repeats kept, unsupported files reported', async () => {
  R('transactions=[]; files=[]');
  await importFiles('a.csv'); assert.strictEqual(R('transactions.length'), 3);
  const msg = await importFiles('b.csv', 'c.xlsx');
  assert.strictEqual(R('transactions.length'), 4, 'only the new row is added');
  assert(msg.includes('3 row(s) were already imported'), msg); assert(msg.includes('c.xlsx'), msg);
  await importFiles('a.csv'); assert.strictEqual(R('transactions.length'), 4, 're-import adds nothing');
});
t('import: the same file twice in one drop is added once', async () => {
  R('transactions=[]; files=[]'); await importFiles('a.csv', 'a.csv'); assert.strictEqual(R('transactions.length'), 3);
});
t('import: future-dated rows warned', async () => {
  R('transactions=[]; files=[]'); assert((await importFiles('f.csv')).includes('dated in the future'));
});
t('import: reconciling card statement gives no warning', async () => {
  R('transactions=[]; files=[]'); ctx.__pdf['card.pdf'] = card;
  const msg = await importFiles('card.pdf'); assert.strictEqual(R('transactions.length'), 7); assert(!msg.includes('reconcile'), msg);
});
t('import: card statement that does not reconcile is warned, with the difference', async () => {
  R('transactions=[]; files=[]'); ctx.__pdf['bad.pdf'] = card.replace('Page 1 of 2', '25 Mar 26 REWARDS ADJUSTMENT 500.00');
  const msg = await importFiles('bad.pdf');
  assert(msg.includes("doesn't reconcile") && msg.includes('bad.pdf') && /500[.,]00/.test(msg), msg);
});
t('import: card statement without balances says it could not be checked', async () => {
  R('transactions=[]; files=[]'); ctx.__pdf['nobal.pdf'] = card.replace(/.*Closing balance.*\n/, '');
  assert((await importFiles('nobal.pdf')).includes('could not be checked'));
});

(async () => {
  let failed = 0;
  for (const [name, fn] of tests) {
    try { await fn(); console.log('PASS', name); }
    catch (e) { failed++; console.log('FAIL', name, '\n    ', e.message.split('\n').join('\n     ')); }
  }
  console.log(`\n${tests.length - failed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
