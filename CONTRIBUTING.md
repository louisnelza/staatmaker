# Contributing

Thanks for considering it. This is a single-file app on purpose — `index.html` contains the markup,
styles, and logic — so most contributions are a matter of editing that one file.

## Local development

There's no build step. Open `index.html` directly, or serve it locally:

```bash
npx http-server .
```

## Adding or fixing a bank's PDF/CSV parser

This is the highest-value kind of contribution, since every SA bank formats statements differently.

**Please don't commit a real bank statement, even redacted, even your own.** PDF "redaction" often
leaves the underlying text extractable, and a real statement isn't necessary anyway — the parser
only needs to know the *layout*, not your data.

Instead:

1. Open your statement locally and figure out the layout pdf.js would extract (select some
   transaction lines, copy them as plain text — this is exactly what the parser sees).
2. Build a **synthetic test fixture**: a `.txt` file with fabricated dates, amounts, and made-up
   merchant/reference text in the same layout as your bank's real statement. No real names, account
   numbers, or amounts.
3. Add a detection signature (see `isStandardBankAfrikaans()` for an example) so the right parser
   is picked automatically, and a dedicated parsing function if the layout doesn't fit the generic
   line-based parser.
4. Test it. A simple way, following the existing Standard Bank parser's approach:

   ```bash
   node -e "
   global.window = {}; global.pdfjsLib = {GlobalWorkerOptions:{}};
   const fs = require('fs');
   const html = fs.readFileSync('index.html','utf8');
   const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].pop()[1];
   const code = script.slice(0, script.indexOf('/* ---------------- EVENTS')).replace(/\bconst\b/g,'var').replace(/\blet\b/g,'var');
   eval(code);
   rules = DEFAULT_RULES.map(([kw,cat,tax])=>({kw,cat,tax}));
   const fixture = fs.readFileSync('your-fixture.txt','utf8');
   console.log(parseYourBankHere(fixture, 'Your Bank'));
   "
   ```

5. Open a PR with the parser and the synthetic fixture (fixtures can live under a `test/fixtures/`
   folder — not committed elsewhere in the repo, and never containing real data).

## Running the tests

```bash
node test/run.js
```

This loads the app script from `index.html` with a stubbed DOM and checks the tax brackets, rental
apportionment, card-statement parsing and reconciliation, and import de-duplication. Add a case there
(and a synthetic fixture under `test/fixtures/`) when you add or change a parser.

## Updating SARS figures

Tax brackets, rebates, medical scheme fees tax credits, and the retirement annuity cap change every
Budget Speech (usually late February). These live in `TAX_YEAR_TABLES` in `index.html`. When a new
tax year's figures are announced:

1. Add a new entry keyed by the tax year's end-year (e.g. the 2028 tax year runs 1 Mar 2027 – 28 Feb
   2028, so key it `2028`).
2. Source figures from SARS directly where possible, or from a reputable calculator (TaxTim, PwC Tax
   Summaries) — cross-check at least two sources, since these are exactly the kind of number that's
   easy to get subtly wrong.
3. Update the README's "Current SARS figures used" section.

## Reporting issues

If the categorisation rules miscategorise something common, or a bank's statement doesn't parse,
open an issue with (again) a synthetic example rather than your real statement.
