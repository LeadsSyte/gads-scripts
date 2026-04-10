import React from 'react';
import AEOSnapshot from './AEOSnapshot.jsx';
import MonthlyReport from './MonthlyReport.jsx';
import ReportsHistory from './ReportsHistory.jsx';

// Router for the Reports sidebar module. Three sub-tabs.
export default function ReportsModule({ sub }) {
  return (
    <div className="content-area">
      {sub === 'AEO Snapshot'   && <AEOSnapshot />}
      {sub === 'Monthly Report' && <MonthlyReport />}
      {sub === 'History'        && <ReportsHistory />}
    </div>
  );
}
