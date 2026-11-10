// Shared state and reference data: categories, tax labels, rental cost model, default rules.
// Loaded first; js/app.js and js/main.js build on these globals.
/* ---------------- STATE ---------------- */
let transactions = [];   // {id, date, desc, bank, amount, category, taxLabel}
let rules = [];
let files = [];

const DEFAULT_CATEGORIES = [
  'Income','Groceries','Fuel & Transport','Eating Out','Rent / Bond','Utilities',
  'Insurance (Short-term)','Subscriptions & Entertainment','Shopping','Cash Withdrawal',
  'Bank Fees','Interest & Bank Charges','Transfers','Transfers - Own Accounts','Investments','Medical Aid Contributions','Medical - Other','Retirement Annuity',
  'Income Protection','Donations',
  'Rental Income','Rental - Levies','Rental - Rates & Taxes','Rental - Insurance',
  'Rental - Repairs & Maintenance','Rental - Agent Commission','Rental - Bond Interest',
  'Rental - Electricity','Rental - Water & Sanitation','Rental - Internet','Rental - Garden & Security',
  'Rental - Furnishings & Linen','Rental - Other (cottage only)',
  'Home - Rates & Taxes','Home - Insurance','Home - Repairs & Maintenance',
  'Uncategorised'
];

const TAX_LABELS = {
  'Medical Aid Contributions':'Medical Aid Contributions',
  'Medical - Other':'Additional Medical Expenses',
  'Retirement Annuity':'Retirement Annuity Contributions',
  'Income Protection':'Income Protection Premiums',
  'Donations':'Donations (Section 18A)'
};

// Which ITR12 rental expenditure line each cost lands on.
const ITR12_RENTAL_LINES = {
  rates_elec:'Electricity / rates & taxes', insurance:'Insurance', interest:'Interest / finance charges',
  levies:'Levies paid', repairs:'Repairs / maintenance', agent:'Agency fees', other:'Other'
};

// How each cost category is treated when working out the rental deduction (editable per user):
//   apportion = the cost serves the whole property      -> deduct the cottage share only
//   full      = the cost belongs to the cottage alone    -> deduct 100%
//   none      = not a rental deduction (private, or handled elsewhere)
// These are the defaults for every known category; the user can override any of them.
const RENTAL_COST_MODEL = {
  'Rental - Levies':               {treatment:'apportion', line:'levies',    note:'Neighbourhood or body-corporate levies on the whole property.'},
  'Rental - Rates & Taxes':        {treatment:'apportion', line:'rates_elec',note:'Only rates actually levied and not in dispute.'},
  'Rental - Insurance':            {treatment:'apportion', line:'insurance', note:'Buildings cover only. Leave out contents, vehicle and credit-life cover.'},
  'Rental - Repairs & Maintenance':{treatment:'full',      line:'repairs',   note:'Repairs made to the cottage itself.'},
  'Rental - Agent Commission':     {treatment:'full',      line:'agent',     note:'A cost of letting the cottage.'},
  'Rental - Bond Interest':        {treatment:'apportion', line:'interest',  note:'Interest portion only, not the whole instalment.'},
  'Rental - Electricity':          {treatment:'apportion', line:'rates_elec',note:'Billed amounts for the whole property (one meter).'},
  'Rental - Water & Sanitation':   {treatment:'apportion', line:'other',     note:'Whole-property water account.'},
  'Rental - Internet':             {treatment:'apportion', line:'other',     note:'Fibre or ADSL shared with the house.'},
  'Rental - Garden & Security':    {treatment:'apportion', line:'other',     note:'Garden service and security that cover the whole property.'},
  'Rental - Furnishings & Linen':  {treatment:'full',      line:'other',     note:'Items used only in the cottage. Anything over R7,000 needs wear and tear, not a straight deduction.'},
  'Rental - Other (cottage only)': {treatment:'full',      line:'other',     note:'Any other cost that belongs to the cottage alone.'},
  'Home - Rates & Taxes':          {treatment:'apportion', line:'rates_elec',note:'Whole-property rates. The home office uses its own share of the same bill.'},
  'Home - Insurance':              {treatment:'apportion', line:'insurance', note:'Whole-property insurance. Buildings cover only.'},
  'Home - Repairs & Maintenance':  {treatment:'none',      line:'repairs',   note:'Repairs to the main house are not a rental cost. Re-tag as Rental - Repairs if the work was on the cottage.'},
  'Utilities':                     {treatment:'none',      line:'rates_elec',note:'Also holds phone and airtime. Re-tag property bills as Rental - Electricity, Water or Internet, or switch to Apportion if only property bills sit here.'},
  'Rent / Bond':                   {treatment:'none',      line:'interest',  note:'A bond instalment includes capital. Enter the interest from your lender certificate above instead.'}
};
const RENTAL_EXPENSE_CATEGORIES = Object.keys(RENTAL_COST_MODEL);

// category -> home office cost field key, used to prefill the apportionment inputs
const HOME_OFFICE_SOURCE_CATEGORIES = {
  'Rent / Bond': 'occupancy',
  'Home - Rates & Taxes': 'rates',
  'Utilities': 'utilities',
  'Home - Insurance': 'insurance',
  'Home - Repairs & Maintenance': 'repairs'
};
const HOME_OFFICE_FIELDS = [
  {key:'occupancy', label:'Rent paid, or bond interest portion only (R)'},
  {key:'rates', label:'Rates & taxes (R)'},
  {key:'utilities', label:'Electricity / utilities (R)'},
  {key:'insurance', label:'Home insurance (R)'},
  {key:'repairs', label:'Repairs & maintenance (R)'}
];

const DEFAULT_RULES = [
  ['SALARY','Income',false],['PAYROLL','Income',false],['SARS REFUND','Income',false],
  ['WOOLWORTHS','Groceries',false],['CHECKERS','Groceries',false],['PICK N PAY','Groceries',false],
  ['PNP ','Groceries',false],['SPAR','Groceries',false],['SHOPRITE','Groceries',false],['FOOD LOVER','Groceries',false],
  ['ENGEN','Fuel & Transport',false],['SASOL','Fuel & Transport',false],['SHELL','Fuel & Transport',false],
  ['CALTEX','Fuel & Transport',false],['UBER','Fuel & Transport',false],['BOLT','Fuel & Transport',false],
  ['GAUTRAIN','Fuel & Transport',false],['TOLL','Fuel & Transport',false],
  ['DISCOVERY HEALTH','Medical Aid Contributions',true],['DISCOVERY MEDICAL','Medical Aid Contributions',true],
  ['BONITAS','Medical Aid Contributions',true],['MOMENTUM HEALTH','Medical Aid Contributions',true],
  ['MEDSHIELD','Medical Aid Contributions',true],['BESTMED','Medical Aid Contributions',true],
  ['FEDHEALTH','Medical Aid Contributions',true],['GEMS MEDICAL','Medical Aid Contributions',true],
  ['PHARMACY','Medical - Other',true],['CLICKS','Medical - Other',true],['DISCHEM','Medical - Other',true],
  ['DIS-CHEM','Medical - Other',true],['DOCTOR','Medical - Other',true],['DENTIST','Medical - Other',true],
  ['OPTOM','Medical - Other',true],['SPECSAVERS','Medical - Other',true],
  ['ALLAN GRAY','Retirement Annuity',true],['10X','Retirement Annuity',true],['OLD MUTUAL','Retirement Annuity',true],
  ['SANLAM','Retirement Annuity',true],['LIBERTY','Retirement Annuity',true],['GLACIER','Retirement Annuity',true],
  ['MOMENTUM RA','Retirement Annuity',true],['MOMENTUM WEALTH','Retirement Annuity',true],
  ['INCOME PROTECTOR','Income Protection',true],['DISABILITY COVER','Income Protection',true],
  ['DONATION','Donations',true],['GIFT OF THE GIVERS','Donations',true],['CHOC CHILDHOOD','Donations',true],
  ['SOS CHILDREN','Donations',true],['GIVENGAIN','Donations',true],['BACKABUDDY','Donations',true],['SMILE FOUNDATION','Donations',true],
  ['NETFLIX','Subscriptions & Entertainment',false],['SHOWMAX','Subscriptions & Entertainment',false],
  ['SPOTIFY','Subscriptions & Entertainment',false],['DSTV','Subscriptions & Entertainment',false],
  ['MULTICHOICE','Subscriptions & Entertainment',false],['APPLE.COM','Subscriptions & Entertainment',false],
  ['RENT ','Rent / Bond',false],['BOND','Rent / Bond',false],['HOME LOAN','Rent / Bond',false],
  ['ESKOM','Utilities',false],['MUNICIP','Utilities',false],['CITY OF','Utilities',false],
  ['TELKOM','Utilities',false],['VODACOM','Utilities',false],['MTN','Utilities',false],['CELL C','Utilities',false],
  ['RAIN ','Utilities',false],['FIBRE','Utilities',false],['WEBAFRICA','Utilities',false],
  ['ATM WITHDRAWAL','Cash Withdrawal',false],['CASH WITHDRAWAL','Cash Withdrawal',false],['ATM CASH','Cash Withdrawal',false],
  ['SERVICE FEE','Bank Fees',false],['ADMIN FEE','Bank Fees',false],['BANK CHARGE','Bank Fees',false],['MONTHLY FEE','Bank Fees',false],
  ['OUTSURANCE','Insurance (Short-term)',false],['DISCOVERY INSURE','Insurance (Short-term)',false],['SANTAM','Insurance (Short-term)',false],['KING PRICE','Insurance (Short-term)',false],['INSURANCE','Insurance (Short-term)',false],
  ['KFC','Eating Out',false],['MCDONALD','Eating Out',false],['NANDO','Eating Out',false],['STEERS','Eating Out',false],
  ['UBER EATS','Eating Out',false],['MR D FOOD','Eating Out',false],['RESTAURANT','Eating Out',false],['CAFE','Eating Out',false],
  // Credit card statement wording (Standard Bank card) — before the generic TRANSFER/INSURANCE catch-alls
  ['INTERNATIONAL TXN FEE','Bank Fees',false],['E-COMM DECLINE','Bank Fees',false],['PMT/TRNSF FEE','Bank Fees',false],['INITIATION FEE','Bank Fees',false],
  ['FINANCE CHARGE','Interest & Bank Charges',false],
  ['CR PROTECTION','Insurance (Short-term)',false],['CREDIT PROTECTION','Insurance (Short-term)',false],
  ['PAYMENT, THANK YOU','Transfers - Own Accounts',false],['PAYMENT THANK YOU','Transfers - Own Accounts',false],
  ['X CORP. PAID','Subscriptions & Entertainment',false],
  ['RTMC','Fuel & Transport',false],
  ['TRANSFER','Transfers',false],['EFT ','Transfers',false],
  // Afrikaans-language statements (e.g. Standard Bank current account) — specific merchants/terms first, generic catch-alls last
  ['VERSEKERING','Insurance (Short-term)',false],['HOLLARD','Insurance (Short-term)',false],
  ['DIENSOOREENKOMS','Subscriptions & Entertainment',false],
  ['SAHL','Rent / Bond',false],
  ['VALR','Investments',false],['CAPE CRYPTO','Investments',false],['LUNO','Investments',false],['EASYEQUITIES','Investments',false],
  ['FOSCHINI','Shopping',false],['MARKHAMS','Shopping',false],['WOOLIES','Shopping',false],['TRUWORTHS','Shopping',false],
  ['ZAPPER','Shopping',false],
  ['OORTREKKINGS RENTE','Interest & Bank Charges',false],['OORSKRYDINGSRENTE','Interest & Bank Charges',false],
  ['FOOI','Bank Fees',false],['DIENSGELD','Bank Fees',false],['GELDE ','Bank Fees',false],['KOSTE-ONBETAALDE','Bank Fees',false],
  ['OORTREKKING','Interest & Bank Charges',false],
  ['OORPLASING','Transfers',false],['DEBIETORDER','Transfers',false],['TJEKKAART','Shopping',false],
  ['BETALING','Transfers',false],
];
