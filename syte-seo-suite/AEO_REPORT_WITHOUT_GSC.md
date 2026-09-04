# Running an AEO report for a client with no Search Console connection

Some clients won't give us Search Console access, but we do have their
Performance export on disk. This is how to run a full-quality AEO report for
one of them. **Nothing here changes the Search Console requirement** — the SEO
report is still gated on a live connection (`gscGuard.js`), and this does not
connect an account.

## What the AEO side actually needs Search Console for

The AEO report never required a connection to *run* — only the SEO report does.
What Search Console feeds the AEO side is **grounding**: the head-terms a brand
already gets impressions for seed

* the gold probe grid (`gridProfile.js` → `goldGrid.js`),
* the discovery sweep (`aeoDiscovery.js`),
* the "add GSC queries" probe expansion in AEO Snapshot.

Without them the probe set is derived from the website and industry alone and
comes out thin — that's the "AEO only works with GSC connected" feeling. All
three read the same per-client, per-month report-data cache
(`syte_suite_report_cache`), so feeding that cache the downloaded export gives
them exactly the same input a live pull would.

## Doing it

1. Get the export: **Search Console → Performance → Export → Download CSV**.
   That's a zip containing `Queries.csv`, `Pages.csv` and a few other sheets.
   Set the date range to the month you're reporting on before exporting.
2. In the suite, open either
   * **Reports → Monthly Report → AEO Report card**, with the report month
     selected (the import is stored under that month), or
   * **AEO → Snapshot**, which imports under last month.

   When no Search Console head-terms are on file you'll see
   *"No Search Console connection? Import the export instead"*.
3. Drop the whole zip in (or just `Queries.csv` / `Pages.csv`) and press
   **Import**. Only the Queries sheet is required; Pages is used for the
   top-pages table. Countries / Devices / Dates sheets are ignored.
4. Ground and run as usual: **Add GSC queries** / **Run Discovery** in AEO
   Snapshot now have real head-terms, and **Generate AEO Report** builds its
   gold grid off them.

## What the import does and doesn't do

* Stored as that client's Search Console data for that month, in the same
  cache a live pull writes — so every downstream consumer reads it without
  knowing where it came from. Flagged with `source: 'csv-import'` and shown as
  *"GSC (imported CSV)"* wherever the fetch status is displayed.
* GA4 traffic is **not** part of the import (an export has none), so the
  traffic figures stay empty.
* The SEO report stays blocked for the client: its gate checks the connection
  itself, not the data on file.
* Pressing **Refresh Data** does not lose the import — if the live pull comes
  back without Search Console rows (the usual case for an unconnected client),
  the imported keywords are merged back in (`preserveImportedGsc`). If a real
  connection ever starts returning rows, the live data wins.
* Re-importing for the same client and month overwrites the previous import.

## Code

| File | Role |
| --- | --- |
| `src/modules/reports/gscImport.js` | Pure parsing + blob building (`parseGscSheet`, `readGscExport`, `buildImportedReportData`, `preserveImportedGsc`). Node-testable. |
| `src/modules/reports/GscCsvImport.jsx` | The import card: file/zip reading and the cache write. |
| `test/gscImport.test.mjs` | Parser and merge-behaviour tests. |
