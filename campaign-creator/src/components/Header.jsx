const STEPS = ['Brief', 'Scan', 'Steer', 'Generate', 'Results'];

export default function Header({ step }) {
  return (
    <div
      style={{
        background: '#0f1a2a',
        color: 'white',
        padding: '14px 28px',
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        position: 'sticky',
        top: 0,
        zIndex: 50,
        boxShadow: '0 2px 12px rgba(0,0,0,0.3)',
      }}
    >
      <div
        style={{
          width: 34,
          height: 34,
          borderRadius: 8,
          background: 'linear-gradient(135deg, #e67e22, #f1c40f)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 17,
          fontWeight: 700,
          flexShrink: 0,
        }}
      >
        S
      </div>
      <div>
        <div style={{ fontWeight: 700, fontSize: 15 }}>Syte Campaign Creator</div>
        <div style={{ fontSize: 11, opacity: 0.55 }}>AI-Powered → Single Bulk CSV for Google Ads Editor</div>
      </div>

      {step !== undefined && (
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
          {STEPS.map((s, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <div
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: '50%',
                  background: i < step ? '#059669' : i === step ? '#e67e22' : 'rgba(255,255,255,0.15)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 10,
                  fontWeight: 700,
                  color: 'white',
                  transition: 'all 0.3s',
                }}
              >
                {i < step ? '✓' : i + 1}
              </div>
              {i < 4 && (
                <div
                  style={{
                    width: 16,
                    height: 2,
                    background: i < step ? '#059669' : 'rgba(255,255,255,0.15)',
                    borderRadius: 1,
                  }}
                />
              )}
            </div>
          ))}
        </div>
      )}

      <div
        style={{
          fontSize: 11,
          background: 'linear-gradient(135deg, #7c3aed, #a78bfa)',
          padding: '4px 10px',
          borderRadius: 10,
          fontWeight: 700,
          flexShrink: 0,
          marginLeft: step !== undefined ? 8 : 'auto',
        }}
      >
        v4.1
      </div>
    </div>
  );
}
