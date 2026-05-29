import React, { useState, useMemo } from 'react';
import { useClients } from '../../store/useClients.js';
import AEOSnapshot from './AEOSnapshot.jsx';
import MonthlyReport from './MonthlyReport.jsx';
import ReportsHistory from './ReportsHistory.jsx';
import { listSentReports, listGeneratedReports } from '../../lib/supabase.js';

const ACCENT = '#a78bfa';
const GREEN = 'var(--green)';
const ORANGE = 'var(--orange)';

function previousMonth() {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  return d.toLocaleString('en-US', { month: 'long', year: 'numeric' });
}

function previousMonthKey() {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  return d.toISOString().slice(0, 7); // YYYY-MM
}

// Router for the Reports sidebar module.
export default function ReportsModule({ sub }) {
  const allClients = useClients(s => s.clients);
  const select = useClients(s => s.select);
  const [showReport, setShowReport] = useState(false);
  const [sentReports, setSentReports] = useState({});
  const [generatedReports, setGeneratedReports] = useState({});

  // Load sent + generated report status for all clients on mount.
  React.useEffect(() => {
    (async () => {
      try {
        const [sent, generated] = await Promise.all([
          listSentReports(),
          listGeneratedReports()
        ]);
        const sentByClient = {};
        for (const r of sent) {
          if (!sentByClient[r.client_id]) sentByClient[r.client_id] = r;
        }
        const genByClient = {};
        for (const r of generated) {
          if (!genByClient[r.client_id]) genByClient[r.client_id] = r;
        }
        setSentReports(sentByClient);
        setGeneratedReports(genByClient);
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
  const monthKey = previousMonthKey();

  // Bucket clients by status for the current report month. Sent always wins
  // over Generated; a regenerated-then-sent report stays in the Sent bucket.
  const buckets = { sent: [], generated: [], pending: [] };
  for (const c of allClients) {
    const sent = sentReports[c.id];
    const gen = generatedReports[c.id];
    const sentThisMonth = sent && sent.month === monthKey;
    const genThisMonth = gen && gen.month === monthKey;
    if (sentThisMonth) buckets.sent.push({ client: c, sent, gen });
    else if (genThisMonth) buckets.generated.push({ client: c, sent, gen });
    else buckets.pending.push({ client: c, sent, gen });
  }

  function renderCard({ client: c, sent, gen }, status) {
    const services = [
      c.does_content !== false && 'Content',
      c.does_technical !== false && 'Technical',
      c.does_aeo !== false && 'AEO'
    ].filter(Boolean);
    const borderColor =
      status === 'sent' ? 'rgba(52,211,153,.4)' :
      status === 'generated' ? 'rgba(255,159,67,.4)' :
      'var(--border)';
    const accentColor =
      status === 'sent' ? GREEN :
      status === 'generated' ? ORANGE :
      ACCENT;

    return (
      <div
        key={c.id}
        className="card"
        style={{
          padding: 14, cursor: 'pointer',
          borderColor,
          borderLeftWidth: 3, borderLeftStyle: 'solid',
          borderLeftColor: accentColor
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
          {status === 'sent' && <span className="badge green" style={{ fontSize: 9 }}>Sent</span>}
          {status === 'generated' && (
            <span className="badge" style={{ fontSize: 9, borderColor: ORANGE, color: ORANGE }}>Generated</span>
          )}
          {status === 'pending' && (
            <span className="badge" style={{ fontSize: 9, borderColor: ACCENT, color: ACCENT }}>Pending</span>
          )}
        </div>
        <div className="muted" style={{ fontSize: 11 }}>
          {services.join(' · ') || 'No services'}
        </div>
        {status === 'sent' && (
          <div className="muted" style={{ fontSize: 10, marginTop: 4 }}>
            Sent: {new Date(sent.sent_date).toLocaleDateString('en-ZA')}
            {sent.qa_score ? ' · QA ' + sent.qa_score + '/10' : ''}
          </div>
        )}
        {status === 'generated' && (
          <div className="muted" style={{ fontSize: 10, marginTop: 4 }}>
            Generated: {new Date(gen.generated_at).toLocaleDateString('en-ZA')}
            {gen.report_type ? ' · ' + gen.report_type : ''}
            {gen.qa_score ? ' · QA ' + gen.qa_score + '/10' : ''}
          </div>
        )}
        <button
          style={{
            marginTop: 8, fontSize: 10, padding: '4px 10px',
            borderColor: accentColor, color: accentColor
          }}
          onClick={(e) => {
            e.stopPropagation();
            select(c.id);
            setShowReport(true);
          }}
        >
          {status === 'sent' ? 'Regenerate Report'
            : status === 'generated' ? 'Review & Send'
            : 'Generate Report'}
        </button>
      </div>
    );
  }

  function renderSection(title, items, status, hint) {
    if (items.length === 0) return null;
    return (
      <div style={{ marginBottom: 24 }}>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
          <h3 style={{ margin: 0, fontSize: 14, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--text-muted)' }}>
            {title} <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>· {items.length}</span>
          </h3>
          {hint && <div className="muted" style={{ fontSize: 11 }}>{hint}</div>}
        </div>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
          gap: 10
        }}>
          {items.map(item => renderCard(item, status))}
        </div>
      </div>
    );
  }

  return (
    <div className="content-area">
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 18 }}>
        <div>
          <h2 style={{ margin: 0 }}>Monthly Reports — {month}</h2>
          <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
            {allClients.length} clients · {buckets.sent.length} sent · {buckets.generated.length} generated · {buckets.pending.length} pending
          </div>
        </div>
      </div>

      {renderSection('Generated — awaiting send', buckets.generated, 'generated', 'Microsite built but not yet marked sent')}
      {renderSection('Sent', buckets.sent, 'sent', 'Logged in report history')}
      {renderSection('Pending', buckets.pending, 'pending', 'No report for this month yet')}

      {allClients.length === 0 && (
        <div className="muted" style={{ fontSize: 13 }}>No clients yet — add clients first.</div>
      )}
    </div>
  );
}
