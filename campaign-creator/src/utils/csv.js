import { STD_NEGS, BID_MAP } from '../constants';

const COLS = [
  'Campaign', 'Campaign type', 'Campaign status', 'Campaign daily budget', 'Bid strategy type',
  'Networks', 'Languages', 'EU political ads',
  'Ad group', 'Ad group status', 'Default max. CPC',
  'Keyword', 'Match type', 'Status', 'Max CPC',
  'Headline 1', 'Headline 2', 'Headline 3', 'Headline 4', 'Headline 5',
  'Headline 6', 'Headline 7', 'Headline 8', 'Headline 9', 'Headline 10',
  'Headline 11', 'Headline 12', 'Headline 13', 'Headline 14', 'Headline 15',
  'Description 1', 'Description 2', 'Description 3', 'Description 4',
  'Final URL', 'Path 1', 'Path 2',
  'Location', 'Reach',
  'Sitelink text', 'Description line 1', 'Description line 2',
  'Callout text',
  'Structured snippet header', 'Structured snippet values',
];

function empty() {
  return Object.fromEntries(COLS.map(c => [c, '']));
}

export function buildBulkCSV(gen, brief) {
  const cn = brief.campaignName || brief.businessName + ' - Search - Syte';
  const fu = brief.landingPage || brief.website || 'https://example.com';
  const locs = (brief.targetLocations || '').split(/[,\n]/).map(s => s.trim()).filter(Boolean);

  const rows = [];

  // Campaign row
  const camp = empty();
  camp['Campaign'] = cn;
  camp['Campaign type'] = 'Search';
  camp['Campaign status'] = 'Paused';
  camp['Campaign daily budget'] = brief.dailyBudget;
  camp['Bid strategy type'] = BID_MAP[brief.bidStrategy] || 'Maximize conversions';
  camp['Networks'] = 'Google Search';
  camp['Languages'] = brief.language;
  camp['EU political ads'] = 'No';
  rows.push(camp);

  // Location rows
  locs.forEach(loc => {
    const r = empty();
    r['Campaign'] = cn;
    r['Location'] = loc;
    r['Reach'] = 'People in or regularly in targeted locations';
    rows.push(r);
  });

  // Ad group + keyword + ad rows
  gen.adGroups.forEach(ag => {
    const cpc = (parseFloat(ag.defaultCpc) || 10).toFixed(2);

    // Ad group row
    const agRow = empty();
    agRow['Campaign'] = cn;
    agRow['Ad group'] = ag.name;
    agRow['Ad group status'] = 'Enabled';
    agRow['Default max. CPC'] = cpc;
    rows.push(agRow);

    // Keyword rows
    (ag.keywords || []).forEach(kw => {
      const r = empty();
      r['Campaign'] = cn;
      r['Ad group'] = ag.name;
      r['Keyword'] = kw.matchType === 'Phrase' ? `"${kw.text}"` : `[${kw.text}]`;
      r['Match type'] = kw.matchType === 'Phrase' ? 'Phrase' : 'Exact';
      r['Status'] = 'Enabled';
      r['Max CPC'] = cpc;
      rows.push(r);
    });

    // Ad rows
    ag.ads.forEach(ad => {
      const r = empty();
      r['Campaign'] = cn;
      r['Ad group'] = ag.name;
      const hl = [...ad.headlines]; while (hl.length < 15) hl.push('');
      const ds = [...ad.descriptions]; while (ds.length < 4) ds.push('');
      for (let i = 0; i < 15; i++) r[`Headline ${i + 1}`] = hl[i] || '';
      for (let i = 0; i < 4; i++) r[`Description ${i + 1}`] = ds[i] || '';
      r['Final URL'] = fu;
      r['Path 1'] = ad.path1 || '';
      r['Path 2'] = ad.path2 || '';
      r['Status'] = 'Enabled';
      rows.push(r);
    });
  });

  // Negative keyword rows
  gen.negatives.forEach(neg => {
    const r = empty();
    r['Campaign'] = cn;
    r['Keyword'] = neg;
    r['Match type'] = 'Phrase negative';
    rows.push(r);
  });

  // Sitelink rows
  (gen.sitelinks || []).forEach(sl => {
    const r = empty();
    r['Campaign'] = cn;
    r['Sitelink text'] = sl.text;
    r['Description line 1'] = sl.description1;
    r['Description line 2'] = sl.description2;
    r['Final URL'] = sl.finalUrl;
    rows.push(r);
  });

  // Callout rows
  (gen.callouts || []).forEach(c => {
    const r = empty();
    r['Campaign'] = cn;
    r['Callout text'] = c;
    rows.push(r);
  });

  // Structured snippet row
  if (gen.structuredSnippet && gen.structuredSnippet.values && gen.structuredSnippet.values.length) {
    const r = empty();
    r['Campaign'] = cn;
    r['Structured snippet header'] = gen.structuredSnippet.header;
    r['Structured snippet values'] = gen.structuredSnippet.values.join('; ');
    rows.push(r);
  }

  return { cols: COLS, rows };
}

export function buildSheetData(gen, brief) {
  const cn = brief.campaignName || brief.businessName + ' - Search - Syte';
  const fu = brief.landingPage || brief.website || 'https://example.com';
  const locs = (brief.targetLocations || '').split(/[,\n]/).map(s => s.trim()).filter(Boolean);

  const campaign = {
    headers: ['Campaign', 'Campaign type', 'Campaign status', 'Budget', 'Bid Strategy', 'Networks', 'EU political ads'],
    rows: [[cn, 'Search', 'Paused', brief.dailyBudget, BID_MAP[brief.bidStrategy] || 'Maximize conversions', 'Google Search', 'No']],
  };

  const locations = {
    headers: ['Campaign', 'Location', 'Reach'],
    rows: locs.map(l => [cn, l, 'People in or regularly in targeted locations']),
  };

  const adGroups = {
    headers: ['Campaign', 'Ad Group', 'Status', 'Default max. CPC'],
    rows: gen.adGroups.map(ag => [cn, ag.name, 'Enabled', (parseFloat(ag.defaultCpc) || 10).toFixed(2)]),
  };

  const kwRows = [];
  gen.adGroups.forEach(ag => {
    const cpc = (parseFloat(ag.defaultCpc) || 10).toFixed(2);
    (ag.keywords || []).forEach(kw => {
      const mt = kw.matchType === 'Phrase' ? 'Phrase' : 'Exact';
      kwRows.push([cn, ag.name, mt === 'Exact' ? `[${kw.text}]` : `"${kw.text}"`, mt, 'Enabled', cpc]);
    });
  });
  const keywords = {
    headers: ['Campaign', 'Ad Group', 'Keyword', 'Match Type', 'Status', 'Max CPC'],
    rows: kwRows,
  };

  const negatives = {
    headers: ['Campaign', 'Keyword', 'Match Type'],
    rows: gen.negatives.map(n => [cn, n, 'Phrase negative']),
  };

  const hCols = Array.from({ length: 15 }, (_, i) => 'Headline ' + (i + 1));
  const dCols = Array.from({ length: 4 }, (_, i) => 'Description ' + (i + 1));
  const adRows = [];
  gen.adGroups.forEach(ag =>
    ag.ads.forEach(ad => {
      const hl = [...ad.headlines]; while (hl.length < 15) hl.push('');
      const ds = [...ad.descriptions]; while (ds.length < 4) ds.push('');
      adRows.push([cn, ag.name, ...hl.slice(0, 15), ...ds.slice(0, 4), fu, ad.path1 || '', ad.path2 || '', 'Enabled']);
    })
  );
  const ads = {
    headers: ['Campaign', 'Ad Group', ...hCols, ...dCols, 'Final URL', 'Path 1', 'Path 2', 'Status'],
    rows: adRows,
  };

  const sitelinks = {
    headers: ['Campaign', 'Sitelink text', 'Desc 1', 'Desc 2', 'Final URL'],
    rows: (gen.sitelinks || []).map(sl => [cn, sl.text, sl.description1, sl.description2, sl.finalUrl]),
  };

  const callouts = {
    headers: ['Campaign', 'Callout text'],
    rows: (gen.callouts || []).map(c => [cn, c]),
  };

  const snippets = {
    headers: ['Campaign', 'Header', 'Values'],
    rows: gen.structuredSnippet && gen.structuredSnippet.values && gen.structuredSnippet.values.length
      ? [[cn, gen.structuredSnippet.header, gen.structuredSnippet.values.join('; ')]]
      : [],
  };

  return { campaign, locations, adGroups, keywords, negatives, ads, sitelinks, callouts, snippets };
}

function toCSV(cols, rows) {
  const esc = v => {
    const s = String(v == null ? '' : v);
    return (s.includes(',') || s.includes('"') || s.includes('\n'))
      ? '"' + s.replace(/"/g, '""') + '"'
      : s;
  };
  const header = cols.map(esc).join(',');
  const body = rows.map(r => cols.map(c => esc(r[c] || '')).join(',')).join('\n');
  return header + '\n' + body;
}

export function downloadCSV(gen, brief) {
  const { cols, rows } = buildBulkCSV(gen, brief);
  const csv = toCSV(cols, rows);
  const slug = (brief.campaignName || brief.businessName || 'campaign').replace(/\s+/g, '_').toLowerCase();
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = slug + '_google_ads_bulk.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function kwStats(ags) {
  let e = 0, p = 0;
  ags.forEach(ag => (ag.keywords || []).forEach(k => k.matchType === 'Phrase' ? p++ : e++));
  return { exact: e, phrase: p, total: e + p };
}
