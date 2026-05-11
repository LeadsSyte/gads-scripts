import { Fld, TA, Sel, IB, Err } from './ui';

const STEP_ITEMS = [
  ['1', 'Enter URL', '#e67e22'],
  ['2', 'AI Scans Site', '#7c3aed'],
  ['3', 'You Steer', '#0891b2'],
  ['4', 'AI Generates', '#059669'],
  ['5', 'Download ZIP', '#1a4b8c'],
];

export default function BriefStep({ brief, up, onScan, error, setError }) {
  return (
    <div style={{ maxWidth: 800, margin: '0 auto', padding: 24 }}>
      <Err error={error} setError={setError} />

      {/* Step flow indicator */}
      <div className="step-flow">
        {STEP_ITEMS.map(([n, l, c], i) => (
          <div
            key={i}
            className="step-flow-item"
            style={{ background: i === 0 ? '#fff8f3' : '#fff' }}
          >
            <div style={{ fontSize: 16, fontWeight: 800, color: c }}>{n}</div>
            <div style={{ fontSize: 11, color: '#5a6a7a', marginTop: 2, fontWeight: 500 }}>{l}</div>
          </div>
        ))}
      </div>

      <div className="card" style={{ padding: 28 }}>
        <div className="section-title">🌐 Website & Business</div>
        <div style={{ fontSize: 13, color: '#7a8a9a', marginBottom: 20 }}>
          Enter the URL and hit <b>Scan Website</b>. AI reads the site, detects all services, then you choose what to advertise.
        </div>

        <IB type="ai">
          ✨ <b>New 2-step flow:</b> AI scans first → you pick services + set the campaign angle → AI generates only what you chose. No more irrelevant ad groups.
        </IB>

        <Fld label="Website URL *" value={brief.website} onChange={v => up('website', v)} ph="https://www.example.co.za" />

        <div style={{ marginBottom: 20 }}>
          <button
            onClick={onScan}
            disabled={!brief.website}
            className="btn-primary"
            style={{
              padding: '11px 28px',
              fontSize: 14,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            🔍 Scan Website
          </button>
          <span style={{ fontSize: 12, color: '#9aa5b0', marginLeft: 12 }}>AI reads the site · takes ~10 seconds</span>
        </div>

        <div style={{ borderTop: '1px solid #f0f2f5', paddingTop: 20, marginTop: 4 }}>
          <div style={{ fontSize: 13, color: '#7a8a9a', marginBottom: 16 }}>Or fill in manually if you already know the details:</div>
          <Fld label="Business Name" value={brief.businessName} onChange={v => up('businessName', v)} ph="e.g. MotionAds" />
          <TA label="Business Description" value={brief.description} onChange={v => up('description', v)} ph="What do they do? 2-3 sentences." />
          <Fld label="Industry" value={brief.industry} onChange={v => up('industry', v)} />
          <TA label="Target Customer" value={brief.targetCustomer} onChange={v => up('targetCustomer', v)} />
          <TA label="USPs / Key Benefits (one per line)" value={brief.usps} onChange={v => up('usps', v)} />
        </div>
      </div>

      <div className="card" style={{ padding: 28 }}>
        <div className="section-title">⚙️ Campaign Settings</div>
        <div style={{ marginTop: 16 }}>
          <Fld label="Campaign Name" value={brief.campaignName} onChange={v => up('campaignName', v)} ph="e.g. MotionAds - Search - Syte" />
          <div style={{ display: 'flex', gap: 16 }}>
            <Fld label="Daily Budget" value={brief.dailyBudget} onChange={v => up('dailyBudget', parseFloat(v) || 0)} type="number" />
            <Sel label="Currency" value={brief.currencySymbol} onChange={v => up('currencySymbol', v)} options={[
              { v: 'R', l: 'ZAR (R)' }, { v: '$', l: 'USD ($)' }, { v: '£', l: 'GBP (£)' }, { v: '€', l: 'EUR (€)' },
            ]} />
          </div>
          <div style={{ display: 'flex', gap: 16 }}>
            <Sel label="Bid Strategy" value={brief.bidStrategy} onChange={v => up('bidStrategy', v)} options={[
              { v: 'Maximize conversions', l: 'Max Conversions' }, { v: 'Maximize clicks', l: 'Max Clicks' },
              { v: 'Target CPA', l: 'Target CPA' }, { v: 'Manual CPC', l: 'Manual CPC' },
            ]} />
            <Sel label="Language" value={brief.language} onChange={v => up('language', v)} options={[
              { v: 'en', l: 'English' }, { v: 'af', l: 'Afrikaans' }, { v: 'fr', l: 'French' }, { v: 'de', l: 'German' },
            ]} />
          </div>
          <TA label="Target Locations (one per line)" value={brief.targetLocations} onChange={v => up('targetLocations', v)} />
          <TA label="Excluded Locations (optional)" value={brief.excludedLocations} onChange={v => up('excludedLocations', v)} />
          <Fld label="Your Email" value={brief.emailAddress} onChange={v => up('emailAddress', v)} />
        </div>
      </div>
    </div>
  );
}
