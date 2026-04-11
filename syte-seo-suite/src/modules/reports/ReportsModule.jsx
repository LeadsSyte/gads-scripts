import React from 'react';
import { useClients } from '../../store/useClients.js';
import AEOSnapshot from './AEOSnapshot.jsx';
import MonthlyReport from './MonthlyReport.jsx';
import ReportsHistory from './ReportsHistory.jsx';
import ClientCardsGrid from '../../components/ClientCardsGrid.jsx';

// Router for the Reports sidebar module.
export default function ReportsModule({ sub }) {
  const allClients = useClients(s => s.clients);

  if (sub === 'Clients') {
    const reportingClients = allClients.filter(c => c.does_reporting !== false);
    return (
      <div className="content-area">
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 14 }}>
          <h2 style={{ margin: 0 }}>Reporting Clients</h2>
          <span className="muted" style={{ fontSize: 12 }}>
            {reportingClients.length} / {allClients.length} clients receive monthly reports
          </span>
        </div>
        <ClientCardsGrid service="reporting" accent="#a78bfa" clients={reportingClients} />
      </div>
    );
  }

  return (
    <div className="content-area">
      {sub === 'AEO Snapshot'   && <AEOSnapshot />}
      {sub === 'Monthly Report' && <MonthlyReport />}
      {sub === 'History'        && <ReportsHistory />}
    </div>
  );
}
