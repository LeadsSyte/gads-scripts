// Shape version for the cached report-data blob (syte_suite_report_cache).
//
// Bump this whenever the report data shape changes in a way that makes old
// cache entries stale (e.g. keyword pull went 50 → 500, pagination added at
// v3). Cache entries without a matching version are treated as a miss and
// refetched.
//
// It lives in its own module because both the live fetch path (MonthlyReport)
// and the Search Console CSV import (gscImport.js — pure, node-testable) have
// to stamp the same number, and gscImport must not pull in browser-only code.
export const REPORT_DATA_VERSION = 3;
