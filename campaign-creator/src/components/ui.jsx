export function Fld({ label, value, onChange, ph, type = 'text' }) {
  return (
    <div style={{ marginBottom: 14, flex: 1 }}>
      <label className="field-label">{label}</label>
      <input
        type={type}
        value={value}
        placeholder={ph || ''}
        onChange={e => onChange(e.target.value)}
        className="field-input"
      />
    </div>
  );
}

export function TA({ label, value, onChange, ph }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label className="field-label">{label}</label>
      <textarea
        value={value}
        placeholder={ph || ''}
        onChange={e => onChange(e.target.value)}
        className="field-textarea"
      />
    </div>
  );
}

export function Sel({ label, value, onChange, options }) {
  return (
    <div style={{ marginBottom: 14, flex: 1 }}>
      <label className="field-label">{label}</label>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="field-input"
      >
        {options.map(o => (
          <option key={o.v} value={o.v}>{o.l}</option>
        ))}
      </select>
    </div>
  );
}

export function Btn({ onClick, bg, color, border, children, small }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: small ? '6px 12px' : '9px 18px',
        borderRadius: 8,
        border: border || 'none',
        background: bg,
        color,
        fontSize: small ? 12 : 13,
        fontWeight: 600,
        cursor: 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
      }}
    >
      {children}
    </button>
  );
}

export function IB({ type, children }) {
  return <div className={`info-box ${type}`}>{children}</div>;
}

export function SC({ n, l, sub, color }) {
  return (
    <div className="stat-card">
      <div className="stat-number" style={{ color: color || '#e67e22' }}>{n}</div>
      <div className="stat-label">{l}</div>
      {sub && <div className="stat-sub" style={{ color: color || '#e67e22' }}>{sub}</div>}
    </div>
  );
}

export function Sec({ t, d, children }) {
  return (
    <div className="card">
      <div className="section-title">{t}</div>
      {d && <div className="section-subtitle">{d}</div>}
      {children}
    </div>
  );
}

export function Err({ error, setError }) {
  if (!error) return null;
  return (
    <div className="error-banner">
      <div><b>⚠️ </b>{error}</div>
      <span style={{ cursor: 'pointer', fontWeight: 700, marginLeft: 12 }} onClick={() => setError(null)}>×</span>
    </div>
  );
}
