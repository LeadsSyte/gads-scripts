import { useState } from 'react';
import { INIT, STD_NEGS } from './constants';
import { callAI, isStagingUrl } from './services/anthropic';
import Header from './components/Header';
import BriefStep from './components/BriefStep';
import ScanStep from './components/ScanStep';
import SteerStep from './components/SteerStep';
import LoadingStep from './components/LoadingStep';
import ResultsStep from './components/ResultsStep';

const STEP_MAP = { brief: 0, scanning: 1, steer: 2, loading: 3, results: 4 };

export default function App() {
  const [brief, setBrief] = useState(INIT);
  const [state, setState] = useState('brief');
  const [scanResult, setScanResult] = useState(null);
  const [selectedSvcs, setSelectedSvcs] = useState([]);
  const [customSvcs, setCustomSvcs] = useState('');
  const [campaignAngle, setCampaignAngle] = useState('');
  const [excludeNote, setExcludeNote] = useState('');
  const [stagingWarning, setStagingWarning] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState('');
  const [gen, setGen] = useState(null);
  const [expAgs, setExpAgs] = useState({});
  const [error, setError] = useState(null);
  const [activeSheet, setActiveSheet] = useState('campaign');

  const up = (k, v) => setBrief(p => ({ ...p, [k]: v }));

  // ── STEP 1: SCAN ──
  async function scanWebsite() {
    if (!brief.website) { setError('Enter a website URL first.'); return; }
    setError(null);
    const isStaging = isStagingUrl(brief.website);
    setStagingWarning(isStaging);
    setState('scanning');

    try {
      const r = await callAI(
        `You are a Google Ads strategist. Thoroughly analyze this business website: ${brief.website}

Visit and read the website carefully. Extract real business information — NOT descriptions of the website platform or builder (ignore any Lovable, Webflow, Framer, Netlify, Vercel, GitHub Pages branding). Focus entirely on the actual business, its products/services, and who its customers are.

RESPOND WITH ONLY VALID JSON — no markdown, no explanation:
{
  "businessName": "actual business name",
  "industry": "industry/sector",
  "description": "2-3 sentences about what the business actually does and sells to customers",
  "targetCustomer": "who their ideal customer is",
  "detectedServices": [
    {"name": "Service name", "description": "What it is and who it's for", "advertisable": true},
    {"name": "About Us", "description": "company info page", "advertisable": false}
  ],
  "usps": ["USP 1", "USP 2", "USP 3"],
  "suggestedLandingPage": "most relevant landing page URL from the site",
  "confidence": "high|medium|low",
  "confidenceNote": "brief note on what you found and any uncertainty"
}

For detectedServices: list ALL services/products found (6-12 items). Mark advertisable:false for non-ad pages like About Us, Contact, Blog, Careers, Login, Pricing. Mark advertisable:true for actual services/products a customer would search Google for.`,
        5000,
        true
      );

      setScanResult(r);
      const advertisable = (r.detectedServices || [])
        .map((s, i) => (s.advertisable ? i : null))
        .filter(i => i !== null);
      setSelectedSvcs(advertisable);

      setBrief(p => ({
        ...p,
        businessName: r.businessName || p.businessName,
        description: r.description || p.description,
        industry: r.industry || p.industry,
        targetCustomer: r.targetCustomer || p.targetCustomer,
        usps: Array.isArray(r.usps) ? r.usps.join('\n') : p.usps,
        landingPage: r.suggestedLandingPage || p.landingPage,
        campaignName: r.businessName ? r.businessName + ' - Search - Syte' : p.campaignName,
      }));
      setState('steer');
    } catch (e) {
      setError('Scan failed: ' + e.message);
      setState('brief');
    }
  }

  function toggleSvc(i) {
    setSelectedSvcs(prev => (prev.includes(i) ? prev.filter(x => x !== i) : [...prev, i]));
  }

  // ── STEP 2: GENERATE ──
  async function generate() {
    const sr = scanResult;
    const curr = brief.currencySymbol === 'R' ? 'ZAR' : brief.currencySymbol === '$' ? 'USD' : brief.currencySymbol === '£' ? 'GBP' : 'EUR';

    const selected = (sr ? sr.detectedServices || [] : [])
      .filter((_, i) => selectedSvcs.includes(i))
      .map(s => s.name);
    const custom = customSvcs.split('\n').map(s => s.trim()).filter(Boolean);
    const finalServices = [...selected, ...custom];

    if (!brief.businessName) { setError('Business name is required.'); return; }
    if (finalServices.length === 0) { setError('Select at least one service to advertise.'); return; }

    setState('loading');
    setError(null);
    setLoadingMsg('Generating your campaign...');

    const usps = brief.usps.split('\n').map(s => s.trim()).filter(Boolean);

    try {
      const r = await callAI(
        `You are a senior Google Ads specialist. Generate a COMPLETE search campaign.

CLIENT:
- Business: ${brief.businessName}
- Website: ${brief.website}
- Industry: ${brief.industry}
- Description: ${brief.description}
- Target Customer: ${brief.targetCustomer}
- Currency: ${curr}
- Daily Budget: ${brief.dailyBudget}
- Bid Strategy: ${brief.bidStrategy}
- Target Locations: ${brief.targetLocations}
- USPs: ${usps.join(', ') || 'infer from description'}

CAMPAIGN FOCUS / ANGLE (from account manager):
"${campaignAngle || 'Standard direct response — focus on conversions'}"

SERVICES TO ADVERTISE (one ad group each — ONLY these, nothing else):
${finalServices.map((s, i) => (i + 1) + '. ' + s).join('\n')}

${excludeNote ? `EXPLICITLY EXCLUDE FROM ALL COPY AND KEYWORDS: ${excludeNote}` : ''}

RULES:
1. Per ad group: 12-15 TRANSACTIONAL buyer-intent keywords, lowercase.
   - 70% exact match: {"text":"keyword","matchType":"Exact"}
   - 30% phrase match: {"text":"keyword","matchType":"Phrase"}
   - NEVER include informational/negative terms in keywords
2. Per ad group: realistic default max CPC in ${curr} (min ${curr === 'ZAR' ? '8.00' : '1.00'})
3. Per ad group: 1 RSA:
   - EXACTLY 15 headlines ≤30 chars each
   - EXACTLY 4 descriptions ≤90 chars each
   - Business name in ≥2 headlines
   - Strong CTAs: Get Quote, Book Now, Call Today, Enquire Now
   - path1, path2 (max 15 chars, no spaces)
4. 15-25 industry-specific negative keywords in industryNegatives ONLY
5. 4-6 sitelinks: text (≤25), description1 (≤35), description2 (≤35), finalUrl
6. 4-6 callouts (≤25 chars each)
7. 1 structured snippet: header + 5-8 values

RESPOND WITH ONLY VALID JSON:
{
  "adGroups":[{
    "name":"Name",
    "defaultCpc":10.00,
    "keywords":[{"text":"keyword","matchType":"Exact"}],
    "ads":[{"headlines":["h1","h2","h3","h4","h5","h6","h7","h8","h9","h10","h11","h12","h13","h14","h15"],"descriptions":["d1","d2","d3","d4"],"path1":"p1","path2":"p2"}]
  }],
  "industryNegatives":["neg1"],
  "sitelinks":[{"text":"x","description1":"x","description2":"x","finalUrl":"https://..."}],
  "callouts":["x"],
  "structuredSnippet":{"header":"Services","values":["v1"]}
}`,
        16000
      );

      // Normalise
      r.adGroups.forEach(ag => {
        ag.keywords = (ag.keywords || [])
          .map(k => {
            if (typeof k === 'string') {
              if (k.startsWith('[') && k.endsWith(']')) return { text: k.slice(1, -1).toLowerCase().trim(), matchType: 'Exact' };
              if (k.startsWith('"') && k.endsWith('"')) return { text: k.slice(1, -1).toLowerCase().trim(), matchType: 'Phrase' };
              return { text: k.toLowerCase().trim(), matchType: 'Exact' };
            }
            return { text: (k.text || '').toLowerCase().trim(), matchType: k.matchType === 'Phrase' ? 'Phrase' : 'Exact' };
          })
          .filter(k => k.text.length > 0);

        const minCpc = curr === 'ZAR' ? 8.0 : 1.0;
        ag.defaultCpc = Math.max(parseFloat(ag.defaultCpc) || minCpc, minCpc);

        ag.ads.forEach(ad => {
          ad.headlines = (ad.headlines || []).slice(0, 15).map(h => String(h).substring(0, 30));
          while (ad.headlines.length < 15) ad.headlines.push('');
          ad.descriptions = (ad.descriptions || []).slice(0, 4).map(d => String(d).substring(0, 90));
          while (ad.descriptions.length < 4) ad.descriptions.push('');
          ad.path1 = (ad.path1 || '').replace(/\s+/g, '').substring(0, 15);
          ad.path2 = (ad.path2 || '').replace(/\s+/g, '').substring(0, 15);
        });
      });

      // Filter standard negatives from keywords
      const negSet = new Set(STD_NEGS.map(n => n.toLowerCase()));
      r.adGroups.forEach(ag => {
        ag.keywords = ag.keywords.filter(k => !negSet.has(k.text));
      });

      setGen({
        adGroups: r.adGroups,
        negatives: [...new Set([...STD_NEGS, ...(r.industryNegatives || [])])],
        sitelinks: (r.sitelinks || []).map(sl => ({
          text: (sl.text || '').substring(0, 25),
          description1: (sl.description1 || '').substring(0, 35),
          description2: (sl.description2 || '').substring(0, 35),
          finalUrl: sl.finalUrl || brief.website || '',
        })),
        callouts: (r.callouts || []).map(c => String(c).substring(0, 25)),
        structuredSnippet: r.structuredSnippet || { header: 'Services', values: [] },
      });

      setExpAgs({});
      setActiveSheet('campaign');
      setState('results');
    } catch (e) {
      console.error(e);
      setState('steer');
      setError('Generation failed: ' + e.message);
    }
  }

  // ── REGEN SINGLE AD GROUP ──
  async function regenAg(agi) {
    const ag = gen.adGroups[agi];
    const curr = brief.currencySymbol === 'R' ? 'ZAR' : brief.currencySymbol === '$' ? 'USD' : brief.currencySymbol === '£' ? 'GBP' : 'EUR';
    const minCpc = curr === 'ZAR' ? 8.0 : 1.0;

    try {
      const r = await callAI(
        `Regenerate a single Google Ads ad group. ONLY VALID JSON.
Business: ${brief.businessName} (${brief.website})
Service: ${ag.name}
Campaign angle: ${campaignAngle || 'direct response'}
Currency: ${curr}
- 12-15 transactional keywords, 70% exact, 30% phrase
- defaultCpc min ${minCpc}
- 1 RSA: 15 headlines (≤30), 4 descriptions (≤90), path1/path2
{"defaultCpc":${minCpc},"keywords":[{"text":"kw","matchType":"Exact"}],"ads":[{"headlines":["h1"...],"descriptions":["d1"...],"path1":"x","path2":"y"}]}`,
        3000
      );

      r.ads.forEach(ad => {
        ad.headlines = (ad.headlines || []).slice(0, 15).map(h => String(h).substring(0, 30));
        while (ad.headlines.length < 15) ad.headlines.push('');
        ad.descriptions = (ad.descriptions || []).slice(0, 4).map(d => String(d).substring(0, 90));
        while (ad.descriptions.length < 4) ad.descriptions.push('');
        ad.path1 = (ad.path1 || '').replace(/\s+/g, '').substring(0, 15);
        ad.path2 = (ad.path2 || '').replace(/\s+/g, '').substring(0, 15);
      });

      const keywords = (r.keywords || [])
        .map(k => {
          if (typeof k === 'string') return { text: k.toLowerCase().trim(), matchType: 'Exact' };
          return { text: (k.text || '').toLowerCase().trim(), matchType: k.matchType === 'Phrase' ? 'Phrase' : 'Exact' };
        })
        .filter(k => k.text.length > 0);

      const negSet = new Set(STD_NEGS.map(n => n.toLowerCase()));
      const ng = { ...gen, adGroups: [...gen.adGroups] };
      ng.adGroups[agi] = {
        ...ag,
        defaultCpc: Math.max(parseFloat(r.defaultCpc) || minCpc, minCpc),
        keywords: keywords.filter(k => !negSet.has(k.text)),
        ads: r.ads,
      };
      setGen(ng);
    } catch (e) {
      setError('Regen error: ' + e.message);
    }
  }

  return (
    <div>
      <Header step={STEP_MAP[state]} />

      {state === 'brief' && (
        <BriefStep brief={brief} up={up} onScan={scanWebsite} error={error} setError={setError} />
      )}

      {state === 'scanning' && <ScanStep website={brief.website} />}

      {state === 'steer' && scanResult && (
        <SteerStep
          brief={brief}
          up={up}
          scanResult={scanResult}
          selectedSvcs={selectedSvcs}
          toggleSvc={toggleSvc}
          customSvcs={customSvcs}
          setCustomSvcs={setCustomSvcs}
          campaignAngle={campaignAngle}
          setCampaignAngle={setCampaignAngle}
          excludeNote={excludeNote}
          setExcludeNote={setExcludeNote}
          stagingWarning={stagingWarning}
          onGenerate={generate}
          onBack={() => { setState('brief'); setScanResult(null); }}
          error={error}
          setError={setError}
        />
      )}

      {state === 'loading' && <LoadingStep message={loadingMsg} />}

      {state === 'results' && gen && (
        <ResultsStep
          gen={gen}
          setGen={setGen}
          brief={brief}
          campaignAngle={campaignAngle}
          activeSheet={activeSheet}
          setActiveSheet={setActiveSheet}
          onBack={() => setState('steer')}
          onRegenAll={generate}
          onRegenAg={regenAg}
          expAgs={expAgs}
          setExpAgs={setExpAgs}
          error={error}
          setError={setError}
        />
      )}
    </div>
  );
}
