import { SHEETS } from '../constants';
import { buildSheetData, downloadCSV, kwStats } from '../utils/csv';
import { Btn, SC, Sec, IB, Err } from './ui';

export default function ResultsStep({
  gen, setGen, brief, campaignAngle,
  activeSheet, setActiveSheet,
  onBack, onRegenAll, onRegenAg, expAgs, setExpAgs,
  error, setError,
}) {
  const g = gen;
  const stats = kwStats(g.adGroups);
  const tAd = g.adGroups.reduce((s, ag) => s + ag.ads.length, 0);
  const data = buildSheetData(g, brief);

  function handleDownload() {
    downloadCSV(g, brief);
  }

  function PreviewSheet() {
    const d = data[activeSheet];
    if (!d || !d.rows.length) return <div style={{ padding: 20, color: '#9aa5b0', fontSize: 13 }}>No data for this sheet.</div>;
    return (
      <div style={{ overflow: 'auto', maxHeight: 340 }}>
        <table className="preview-table">
          <thead><tr>{d.headers.map((h, i) => <th key={i}>{h}</th>)}</tr></thead>
          <tbody>{d.rows.map((row, ri) => <tr key={ri}>{row.map((c, ci) => <td key={ci}>{c}</td>)}</tr>)}</tbody>
        </table>
      </div>
    );
  }

  function removeKeyword(agi, ki) {
    const ng = {
      ...gen,
      adGroups: gen.adGroups.map((a, i) =>
        i === agi ? { ...a, keywords: a.keywords.filter((_, j) => j !== ki) } : a
      ),
    };
    setGen(ng);
  }

  function updateHeadline(agi, ai, hi, value) {
    const ng = {
      ...gen,
      adGroups: gen.adGroups.map((a, i) =>
        i === agi
          ? {
              ...a,
              ads: a.ads.map((ad2, j) =>
                j === ai ? { ...ad2, headlines: ad2.headlines.map((hh, k) => (k === hi ? value : hh)) } : ad2
              ),
            }
          : a
      ),
    };
    setGen(ng);
  }

  function updateDescription(agi, ai, di, value) {
    const ng = {
      ...gen,
      adGroups: gen.adGroups.map((a, i) =>
        i === agi
          ? {
              ...a,
              ads: a.ads.map((ad2, j) =>
                j === ai ? { ...ad2, descriptions: ad2.descriptions.map((dd, k) => (k === di ? value : dd)) } : ad2
              ),
            }
          : a
      ),
    };
    setGen(ng);
  }

  const slug = (brief.campaignName || brief.businessName || 'campaign').replace(/\s+/g, '_').toLowerCase();

  return (
    <div style={{ maxWidth: 960, margin: '0 auto', padding: 24 }}>
      <Err error={error} setError={setError} />

      {/* Actions */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap', alignItems: 'center' }}>
        <Btn onClick={onBack} bg="#f5f3ff" color="#7c3aed" border="1px solid #d4b4ff">← Back to Steer</Btn>
        <Btn onClick={onRegenAll} bg="#f5f3ff" color="#7c3aed" border="1px solid #d4b4ff">🔄 Regenerate</Btn>
        <div style={{ marginLeft: 'auto' }}>
          <button onClick={handleDownload} className="btn-download">⬇️ Download All CSVs</button>
        </div>
      </div>

      {/* Stats */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 24, flexWrap: 'wrap' }}>
        <SC n={g.adGroups.length} l="Ad Groups" />
        <SC n={stats.total} l="Keywords" />
        <SC n={stats.exact} l="Exact Match" sub={stats.total > 0 ? Math.round(stats.exact / stats.total * 100) + '%' : ''} color="#1a4b8c" />
        <SC n={stats.phrase} l="Phrase Match" sub={stats.total > 0 ? Math.round(stats.phrase / stats.total * 100) + '%' : ''} color="#166534" />
        <SC n={tAd} l="Ads" />
        <SC n={g.negatives.length} l="Negatives" />
        <SC n={(g.sitelinks || []).length} l="Sitelinks" />
        <SC n={(g.callouts || []).length} l="Callouts" />
      </div>

      {/* Campaign angle badge */}
      {campaignAngle && (
        <div style={{ padding: '10px 16px', borderRadius: 8, background: '#f5f3ff', border: '1px solid #d4b4ff', color: '#5b21b6', fontSize: 13, marginBottom: 20 }}>
          🎯 <b>Campaign angle:</b> {campaignAngle}
        </div>
      )}

      {/* CSV Preview */}
      <Sec t="📊 Bulk CSV Preview" d="9 individual CSVs — import into Google Ads Editor one by one in order (01 first).">
        <div style={{ background: '#fff', border: '1px solid #e0e5ec', borderRadius: 10, overflow: 'hidden' }}>
          <div style={{ background: 'linear-gradient(135deg, #0f1a2a, #1a2a3a)', padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ color: 'white', fontWeight: 700, fontSize: 14 }}>📁 {slug}_google_ads_bulk.csv</div>
              <div style={{ color: '#a8c8ff', fontSize: 12, marginTop: 2 }}>
                9 CSV files · {stats.total} keywords · {tAd} ads · {g.negatives.length} negatives
              </div>
            </div>
            <button onClick={handleDownload} style={{ padding: '8px 18px', borderRadius: 8, border: 'none', background: 'linear-gradient(135deg, #059669, #10b981)', color: 'white', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
              ⬇️ Download CSV
            </button>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, padding: '12px 12px 0', background: '#f8f9fc', borderBottom: '1px solid #e0e5ec' }}>
            {SHEETS.map(s => (
              <div
                key={s.key}
                className={`sheet-tab${activeSheet === s.key ? ' active' : ''}`}
                onClick={() => setActiveSheet(s.key)}
                style={{
                  borderTopColor: activeSheet === s.key ? s.col : '#e0e5ec',
                  color: activeSheet === s.key ? s.col : '#5a6a7a',
                  fontWeight: activeSheet === s.key ? 700 : 500,
                }}
              >
                {s.icon} {s.label}
              </div>
            ))}
          </div>

          <div style={{ background: '#fff' }}>
            <div style={{ padding: '6px 12px', background: '#f8f9fc', borderBottom: '1px solid #eee', fontSize: 11, color: '#8a95a5', fontFamily: 'monospace' }}>
              {data[activeSheet] ? `${data[activeSheet].rows.length} rows · ${data[activeSheet].headers.length} columns` : ''}
            </div>
            <PreviewSheet />
          </div>
        </div>

        <IB type="info">
          <b>Import:</b> Google Ads Editor → File → Import → From file → Select .csv → Editor reads all data. Campaign starts <b>Paused</b>.
        </IB>
      </Sec>

      {/* Ad Groups */}
      <Sec t="📂 Ad Groups" d="Review and edit keywords and ad copy. Changes reflect instantly in the download.">
        {g.adGroups.map((ag, agi) => {
          const ags = kwStats([ag]);
          return (
            <div key={agi} className="ag-card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>{ag.name}</div>
                  <div style={{ fontSize: 12, color: '#8a95a5' }}>
                    {ag.keywords.length} keywords ({ags.exact} exact, {ags.phrase} phrase) · CPC: {brief.currencySymbol}{(parseFloat(ag.defaultCpc) || 10).toFixed(2)}
                  </div>
                </div>
                <Btn onClick={() => onRegenAg(agi)} bg="#f5f3ff" color="#7c3aed" border="1px solid #d4b4ff" small>🔄 Regen</Btn>
              </div>

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 8 }}>
                {(ag.keywords || []).map((kw, ki) => (
                  <span key={ki} className={`kw-chip ${kw.matchType === 'Phrase' ? 'match-phrase' : 'match-exact'}`}>
                    {kw.matchType === 'Exact' ? `[${kw.text}]` : `"${kw.text}"`}
                    <span style={{ cursor: 'pointer', color: '#aaa', fontSize: 13 }} onClick={() => removeKeyword(agi, ki)}>×</span>
                  </span>
                ))}
              </div>

              <span
                style={{ fontSize: 12, color: '#e67e22', cursor: 'pointer', fontWeight: 600, display: 'inline-block' }}
                onClick={() => setExpAgs(p => ({ ...p, [agi]: !p[agi] }))}
              >
                {expAgs[agi] ? '▾ Hide ad copy' : '▸ Show & edit ad copy'}
              </span>

              {expAgs[agi] && ag.ads.map((ad, ai) => (
                <div key={ai} className="ad-preview-card">
                  <div style={{ color: '#1a0dab', fontSize: 14, fontWeight: 500, marginBottom: 3 }}>
                    {ad.headlines.slice(0, 3).filter(Boolean).join(' | ')}
                  </div>
                  <div style={{ color: '#006621', fontSize: 12, marginBottom: 3 }}>
                    {brief.website} › {ad.path1} › {ad.path2}
                  </div>
                  <div style={{ color: '#545454', fontSize: 12, marginBottom: 12 }}>
                    {ad.descriptions.slice(0, 2).filter(Boolean).join(' ')}
                  </div>

                  <div style={{ fontSize: 12, fontWeight: 600, color: '#5a6a7a', marginBottom: 6 }}>Headlines (max 30 chars):</div>
                  {ad.headlines.map((h, hi) => (
                    <div key={hi} style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 3 }}>
                      <span style={{ fontSize: 10, color: '#9aa5b0', width: 18, textAlign: 'right' }}>{hi + 1}</span>
                      <input
                        className="field-input"
                        style={{
                          flex: 1, padding: '5px 8px', fontSize: 12,
                          borderColor: h.length > 30 ? '#dc2626' : '#e0e5ec',
                          borderWidth: 1,
                        }}
                        value={h}
                        maxLength={30}
                        onChange={e => updateHeadline(agi, ai, hi, e.target.value)}
                      />
                      <span style={{
                        fontSize: 10, width: 32, textAlign: 'right',
                        color: h.length > 30 ? '#dc2626' : h.length >= 25 ? '#f59e0b' : '#9aa5b0',
                        fontWeight: h.length > 30 ? 700 : 400,
                      }}>
                        {h.length}/30
                      </span>
                    </div>
                  ))}

                  <div style={{ fontSize: 12, fontWeight: 600, color: '#5a6a7a', marginTop: 10, marginBottom: 6 }}>Descriptions (max 90 chars):</div>
                  {ad.descriptions.map((d, di) => (
                    <div key={di} style={{ display: 'flex', gap: 6, marginBottom: 3 }}>
                      <span style={{ fontSize: 10, color: '#9aa5b0', width: 18, paddingTop: 8 }}>{di + 1}</span>
                      <textarea
                        className="field-textarea"
                        style={{
                          flex: 1, padding: '5px 8px', fontSize: 12,
                          resize: 'none', minHeight: 36,
                          borderColor: d.length > 90 ? '#dc2626' : '#e0e5ec',
                          borderWidth: 1,
                        }}
                        value={d}
                        maxLength={90}
                        onChange={e => updateDescription(agi, ai, di, e.target.value)}
                      />
                      <span style={{
                        fontSize: 10, width: 32, textAlign: 'right', paddingTop: 8,
                        color: d.length > 90 ? '#dc2626' : d.length >= 80 ? '#f59e0b' : '#9aa5b0',
                      }}>
                        {d.length}/90
                      </span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          );
        })}
      </Sec>

      {/* Extensions */}
      <Sec t="🔗 Extensions" d="Sitelinks, callouts & structured snippet — all included in the CSV.">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>📌 Sitelinks</div>
            {(g.sitelinks || []).map((sl, i) => (
              <div key={i} className="ext-card">
                <div style={{ fontWeight: 600, fontSize: 12, color: '#1a0dab' }}>{sl.text}</div>
                <div style={{ fontSize: 11, color: '#545454' }}>{sl.description1}</div>
                <div style={{ fontSize: 11, color: '#545454' }}>{sl.description2}</div>
                <div style={{ fontSize: 10, color: '#006621', marginTop: 2 }}>{sl.finalUrl}</div>
              </div>
            ))}
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>💬 Callouts</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 16 }}>
              {(g.callouts || []).map((c, i) => (
                <span key={i} className="callout-chip">{c}</span>
              ))}
            </div>
            {g.structuredSnippet && g.structuredSnippet.values && g.structuredSnippet.values.length > 0 && (
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>📋 Structured Snippet</div>
                <div className="ext-card">
                  <div style={{ fontWeight: 600, fontSize: 12, color: '#5a6a7a' }}>{g.structuredSnippet.header}:</div>
                  <div style={{ fontSize: 12, color: '#1a2a3a', marginTop: 4 }}>{g.structuredSnippet.values.join(' · ')}</div>
                </div>
              </div>
            )}
          </div>
        </div>
      </Sec>

      {/* Negatives */}
      <Sec t={'🚫 Negative Keywords (' + g.negatives.length + ')'} d="Sheet 05 in the CSV — none appear in the keyword list.">
        <div style={{ fontFamily: 'monospace', fontSize: 12, color: '#5a6a7a', lineHeight: 1.8, background: '#f8f9fc', padding: 12, borderRadius: 8 }}>
          {g.negatives.join(', ')}
        </div>
      </Sec>

      {/* Bottom download */}
      <div style={{ textAlign: 'center', padding: '20px 0 8px' }}>
        <button onClick={handleDownload} className="btn-download-lg">⬇️ Download All CSVs</button>
        <div style={{ fontSize: 12, color: '#9aa5b0', marginTop: 8 }}>9 CSVs · Import into Google Ads Editor in order</div>
      </div>
    </div>
  );
}
