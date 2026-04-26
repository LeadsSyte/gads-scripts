import React, { useState, useMemo } from 'react';
import { useClients } from '../../store/useClients.js';
import AEOSnapshot from './AEOSnapshot.jsx';
import MonthlyReport from './MonthlyReport.jsx';
import ReportsHistory from './ReportsHistory.jsx';
import { listSentReports } from '../../lib/supabase.js';

const ACCENT = '#a78bfa';

function previousMonth() {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  return d.toLocaleString('en-US', { month: 'long', year: 'numeric' });
}

// Router for the Reports sidebar module.
export default function ReportsModule({ sub }) {
  const allClients = useClients(s => s.clients);
  const select = useClients(s => s.select);
  const selectedId = useClients(s => s.selectedId);
  const [showReport, setShowReport] = useState(false);
  const [sentReports, setSentReports] = useState({});

  // Load sent report status for all clients on mount.
  React.useEffect(() => {
    (async () => {
      try {
        const reports = await listSentReports();
        const byClient = {};
        for (const r of reports) {
          if (!byClient[r.client_id]) byClient[r.client_id] = r;
        }
        setSentReports(byClient);
      } catch {}
    })();
  }, []);

  if (sub === 'AEO Snapshot') {
    return <div className="content-area"><AEOSnapshot /></div>;
  }

  if (sub === 'History') {
    return <div className="content-area"><ReportsHistory /></div>;
  }

  // Monthly Report — show all clients as cards, click to generate
  if (showReport) {
    return (
      <div className="content-area">
        <button onClick={() => setShowReport(false)} style={{ marginBottom: 14, fontSize: 12 }}>
          ← Back to all clients
        </button>
        <MonthlyReport />
      </div>
    );
  }

  const month = previousMonth();

  return (
    <div className="content-area">
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 14 }}>
        <div>
          <h2 style={{ margin: 0 }}>Monthly Reports — {month}</h2>
          <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
            {allClients.length} clients · Click a client to generate their report
          </div>
        </div>
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
        gap: 10
      }}>
        {allClients.map(c => {
          const lastReport = sentReports[c.id];
          const hasReport = !!lastReport;
          const services = [
            c.does_content !== false && 'Content',
            c.does_technical !== false && 'Technical',
            c.does_aeo !== false && 'AEO'
          ].filter(Boolean);

          return (
            <div
              key={c.id}
              className="card"
              style={{
                padding: 14, cursor: 'pointer',
                borderColor: hasReport ? 'rgba(52,211,153,.3)' : 'var(--border)',
                borderLeftWidth: 3, borderLeftStyle: 'solid',
                borderLeftColor: hasReport ? 'var(--green)' : ACCENT
              }}
              onClick={() => {
                select(c.id);
                setShowReport(true);
              }}
            >
              <div className="row" style={{ justifyContent: 'space-between', marginBottom: 4 }}>
                <strong style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '70%' }}>
                  {c.name}
                </strong>
                {hasReport ? (
                  <span className="badge green" style={{ fontSize: 9 }}>Sent</span>
                ) : (
                  <span className="badge" style={{ fontSize: 9, borderColor: ACCENT, color: ACCENT }}>Pending</span>
                )}
              </div>
              <div className="muted" style={{ fontSize: 11 }}>
                {services.join(' · ') || 'No services'}
              </div>
              {hasReport && (
                <div className="muted" style={{ fontSize: 10, marginTop: 4 }}>
                  Last: {new Date(lastReport.sent_date).toLocaleDateString('en-ZA')}
                  {lastReport.qa_score ? ' · QA ' + lastReport.qa_score + '/10' : ''}
                </div>
              )}
              <button
                style={{
                  marginTop: 8, fontSize: 10, padding: '4px 10px',
                  borderColor: ACCENT, color: ACCENT
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  select(c.id);
                  setShowReport(true);
                }}
              >
                {hasReport ? 'Regenerate Report' : 'Generate Report'}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
