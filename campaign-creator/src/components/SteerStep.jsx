import { Fld, TA, Sel, Err } from './ui';

export default function SteerStep({
  brief, up, scanResult, selectedSvcs, toggleSvc,
  customSvcs, setCustomSvcs, campaignAngle, setCampaignAngle,
  excludeNote, setExcludeNote, stagingWarning,
  onGenerate, onBack, error, setError,
}) {
  const sr = scanResult;
  const allSvcs = sr.detectedServices || [];
  const selectedCount = selectedSvcs.length + customSvcs.split('\n').filter(s => s.trim()).length;

  return (
    <div style={{ maxWidth: 800, margin: '0 auto', padding: 24 }}>
      <Err error={error} setError={setError} />

      {/* Scan summary */}
      <div className="card">
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 16 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <div
                style={{
                  fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 12,
                }}
                className={
                  sr.confidence === 'high' ? 'confidence-high' :
                  sr.confidence === 'medium' ? 'confidence-medium' : 'confidence-low'
                }
              >
                {sr.confidence === 'high' ? '✓ HIGH CONFIDENCE' :
                 sr.confidence === 'medium' ? '⚠ MEDIUM CONFIDENCE' : '⚠ LOW CONFIDENCE'} SCAN
              </div>
            </div>
            <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 22, fontWeight: 700 }}>{sr.businessName}</div>
            <div style={{ fontSize: 13, color: '#5a6a7a', marginTop: 4, maxWidth: 540 }}>{sr.description}</div>
          </div>
          <button
            onClick={onBack}
            style={{
              padding: '7px 14px', borderRadius: 8, border: '1px solid #e0e5ec',
              background: '#f8f9fc', color: '#5a6a7a', fontSize: 12, fontWeight: 600,
              cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
            }}
          >
            ← Edit Brief
          </button>
        </div>

        {sr.confidence !== 'high' && sr.confidenceNote && (
          <div className="info-box warning" style={{ marginBottom: 16 }}>
            ⚠️ <b>Low confidence note:</b> {sr.confidenceNote}. Please review the detected services carefully and correct anything below.
          </div>
        )}

        {stagingWarning && (
          <div className="error-banner" style={{ marginBottom: 16 }}>
            🚧 <b>Staging URL detected.</b> This looks like a preview/app-builder URL. The scan may have picked up platform descriptions instead of real business services. Review carefully below.
          </div>
        )}

        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 12, color: '#5a6a7a', borderTop: '1px solid #f0f2f5', paddingTop: 12 }}>
          <span><b>Industry:</b> {sr.industry}</span>
          <span><b>Customer:</b> {sr.targetCustomer}</span>
        </div>
      </div>

      {/* Service picker */}
      <div className="card">
        <div className="section-title">✅ Which services do you want to advertise?</div>
        <div style={{ fontSize: 13, color: '#7a8a9a', marginBottom: 16 }}>
          AI found {allSvcs.length} items on the site. Each selected service becomes an ad group. Deselect anything irrelevant.
        </div>

        <div style={{ display: 'grid', gap: 8, marginBottom: 16 }}>
          {allSvcs.map((svc, i) => (
            <div
              key={i}
              className={`svc-chip${selectedSvcs.includes(i) ? ' selected' : ''}`}
              onClick={() => toggleSvc(i)}
            >
              <div className="check">{selectedSvcs.includes(i) ? '✓' : ''}</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{svc.name}</div>
                {svc.description && (
                  <div style={{ fontSize: 11, color: '#8a95a5', fontWeight: 400, marginTop: 1 }}>{svc.description}</div>
                )}
              </div>
              {!svc.advertisable && (
                <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 10, background: '#f0f2f5', color: '#8a95a5', fontWeight: 600, flexShrink: 0 }}>
                  non-ad
                </span>
              )}
            </div>
          ))}
        </div>

        <div style={{ borderTop: '1px solid #f0f2f5', paddingTop: 16 }}>
          <label className="field-label">➕ Add services the scan missed (one per line)</label>
          <textarea
            value={customSvcs}
            onChange={e => setCustomSvcs(e.target.value)}
            placeholder={"e.g. Fleet Branding Johannesburg\nVehicle Wrap Services"}
            className="field-textarea"
            style={{ minHeight: 70 }}
          />
        </div>
      </div>

      {/* Campaign steer */}
      <div className="card">
        <div className="section-title">🎯 Campaign Angle & Focus</div>
        <div style={{ fontSize: 13, color: '#7a8a9a', marginBottom: 16 }}>
          Tell the AI how to angle the campaign. This steers all ad copy, keyword selection and tone.
        </div>

        <div style={{ marginBottom: 16 }}>
          <label className="field-label">Campaign focus / angle *</label>
          <textarea
            value={campaignAngle}
            onChange={e => setCampaignAngle(e.target.value)}
            placeholder="e.g. Target B2B fleet managers at logistics companies. Focus on ROI, coverage and GPS tracking. Push for quote requests."
            className="field-textarea"
            style={{ minHeight: 80 }}
          />
        </div>

        <div>
          <label className="field-label">Anything to exclude from copy or keywords?</label>
          <input
            value={excludeNote}
            onChange={e => setExcludeNote(e.target.value)}
            placeholder="e.g. Don't mention pricing, exclude freelancer terms, no residential focus"
            className="field-input"
          />
        </div>
      </div>

      {/* Campaign settings summary */}
      <div className="card">
        <div className="section-title">⚙️ Campaign Settings</div>
        <div style={{ marginTop: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            <Fld label="Campaign Name" value={brief.campaignName} onChange={v => up('campaignName', v)} ph={brief.businessName + ' - Search - Syte'} />
            <Fld label="Landing Page" value={brief.landingPage} onChange={v => up('landingPage', v)} ph={brief.website} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
            <Fld label="Daily Budget" value={brief.dailyBudget} onChange={v => up('dailyBudget', parseFloat(v) || 0)} type="number" />
            <Sel label="Currency" value={brief.currencySymbol} onChange={v => up('currencySymbol', v)} options={[
              { v: 'R', l: 'ZAR (R)' }, { v: '$', l: 'USD ($)' }, { v: '£', l: 'GBP (£)' }, { v: '€', l: 'EUR (€)' },
            ]} />
            <Sel label="Bid Strategy" value={brief.bidStrategy} onChange={v => up('bidStrategy', v)} options={[
              { v: 'Maximize conversions', l: 'Max Conversions' }, { v: 'Maximize clicks', l: 'Max Clicks' },
              { v: 'Target CPA', l: 'Target CPA' }, { v: 'Manual CPC', l: 'Manual CPC' },
            ]} />
            <Sel label="Language" value={brief.language} onChange={v => up('language', v)} options={[
              { v: 'en', l: 'English' }, { v: 'af', l: 'Afrikaans' }, { v: 'fr', l: 'French' }, { v: 'de', l: 'German' },
            ]} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <TA label="Target Locations" value={brief.targetLocations} onChange={v => up('targetLocations', v)} />
            <TA label="Additional Notes" value={brief.additionalNotes} onChange={v => up('additionalNotes', v)} ph="Any other instructions..." />
          </div>
        </div>
      </div>

      {/* Generate button */}
      <div style={{ textAlign: 'center', padding: '8px 0 24px' }}>
        <div style={{ fontSize: 13, color: '#7a8a9a', marginBottom: 12 }}>
          <b style={{ color: selectedCount > 0 ? '#059669' : '#dc2626' }}>
            {selectedCount} service{selectedCount !== 1 ? 's' : ''}
          </b> selected → {selectedCount} ad group{selectedCount !== 1 ? 's' : ''}
        </div>
        <button
          onClick={onGenerate}
          disabled={selectedCount === 0}
          className="btn-primary"
        >
          ✨ Generate Campaign
        </button>
        <div style={{ fontSize: 12, color: '#9aa5b0', marginTop: 8 }}>~15–30 seconds · Outputs a single .csv with all data</div>
      </div>
    </div>
  );
}
