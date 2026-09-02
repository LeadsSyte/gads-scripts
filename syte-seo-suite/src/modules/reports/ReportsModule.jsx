import React, { useState, useMemo } from 'react';
import { useClients } from '../../store/useClients.js';
import AEOSnapshot from './AEOSnapshot.jsx';
import MonthlyReport from './MonthlyReport.jsx';
import Baseline from './Baseline.jsx';
import ReportsHistory from './ReportsHistory.jsx';
import MarkEmailedModal from './MarkEmailedModal.jsx';
import DevExport from './DevExport.jsx';
import { listSentReports, listGeneratedReports, syncGeneratedLocal } from '../../lib/supabase.js';
import { previousMonthKey, monthKeyLabel, selectableMonthKeys } from './reportMonths.js';

const ACCENT = '#a78bfa';
const GREEN = 'var(--green)';
const ORANGE = 'var(--orange)';

// Router for the Reports sidebar module.
export default function ReportsModule({ sub }) {
  const allClients = useClients(s => s.clients);
  const select = useClients(s => s.select);
  const [showReport, setShowReport] = useState(false);
  // Full lists; the per-client / per-month row is picked below. SEO and AEO
  // are separate deliverables, so each card shows both statuses.
  const [allSent, setAllSent] = useState([]);
  const [allGenerated, setAllGenerated] = useState([]);
  const [emailModal, setEmailModal] = useState(null); // { client } | null
  const [loadErr, setLoadErr] = useState('');
  // How many device-only reports were just pushed up to the shared database.
  const [recovered, setRecovered] = useState(0);
  // Which month the board is showing. Defaults to the month just finished —
  // what the generator defaults to — but is selectable, so a report logged
  // under a different month is findable instead of silently absent.
  const [monthKey, setMonthKey] = useState(() => previousMonthKey());

  // Load sent + generated report status for all clients. Extracted so it can
  // be re-run after marking a client emailed, and whenever the operator
  // returns from the report generator (so a just-generated report shows).
  const loadStatus = React.useCallback(async () => {
    try {
      // Reports that only reached this device — a DB write that failed while
      // the log still allowed one report per client per month — go up first,
      // so they show for everyone instead of needing to be regenerated.
      const sync = await syncGeneratedLocal();
      setRecovered(sync?.pushed || 0);
      const [sent, generated] = await Promise.all([
        listSentReports(),
        listGeneratedReports()
      ]);
      setAllSent(sent || []);
      setAllGenerated(generated || []);
      setLoadErr('');
    } catch (e) {
      // A silent catch here left the board showing every client as Pending
      // with no hint that the read had failed.
      setLoadErr('Could not load report status: ' + (e?.message || String(e)));
    }
  }, []);

  React.useEffect(() => { loadStatus(); }, [loadStatus]);

  // Refresh status when returning to the client list from the generator, so a
  // report generated inside MonthlyReport reflects without a full page reload.
  React.useEffect(() => {
    if (!showReport) loadStatus();
  }, [showReport, loadStatus]);

  if (sub === 'Baseline') {
    return <Baseline />;
  }

  if (sub === 'AEO Snapshot') {
    return <div className="content-area"><AEOSnapshot /></div>;
  }

  if (sub === 'History') {
    return <div className="content-area"><ReportsHistory /></div>;
  }

  if (sub === 'Dev Export') {
    return <DevExport />;
  }

  // Monthly Report — show all clients as cards, click to generate
  if (showReport) {
    return (
      <div className="content-area">
        <button onClick={() => setShowReport(false)} style={{ marginBottom: 14, fontSize: 12 }}>
          ← Back to all clients
        </button>
        <MonthlyReport initialMonth={monthKey} />
      </div>
    );
  }

  const month = monthKeyLabel(monthKey);

  // Newest row per client FOR THE MONTH ON SCREEN. Picking the client's
  // globally-newest row instead (what this did before) meant a report
  // generated for a later month hid the one for the month being viewed, and
  // that client dropped to Pending.
  const newestFor = (rows, clientId, dateKey) =>
    rows
      .filter(r => r.client_id === clientId && r.month === monthKey)
      .sort((a, b) => String(b[dateKey] || '').localeCompare(String(a[dateKey] || '')))[0] || null;

  // Bucket clients by status for the selected report month. Sent always wins
  // over Generated; a regenerated-then-sent report stays in the Sent bucket.
  const buckets = { sent: [], generated: [], pending: [] };
  for (const c of allClients) {
    const sent = newestFor(allSent, c.id, 'sent_date');
    const gen = newestFor(allGenerated, c.id, 'generated_at');
    if (sent) buckets.sent.push({ client: c, sent, gen });
    else if (gen) buckets.generated.push({ client: c, sent, gen });
    else buckets.pending.push({ client: c, sent, gen });
  }

  // Reports logged under a month other than the one on screen. Without this,
  // "I generated these and they're not here" has no visible explanation.
  const otherMonths = [...new Set(
    allGenerated.filter(r => r.month && r.month !== monthKey).map(r => r.month)
  )].sort().reverse();

  // A client on both services needs both reports produced, so each card
  // tracks them independently. Rows logged before the split carry
  // report_type 'full'; treat those as the SEO report, which is what they
  // led with.
  function typeStatus(clientId, type) {
    const matches = r =>
      r.client_id === clientId &&
      r.month === monthKey &&
      ((r.report_type || 'full') === type || (type === 'seo' && (r.report_type || 'full') === 'full'));
    if (allSent.some(matches)) return 'Sent';
    if (allGenerated.some(matches)) return 'Generated';
    return 'Pending';
  }

  function renderCard({ client: c, sent, gen }, status) {
    const services = [
      c.does_content !== false && 'Content',
      c.does_technical !== false && 'Technical',
      c.does_aeo !== false && 'AEO'
    ].filter(Boolean);
    const perType = [
      (c.does_content !== false || c.does_technical !== false) && ['SEO', typeStatus(c.id, 'seo')],
      c.does_aeo !== false && ['AEO', typeStatus(c.id, 'aeo')]
    ].filter(Boolean);
    const typeColor = st => st === 'Sent' ? GREEN : st === 'Generated' ? ORANGE : 'var(--text-muted)';
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
          {status === 'sent' && (
            <span className="row" style={{ gap: 4 }}>
              {(sent?.pdf_filename || sent?.manual) && (
                <span className="badge blue" style={{ fontSize: 9 }} title="Proof PDF on file">PDF</span>
              )}
              <span className="badge green" style={{ fontSize: 9 }}>{sent?.manual ? 'Emailed' : 'Sent'}</span>
            </span>
          )}
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
        {perType.length > 0 && (
          <div className="row" style={{ gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
            {perType.map(([label, st]) => (
              <span key={label} style={{
                fontSize: 10, padding: '2px 8px', borderRadius: 999,
                border: '1px solid var(--border)', color: typeColor(st)
              }}>
                {label}: {st}
              </span>
            ))}
          </div>
        )}
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
        <div className="row" style={{ gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
          <button
            style={{
              fontSize: 10, padding: '4px 10px',
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
          {/* Log that the client was emailed their report — works for any
              client regardless of whether a report was generated here. */}
          <button
            style={{ fontSize: 10, padding: '4px 10px', borderColor: GREEN, color: GREEN }}
            onClick={(e) => { e.stopPropagation(); setEmailModal({ client: c }); }}
            title="Log that you emailed this client their report (upload PDF proof)"
          >
            ✉ Mark emailed
          </button>
        </div>
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
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 18, alignItems: 'flex-start' }}>
        <div>
          <h2 style={{ margin: 0 }}>Monthly Reports — {month}</h2>
          <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
            {allClients.length} clients · {buckets.sent.length} sent · {buckets.generated.length} generated · {buckets.pending.length} pending
          </div>
        </div>
        <label className="row" style={{ gap: 6, fontSize: 12 }}>
          <span className="muted">Report month</span>
          <select value={monthKey} onChange={e => setMonthKey(e.target.value)} style={{ fontSize: 12 }}>
            {[...new Set([...selectableMonthKeys(13), ...allGenerated.map(r => r.month), ...allSent.map(r => r.month)])]
              .filter(Boolean)
              .sort()
              .reverse()
              .map(m => <option key={m} value={m}>{monthKeyLabel(m)}</option>)}
          </select>
        </label>
      </div>

      {recovered > 0 && (
        <div className="muted" style={{ fontSize: 12, marginBottom: 14 }}>
          Uploaded {recovered} report{recovered === 1 ? '' : 's'} that had only been saved on this device.
          {' '}They now show for everyone.
        </div>
      )}

      {loadErr && (
        <div className="card" style={{ marginBottom: 14, borderColor: 'var(--red)', color: 'var(--red)', fontSize: 12 }}>
          {loadErr}
        </div>
      )}

      {buckets.generated.length === 0 && buckets.sent.length === 0 && otherMonths.length > 0 && (
        <div className="muted" style={{ fontSize: 12, marginBottom: 14 }}>
          No reports generated for {month}. There are generated reports for{' '}
          {otherMonths.slice(0, 4).map((m, i) => (
            <React.Fragment key={m}>
              {i > 0 && ', '}
              <a
                href="#"
                onClick={e => { e.preventDefault(); setMonthKey(m); }}
                style={{ color: ORANGE }}
              >{monthKeyLabel(m)}</a>
            </React.Fragment>
          ))}.
        </div>
      )}

      {renderSection('Generated — awaiting send', buckets.generated, 'generated', 'Microsite built but not yet marked sent')}
      {renderSection('Sent', buckets.sent, 'sent', 'Logged in report history')}
      {renderSection('Pending', buckets.pending, 'pending', 'No report for this month yet')}

      {allClients.length === 0 && (
        <div className="muted" style={{ fontSize: 13 }}>No clients yet — add clients first.</div>
      )}

      {emailModal && (
        <MarkEmailedModal
          client={emailModal.client}
          defaultMonth={monthKey}
          onClose={() => setEmailModal(null)}
          onDone={loadStatus}
        />
      )}
    </div>
  );
}
