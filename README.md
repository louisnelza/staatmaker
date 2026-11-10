# Staatmaker — SA Tax Spending Organiser

A browser-only tool for South African individual taxpayers to turn bank statements
(CSV or PDF, from multiple banks) into categorised spending, tax-relevant deduction totals, and a
year-to-date tax projection — without any of it leaving your computer.

> **Not tax advice.** Staatmaker helps you organise your own records and estimate what your return might
> look like. It doesn't file anything with SARS and isn't a substitute for a registered tax
> practitioner. Always reconcile totals against your actual certificates (IRP5, medical aid tax
> certificate, RA contribution certificate, Section 18A donation receipts) before submitting.

## Why this exists

Pulling a year of bank statements apart by hand to figure out your retirement annuity contributions,
medical aid payments, donations, and rental numbers is tedious and error-prone. Staatmaker automates the
sorting so you can spend your time checking the result, not building it.

## Features

- **Multi-bank import** — drag in CSV or password-protected PDF statements from any South African
  bank. Column layout is auto-detected; a dedicated parser handles Standard Bank's Afrikaans current
  account PDF layout specifically (including its `MM DD` dates and trailing-minus negative amounts).
- **Automatic categorisation** — a keyword-rule engine (editable, with Afrikaans-aware rules built
  in) sorts transactions into spending categories and flags the ones relevant to your return:
  Retirement Annuity, Medical Aid, Additional Medical Expenses, Income Protection, Donations (s18A).
- **Rental income with cottage apportionment** — tag rental deposits and property costs to get a net rental
  result. Enter the let area and the whole-property area (and the months it was held out for letting) and
  Staatmaker cuts costs that serve the whole property (rates, insurance, electricity, water, internet, garden
  and security, bond interest) down to the cottage share, while costs that belong to the cottage alone
  (repairs, furnishings and linen, agent commission) are claimed in full. Every known category has a default
  treatment (apportion, 100% cottage, or not a rental deduction) that you can override, and the summary is
  laid out on the ITR12 rental expenditure lines. Ambiguous categories such as Utilities (which also holds
  phone bills) and Rent / Bond (which includes capital) are excluded by default and flagged, rather than
  silently claimed.
- **Work-from-home deduction** — a SARS-requirement checklist plus a floor-area apportionment
  calculator for salaried employees who may qualify for a home office deduction.
- **Tax-year view** — pick the SA tax year (1 March – end February) at the top and every total, the
  rental summary and the spreadsheet export cover that year only, so rows from other years in an
  overlapping statement don't end up on the wrong return. Defaults to the latest completed year with data.
- **Own-account transfers** — tag moves between your own accounts (such as paying your credit card
  from your cheque account) as *Transfers - Own Accounts* and they are left out of the income and
  spending totals instead of being counted on both statements. Card repayments are tagged automatically.
- **Tax year projection** — scales your year-to-date spending to a full-year estimate, checks it
  against the current retirement annuity and donation caps, and gives a rough estimated tax outcome
  using the current SARS bracket tables, rebates, and medical scheme fees tax credit.
- **Everything stays local** — no server, no upload. Data is saved to your browser's own storage,
  with manual JSON backup/restore since that storage is tied to one browser/device.
- **Spreadsheet export** — a multi-sheet `.xlsx` with your transactions (including an English gloss
  for Afrikaans descriptions), category totals, and tax summary.

## Getting started

No build step, no install. Either:

1. **Just open it.** Download or clone this repo and open `index.html` directly in a browser. Keep
   `styles.css` and the `js/` folder next to it, because the page loads them from there.
2. **Or serve it locally** (some browsers are stricter about local file access than others):
   ```bash
   npx http-server .
   # or
   python3 -m http.server 8000
   ```
3. **Or use GitHub Pages** — enable Pages on this repo (Settings → Pages → deploy from `main`) and
   it'll be reachable at `https://<you>.github.io/<repo>/`.

## Data & privacy

Everything — PDF parsing, categorisation, calculations — runs in your browser. Nothing is uploaded
anywhere. Data autosaves to this browser's `localStorage`, which means:

- It survives refreshes and closing the tab.
- It does **not** survive clearing browser data, switching browsers, or switching devices.
- Use the **Download backup (.json)** button regularly, and **Restore from backup** to bring it back.

## Current SARS figures used

The tax projection tab uses sourced figures for the 2026 (1 Mar 2025 – 28 Feb 2026) and 2027
(1 Mar 2026 – 28 Feb 2027) tax years — brackets, rebates, medical scheme fees tax credit, and the
retirement annuity deduction cap. These change every Budget Speech; the tool labels which year's
table it's using and falls back to the nearest known year if it's ever out of date. **Always verify
current figures at [sars.gov.za](https://www.sars.gov.za)** before relying on them.

## Known limitations

- PDF parsing is inherently best-effort — bank statement layouts vary and change over time. Every
  row is editable by hand as a fallback, and CSV export from your bank's own site/app will always
  parse more reliably than a PDF.
- The tax projection is a straight-line annualisation (year-to-date ÷ days elapsed × days in year).
  It has no idea about bonuses, once-off donations, or seasonal spending, so it's a steer, not a
  forecast.
- Rental income starts from what you tag as Rental Income in your bank records (cash received). Tax is on
  income received or accrued, whichever comes first, so the Rental tab takes the rent owed to you at the
  start and end of each tax year and adjusts for it. Bad debts (rent that will never be paid) aren't modelled.
- The additional medical expenses tax credit, disability-related rules, provisional tax, and capital
  gains are out of scope for now — see [Roadmap](#roadmap).

## Roadmap

- [ ] Additional Medical Expenses Tax Credit (section 6B) calculation
- [ ] Support for more bank-specific PDF layouts (FNB, Absa, Nedbank, Capitec, Bank Zero — contributions welcome, see below)
- [ ] Provisional tax (IRP6) view for freelance/side income
- [ ] Multi-year comparison view

## Contributing

Contributions are welcome, especially bank-specific PDF parsers — see [CONTRIBUTING.md](CONTRIBUTING.md).
If you're adding a parser, please contribute the *parsing logic and test fixture*, not a real
statement; see the contributing guide for how to build a redacted/synthetic test fixture safely.

## License

[MIT](LICENSE) — see the LICENSE file. Do whatever you like with it; no warranty, especially where
tax outcomes are concerned.