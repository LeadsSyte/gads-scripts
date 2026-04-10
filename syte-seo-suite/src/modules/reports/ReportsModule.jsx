import React from 'react';
import { useClients } from '../../store/useClients.js';
import AEOSnapshot from './AEOSnapshot.jsx';
import MonthlyReport from './MonthlyReport.jsx';
import ReportsHistory from './ReportsHistory.jsx';

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
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>URL</th>
                <th>Reporting Email</th>
                <th>Start Date</th>
                <th>AEO Queries</th>
                <th>Competitors</th>
                <th>Rankscale</th>
              </tr>
            </thead>
            <tbody>
              {reportingClients.length === 0 && (
                <tr><td colSpan={7} className="muted" style={{ textAlign: 'center', padding: 24 }}>
                  No clients have Reporting enabled. Toggle it on in Edit Client → Services.
                </td></tr>
              )}
              {reportingClients.map(c => {
                const queryCount = (c.aeo_probe_queries || '').split('\n').filter(Boolean).length;
                const compCount = (c.competitors || '').split(',').filter(Boolean).length;
                return (
                  <tr key={c.id}>
                    <td>{c.name}</td>
                    <td className="muted" style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.url || '—'}</td>
                    <td className="muted">{c.reporting_email || <span style={{ color: 'var(--orange)' }}>missing</span>}</td>
                    <td className="muted">{c.start_date || '—'}</td>
                    <td>{queryCount > 0 ? queryCount : <span style={{ color: 'var(--orange)' }}>none</span>}</td>
                    <td>{compCount}</td>
                    <td>{c.rankscale_url ? <span className="badge blue">yes</span> : <span className="badge">—</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
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
