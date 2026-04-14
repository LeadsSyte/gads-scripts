const {useState,useMemo,useRef}=React;

// ── Constants ─────────────────────────────────────────────────────────────────
const MODEL='claude-sonnet-4-20250514';
const HEALTH_GOOD=80;
const HEALTH_OK=60;
const BUDGET_MIN=100;
const BUDGET_MAX=50000;

const STD_NEGS=['what is','how to','define','definition','meaning','free','cheap','budget','diy','tutorial','guide','wiki','wikipedia','reddit','forum','blog','example','examples','jobs','careers','salary','volunteer','course','class','learn','study','history of','documentary','video','youtube','images','pictures','photos','recipe','recipes','restaurant','near me','vs','versus','compare','review','reviews','complaint','scam','fake','pdf','download','template','internship','vacancy','vacancies','training','certification'];
const INDUSTRY_NEGS={
  'vehicle wrap':['how to wrap','diy wrap','wrap removal','self wrap','peel off','vinyl removal','wrap yourself','wrap tutorial','wrap at home'],
  'fleet':['fleet management software','fleet tracking software','gps fleet tracking','fuel management software','fleet insurance','fleet telematics'],
  'signage':['diy sign','make your own sign','homemade sign','neon sign kit','sign plans','sign lighting','sign making','how to make a sign'],
  'printing':['diy print','home printing','print at home','inkjet','toner','printer cartridge','home printer','3d print'],
  'plumbing':['diy plumbing','how to fix','plumbing tutorial','plumbing parts','plumbing supplies','plumbing tools','how to unclog','how to repair'],
  'electrical':['diy electrical','how to wire','electrical tutorial','electrical parts','electrical supplies','wire yourself','diy electrician'],
  'cleaning':['diy cleaning','cleaning tips','how to clean','cleaning hacks','home cleaning tips','cleaning solution recipe','make your own cleaner'],
  'landscaping':['diy landscaping','diy garden','how to landscape','garden tips','lawn care tips','diy lawn','plant care','how to grow'],
  'roofing':['diy roofing','how to roof','roofing tutorial','roofing materials','roofing supplies','roofing nails','how to shingle'],
  'painting':['diy painting','how to paint','painting tutorial','painting tips','paint calculator','how to prep','paint supplies'],
  'flooring':['diy flooring','how to install flooring','flooring tutorial','flooring supplies','flooring materials','laminate install','tile install'],
  'moving':['diy moving','how to move','moving tips','moving checklist','packing tips','how to pack','free moving boxes'],
  'storage':['diy storage','how to store','storage tips','storage hacks','storage ideas','free storage','cheap storage'],
  'photography':['diy photography','how to photograph','photography tips','photography tutorial','free photo editing','lightroom tutorial'],
  'web design':['diy website','how to build a website','website builder','wix','squarespace','wordpress tutorial','free website'],
  'seo':['diy seo','free seo','seo tips','seo tutorial','how to rank','google ranking tips','free keyword research'],
  'accounting':['diy accounting','free accounting software','quickbooks tutorial','xero tutorial','how to do bookkeeping','accounting tips'],
  'legal':['diy legal','free legal advice','legal templates','legal forms','how to file','diy contract','legal tips'],
};
function getIndustryNegs(industry){
  const key=Object.keys(INDUSTRY_NEGS).find(k=>(industry||'').toLowerCase().includes(k));
  return key?INDUSTRY_NEGS[key]:[];
}
function getLangNote(locationCode){
  if(locationCode===2840) return 'Use American English spelling (e.g. "Inquire" not "Enquire", "Color" not "Colour", "Tire" not "Tyre", "License" not "Licence").';
  if(locationCode===2276) return 'Write in German. Use formal Sie form unless the brand is clearly casual/startup. German grammar and punctuation rules apply.';
  return 'Use British/Commonwealth English spelling (e.g. "Enquire" not "Inquire", "Colour" not "Color", "Tyre" not "Tire").';
}
function getMajorCities(locationCode,locations){
  const cityMap={
    2710:'Johannesburg, Cape Town, Durban, Pretoria, Gauteng',
    1007295:'Johannesburg and surrounds',
    1007296:'Cape Town and surrounds',
    1007298:'Durban and surrounds',
    1007297:'Pretoria and surrounds',
    2840:'New York, Los Angeles, Chicago, Houston, Phoenix',
    2826:'London, Manchester, Birmingham, Leeds, Glasgow',
    2036:'Sydney, Melbourne, Brisbane, Perth, Adelaide',
    2124:'Toronto, Vancouver, Montreal, Calgary, Ottawa',
    2276:'Berlin, Hamburg, Munich, Frankfurt, Cologne',
    2356:'Mumbai, Delhi, Bangalore, Chennai, Hyderabad',
    2554:'Auckland, Wellington, Christchurch',
    2250:'Paris, Lyon, Marseille, Toulouse, Bordeaux',
    2528:'Amsterdam, Rotterdam, The Hague, Utrecht',
    2784:'Dubai, Abu Dhabi, Sharjah',
    2702:'Singapore',
    2404:'Nairobi, Mombasa',
    2566:'Lagos, Abuja, Port Harcourt',
  };
  const base=cityMap[locationCode]||'';
  const COUNTRY_NAMES=['south africa','united states','united kingdom','australia','canada','germany','france','netherlands','india','new zealand','ireland','kenya','nigeria','zimbabwe','botswana','namibia','ghana','tanzania','united arab emirates','singapore'];
  const targeted=(locations||[]).filter(l=>l.type==='named'&&l.mode==='include'&&l.name).map(l=>l.name).filter(n=>!COUNTRY_NAMES.includes(n.toLowerCase()));
  const extra=targeted.length?`. Specifically targeted: ${[...new Set(targeted)].join(', ')}`:'' ;
  return (base||'major cities in the target region')+extra;
}
function getBusinessTypeContext(businessType){
  if(businessType==='ecommerce') return `\nBUSINESS TYPE: ECOMMERCE — Goal is online product purchases and sales.\nPrimary conversion: Purchase / Add to Cart / Checkout completion.\nCTAs to use: "Shop Now", "Buy Online", "Order Today", "Free Delivery", "View Range", "Save X%"\nInclude pricing in copy where possible (e.g. "From R299", "Free Delivery Over R500", "Save 20%").\nTrust signals to use: "Free Returns", "Fast Delivery", "Secure Checkout", star ratings.\nIMPORTANT: Performance Max works best for ecommerce when connected to a Google Merchant Center product feed.\nWRONG copy for ecommerce (do not write): "Get a Free Quote", "Book a Consultation", "Enquire Now", "No Obligation", "Free Consultation", "Request a Callback" — these signal service enquiries, not product purchases.\nRIGHT copy for ecommerce: "Shop Now", "Order Today", "In Stock — Ships Fast", "Free Returns", "Save 20% Today".\n`;
  if(businessType==='hybrid') return `\nBUSINESS TYPE: HYBRID — This business has BOTH service/lead gen offerings AND ecommerce products.\nFor SERVICE ad groups: use lead gen CTAs ("Get a Free Quote", "Book a Consultation", "Enquire Now"). WRONG for services: "Buy Now", "Add to Cart", "Shop Our Range".\nFor PRODUCT ad groups: use ecommerce CTAs ("Shop Now", "Buy Online", "Order Today", "Free Delivery"). WRONG for products: "Get a Quote", "Book a Consult", "Enquire Now".\nDistinguish clearly in copy between service and product ad groups. Do not mix CTA types within the same ad.\n`;
  return `\nBUSINESS TYPE: LEAD GENERATION — Goal is capturing enquiries, form submissions, and phone calls — NOT online purchases.\nPrimary conversion: Contact form submission / Phone call / Booking request.\nCTAs to use: "Get a Free Quote", "Book a Consultation", "Enquire Now", "Enquire Online", "Request a Callback".\nTrust signals to use: "No Obligation", "Free Quote", "Free Consultation", "Satisfaction Guaranteed", "Money-Back Guarantee".\nWRONG copy for lead gen (do not write): "Shop Now", "Buy Now", "Order Today", "Add to Cart", "Free Delivery", "In Stock", "Ships Today", "Purchase Online" — these signal ecommerce, not service enquiries.\nRIGHT copy for lead gen: "Get a Free Quote", "Book a Free Consult", "Enquire Online", "No Obligation", "Free Strategy Call".\n`;
}
function getMarketNote(locationCode){
  if(locationCode===2840) return 'Even in the large US market, hyper-specific long-tail combinations often have zero or near-zero volume at the local level.';
  if(locationCode===2826) return 'The UK market is smaller than the US. Hyper-specific keyword combinations often have zero volume outside London.';
  if(locationCode===2036) return 'Australia has a smaller market than the US/UK. Hyper-specific combinations often have zero volume outside Sydney/Melbourne.';
  return 'This is a regional market. Hyper-specific keyword combinations (service + modifier + location) often have zero or near-zero search volume.';
}
function getBrandVoiceContext(brief){
  const parts=[];
  if(brief.toneOfVoice) parts.push(`Brand Voice: ${brief.toneOfVoice}${brief.toneExamples&&brief.toneExamples.length?`. Mirror this tone in copy — examples from their site: "${brief.toneExamples.slice(0,2).join('" · "')}"`:'.'}`);
  const ts=brief.trustSignals||{};
  const proof=[];
  if(ts.rating&&ts.reviewCount) proof.push(`${ts.rating}★ from ${ts.reviewCount} reviews${ts.reviewPlatform?' on '+ts.reviewPlatform:''}`);
  else if(ts.rating) proof.push(`Rated ${ts.rating}★`);
  if(ts.yearsInBusiness) proof.push(`${ts.yearsInBusiness} years in business`);
  if(ts.clientCount) proof.push(`${ts.clientCount} clients`);
  if(ts.certifications&&ts.certifications.length) proof.push(ts.certifications.slice(0,2).join(', '));
  if(proof.length) parts.push(`Verified Social Proof (use these EXACT figures in Social Proof headline slot — do not generalise): ${proof.join(' · ')}`);
  if(ts.guarantees&&ts.guarantees.length) parts.push(`Website Guarantees (use verbatim in Risk Removal headline/description slots): ${ts.guarantees.slice(0,3).join(' · ')}`);
  if(brief.primaryCTA) parts.push(`Site's Primary CTA (adapt for CTA headline slot): "${brief.primaryCTA}"`);
  if(brief.painPoints&&brief.painPoints.length) parts.push(`Customer Pain Points from website (use in Pain Recognition headline / D1 description): ${brief.painPoints.slice(0,3).join(' · ')}`);
  if(brief.pricingInfo) parts.push(`Pricing (include if it is a competitive advantage): ${brief.pricingInfo}`);
  return parts.length?`\nBRAND SIGNALS (confirmed from website — use these for accuracy, not generic placeholders):\n${parts.join('\n')}\n`:'';
}
function getCopyQualityRules(brief){
  const ts=brief.trustSignals||{};
  const parts=[];
  const slots=[];
  if(ts.rating&&ts.reviewCount) slots.push(`Social Proof slot → write as "${ts.rating}★ · ${ts.reviewCount}${ts.reviewPlatform?' '+ts.reviewPlatform:''} Reviews" — NOT "Highly Rated" or "Top Reviewed"`);
  else if(ts.rating) slots.push(`Social Proof slot → write as "Rated ${ts.rating}★" + a second trust signal — NOT "Highly Rated"`);
  if(ts.yearsInBusiness) slots.push(`Years-in-business → "${ts.yearsInBusiness} Years Experience" or similar — use in Social Proof or USP slot`);
  if(ts.clientCount) slots.push(`Volume proof → "${ts.clientCount} Clients Served" or similar — use in Social Proof slot`);
  if(ts.guarantees&&ts.guarantees.filter(Boolean).length) slots.push(`Risk Removal slot → adapt from their guarantee: "${ts.guarantees.filter(Boolean)[0]}" — NOT generic "No Commitment"`);
  if(ts.certifications&&ts.certifications.filter(Boolean).length) slots.push(`Credentials available: ${ts.certifications.filter(Boolean).slice(0,2).join(', ')} — use in Social Proof or USP slot`);
  if(slots.length) parts.push(`SLOT ASSIGNMENTS — use confirmed brand data, not generic placeholders:\n${slots.map(s=>'  - '+s).join('\n')}`);
  parts.push(`VALUE PROP & USP TECHNIQUES — pick a DIFFERENT technique for H2 (Value Prop) vs H3/USP slot:
  - Outcome flip: lead with the result the customer gets ("More Leads, Less Spend" / "Brands That Get Noticed")
  - Specificity boost: exact number, timeframe, or metric ("48-Hr Turnaround Guaranteed" / "500+ Fleets Branded")
  - Customer voice: their inner monologue ("Finally, Wraps That Last" / "Work That Gets Noticed")
  - Contrast frame: compare to the worse alternative ("Agency Results, No Agency Fees" / "Premium Quality, Half Price")`);
  const lp=brief.landingPage||brief.website;
  parts.push(`LANDING PAGE MATCH: D1 must contain the core service keyword${lp?' and align with the landing page ('+lp+')':''} — Google bolds description text that matches the search query, increasing visual prominence and CTR.`);
  parts.push(`SPECIFICITY CHECK (required before returning JSON): Review every headline. Replace any that could be written by ANY competitor in this industry — "Professional Service", "Quality Work", "Fast Response", "Experienced Team", "Expert Solutions", "Call Us Today", "Our Services" — with a headline containing a concrete number, named feature, specific outcome, or proper noun from THIS business.`);
  return`\nCOPY QUALITY RULES:\n${parts.join('\n')}\n`;
}
const STAGING_DOMAINS=['lovable.app','lovable.dev','webflow.io','framer.app','framer.site','bubble.io','glide.page','typedream.app','super.so','notion.site','carrd.co','squarespace.com/preview','myshopify.com','netlify.app','vercel.app','github.io','pages.dev','render.com'];
const BUDGET_SPLITS={branded:0.15,targetedSearch:0.55,pmax:0.25,demandGen:0.2,searchRemarketing:0.15,displayRemarketing:0.1};

const CAMPAIGN_TYPES=[
  {key:'branded',label:'Branded Search',icon:'⭐',color:'#1a4b8c',budgetTag:'budget-core',budgetLabel:'Core',desc:'Protect your brand name.',budgetNote:'Always recommended.',always:true},
  {key:'targetedSearch',label:'Targeted Search',icon:'🎯',color:'#b45309',budgetTag:'budget-core',budgetLabel:'Core',desc:'One ad group per service. Captures in-market buyers.',budgetNote:'Always recommended. Main performance driver.',always:true},
  {key:'pmax',label:'Performance Max',icon:'🚀',color:'#6d28d9',budgetTag:'budget-recommended',budgetLabel:'Recommended',desc:'No product feed. Google optimises across all placements.',budgetNote:'Recommended for R500+/day.',always:false},
  {key:'demandGen',label:'Demand Gen',icon:'📺',color:'#0e7490',budgetTag:'budget-optional',budgetLabel:'Optional',desc:'YouTube, Discover & Gmail. Upper-funnel awareness.',budgetNote:'Best for brands with visual assets and R800+/day.',always:false},
  {key:'searchRemarketing',label:'Search Remarketing (RLSA)',icon:'🔁',color:'#be123c',budgetTag:'budget-recommended',budgetLabel:'Recommended',desc:'Re-engage past website visitors on Google Search.',budgetNote:'Needs 1,000+ monthly visitors.',always:false},
  {key:'displayRemarketing',label:'Display Remarketing',icon:'🖼️',color:'#047857',budgetTag:'budget-optional',budgetLabel:'Optional',desc:'GDN banner ads to past visitors.',budgetNote:'Low CPM, great for re-engagement.',always:false},
];

const INIT={businessName:'',businessType:'leadGen',website:'',landingPage:'',description:'',targetCustomer:'',industry:'',usps:'',toneOfVoice:'',toneExamples:[],trustSignals:{rating:'',reviewCount:'',reviewPlatform:'',yearsInBusiness:'',clientCount:'',certifications:[],guarantees:[]},primaryCTA:'',painPoints:[],pricingInfo:'',dailyBudget:333,currencySymbol:'R',bidStrategy:'Maximize conversions',language:'en',locations:[{id:'def1',type:'named',name:'South Africa',mode:'include'}],locationCode:2710,nameBranded:'',nameTargetedSearch:'',namePmax:'',nameDemandGen:'',nameSearchRemarketing:'',nameDisplayRemarketing:''};

const LOCATION_OPTIONS=[
  {v:2710,l:'South Africa',g:'Africa'},
  {v:1007295,l:'SA · Johannesburg',g:'Africa'},
  {v:1007296,l:'SA · Cape Town',g:'Africa'},
  {v:1007298,l:'SA · Durban',g:'Africa'},
  {v:1007297,l:'SA · Pretoria',g:'Africa'},
  {v:2404,l:'Kenya',g:'Africa'},
  {v:2566,l:'Nigeria',g:'Africa'},
  {v:2716,l:'Zimbabwe',g:'Africa'},
  {v:2072,l:'Botswana',g:'Africa'},
  {v:2516,l:'Namibia',g:'Africa'},
  {v:2288,l:'Ghana',g:'Africa'},
  {v:2834,l:'Tanzania',g:'Africa'},
  {v:2840,l:'United States',g:'Anglosphere'},
  {v:2826,l:'United Kingdom',g:'Anglosphere'},
  {v:2036,l:'Australia',g:'Anglosphere'},
  {v:2124,l:'Canada',g:'Anglosphere'},
  {v:2554,l:'New Zealand',g:'Anglosphere'},
  {v:2372,l:'Ireland',g:'Anglosphere'},
  {v:2276,l:'Germany',g:'Europe'},
  {v:2250,l:'France',g:'Europe'},
  {v:2528,l:'Netherlands',g:'Europe'},
  {v:2356,l:'India',g:'Asia & Middle East'},
  {v:2784,l:'United Arab Emirates',g:'Asia & Middle East'},
  {v:2702,l:'Singapore',g:'Asia & Middle East'},
];

function isStagingUrl(url){try{const h=new URL(url.startsWith('http')?url:'https://'+url).hostname.toLowerCase();return STAGING_DOMAINS.some(d=>h.endsWith(d));}catch{return false;}}
function scoreAdStrength(headlines,descriptions,businessType){
  const issues=[];
  const validH=headlines.filter(h=>h&&h.trim());
  const validD=descriptions.filter(d=>d&&d.trim());
  const allCopy=[...validH,...validD].map(s=>s.toLowerCase());
  const firstWords=validH.map(h=>h.trim().split(/\s+/)[0].toLowerCase());
  const wc={};firstWords.forEach(w=>{wc[w]=(wc[w]||0)+1;});
  Object.entries(wc).forEach(([w,c])=>{if(c>1)issues.push(`"${w[0].toUpperCase()+w.slice(1)}" starts ${c} headlines — Google penalizes duplicate first words`);});
  const weakPhrases=['contact us','click here','submit','visit our','call us today','click now','our products','our services'];
  validH.forEach(h=>{if(weakPhrases.some(p=>h.toLowerCase().includes(p)))issues.push(`"${h}" — replace with a specific benefit or outcome`);});
  validH.forEach(h=>{if(h.trim().length<20)issues.push(`"${h}" is ${h.trim().length} chars — under 20 chars wastes space (aim for 25-30)`);});
  validD.forEach(d=>{validH.forEach(h=>{if(h.length>15&&d.toLowerCase().includes(h.toLowerCase()))issues.push(`Description repeats headline "${h}" — descriptions should expand, not repeat`);});});
  if(validH.length>2&&!validH.some(h=>/\d/.test(h)))issues.push('No headlines contain numbers — add specific stats, years in business, or client counts');
  if(businessType==='leadGen'){
    const ecPhrases=['shop now','buy now','order now','add to cart','checkout','shop our','buy online','order today','shop the','purchase','in stock','ships today','free delivery','free shipping','free returns','easy returns'];
    const found=ecPhrases.filter(p=>allCopy.some(c=>c.includes(p)));
    if(found.length) issues.push(`Ecommerce language in a lead gen campaign — "${found[0]}" signals product purchase, not an enquiry. Replace with "Get a Free Quote", "Book a Consult", or "Enquire Now".`);
  }
  if(businessType==='ecommerce'){
    const lgPhrases=['get a free quote','free quote','book a consult','enquire now','enquire online','no obligation','free consultation','request a callback','book a call','schedule a call','get a quote'];
    const found=lgPhrases.filter(p=>allCopy.some(c=>c.includes(p)));
    if(found.length) issues.push(`Lead gen language in an ecommerce campaign — "${found[0]}" signals a service enquiry, not a purchase. Replace with "Shop Now", "Order Today", or "Free Delivery".`);
  }
  const score=Math.max(0,100-issues.length*15);
  const label=score>=85?'Strong':score>=65?'Good':score>=40?'Fair':'Weak';
  const color=score>=85?'#166534':score>=65?'#0369a1':score>=40?'#854d0e':'#991b1b';
  const bg=score>=85?'#dcfce7':score>=65?'#e0f2fe':score>=40?'#fef9c3':'#fef2f2';
  const border=score>=85?'#bbf7d0':score>=65?'#bae6fd':score>=40?'#fde68a':'#fca5a5';
  return{score,label,issues,color,bg,border};
}
function BrandSignalsPanel({brief,up,upTs,expandedSections,toggleSection}){
  const ts=brief.trustSignals||{};
  const hasSignals=!!(brief.toneOfVoice||brief.primaryCTA||(brief.painPoints&&brief.painPoints.length>0)||(ts.rating||ts.yearsInBusiness||ts.clientCount||(ts.guarantees&&ts.guarantees.length>0)));
  const signalCount=[brief.toneOfVoice,brief.primaryCTA,(ts.rating&&ts.reviewCount)||ts.rating,ts.yearsInBusiness,ts.clientCount,(ts.certifications||[]).length>0?'cert':null,(ts.guarantees||[]).length>0?'guar':null,(brief.painPoints||[]).length>0?'pain':null].filter(Boolean).length;
  const isOpen=expandedSections.brandSignals==null?hasSignals:!!expandedSections.brandSignals;
  const iSt={width:'100%',padding:'8px 10px',borderRadius:7,border:'1px solid #e0e5ec',fontSize:13,fontFamily:'DM Sans,sans-serif',outline:'none'};
  const lSt={fontSize:11,fontWeight:700,color:'#5a6a7a',textTransform:'uppercase',letterSpacing:'0.4px',marginBottom:4,display:'block'};
  return(
    <div style={{background:'#fff',border:`1px solid ${hasSignals?'#bbf7d0':'#e5e8ee'}`,borderRadius:12,marginBottom:20,overflow:'hidden'}}>
      <div onClick={()=>toggleSection('brandSignals')} style={{padding:'14px 20px',display:'flex',alignItems:'center',justifyContent:'space-between',cursor:'pointer',background:hasSignals?'#f0fdf4':'#f8f9fc'}}>
        <div>
          <div style={{display:'flex',alignItems:'center',gap:8}}>
            <span style={{fontWeight:700,fontSize:14,color:'#1a2a3a'}}>🎯 Brand Signals</span>
            {hasSignals?<span style={{fontSize:11,fontWeight:700,padding:'2px 8px',borderRadius:10,background:'#dcfce7',color:'#166534'}}>✓ {signalCount} detected</span>:<span style={{fontSize:11,color:'#9aa5b0'}}>None detected — add manually</span>}
          </div>
          <div style={{fontSize:12,color:'#7a8a9a',marginTop:2}}>Tone, social proof, guarantees, CTAs and pain points — used in every headline slot</div>
        </div>
        <span style={{color:'#9aa5b0',fontSize:13,fontWeight:700}}>{isOpen?'▲':'▼'}</span>
      </div>
      {isOpen&&(
        <div style={{padding:20,borderTop:'1px solid #f0f2f5'}}>
          <div style={{display:'grid',gap:16}}>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
              <div><label style={lSt}>Brand Voice / Tone</label><input style={iSt} value={brief.toneOfVoice||''} onChange={e=>up('toneOfVoice',e.target.value)} placeholder="e.g. professional and results-focused"/></div>
              <div><label style={lSt}>Primary CTA (from website)</label><input style={iSt} value={brief.primaryCTA||''} onChange={e=>up('primaryCTA',e.target.value)} placeholder="e.g. Get a Free Quote"/></div>
            </div>
            <div style={{borderTop:'1px solid #f5f5f5',paddingTop:14}}>
              <div style={{fontSize:12,fontWeight:700,color:'#3a4a5a',marginBottom:10}}>Social Proof</div>
              <div style={{display:'grid',gridTemplateColumns:'80px 1fr 1fr',gap:10,marginBottom:10}}>
                <div><label style={lSt}>Rating</label><input style={iSt} value={ts.rating||''} onChange={e=>upTs('rating',e.target.value)} placeholder="4.8"/></div>
                <div><label style={lSt}>Review Count</label><input style={iSt} value={ts.reviewCount||''} onChange={e=>upTs('reviewCount',e.target.value)} placeholder="200+"/></div>
                <div><label style={lSt}>Platform</label><input style={iSt} value={ts.reviewPlatform||''} onChange={e=>upTs('reviewPlatform',e.target.value)} placeholder="Google"/></div>
              </div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
                <div><label style={lSt}>Years in Business</label><input style={iSt} value={ts.yearsInBusiness||''} onChange={e=>upTs('yearsInBusiness',e.target.value)} placeholder="12"/></div>
                <div><label style={lSt}>Clients Served</label><input style={iSt} value={ts.clientCount||''} onChange={e=>upTs('clientCount',e.target.value)} placeholder="500+"/></div>
              </div>
            </div>
            <div style={{borderTop:'1px solid #f5f5f5',paddingTop:14}}>
              <div style={{fontSize:12,fontWeight:700,color:'#3a4a5a',marginBottom:10}}>Copy Signals</div>
              <div style={{display:'grid',gap:10}}>
                <div><label style={lSt}>Guarantees (comma-separated)</label><input style={iSt} value={(ts.guarantees||[]).join(', ')} onChange={e=>upTs('guarantees',e.target.value.split(',').map(s=>s.trim()).filter(Boolean))} placeholder="Satisfaction Guaranteed, Free quote, no obligation"/></div>
                <div><label style={lSt}>Certifications (comma-separated)</label><input style={iSt} value={(ts.certifications||[]).join(', ')} onChange={e=>upTs('certifications',e.target.value.split(',').map(s=>s.trim()).filter(Boolean))} placeholder="Google Premier Partner, ISO 9001"/></div>
                <div><label style={lSt}>Customer Pain Points (comma-separated)</label><input style={iSt} value={(brief.painPoints||[]).join(', ')} onChange={e=>up('painPoints',e.target.value.split(',').map(s=>s.trim()).filter(Boolean))} placeholder="Inconsistent brand across vehicles, Unreliable wrap quality"/></div>
                <div><label style={lSt}>Pricing Info</label><input style={iSt} value={brief.pricingInfo||''} onChange={e=>up('pricingInfo',e.target.value)} placeholder="From R2,500 per vehicle"/></div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
function LocationTargeting({locations,onChange}){
  const [adding,setAdding]=React.useState(null);
  const [placeInput,setPlaceInput]=React.useState('');
  const [radiusQuery,setRadiusQuery]=React.useState('');
  const [radiusResults,setRadiusResults]=React.useState([]);
  const [radiusSelected,setRadiusSelected]=React.useState(null);
  const [radiusVal,setRadiusVal]=React.useState(30);
  const [radiusUnit,setRadiusUnit]=React.useState('km');
  const [geocoding,setGeocoding]=React.useState(false);
  const [geoErr,setGeoErr]=React.useState('');
  const locs=locations||[];

  function addPlace(){
    if(!placeInput.trim()) return;
    onChange([...locs,{id:Date.now()+'',type:'named',name:placeInput.trim(),mode:'include'}]);
    setPlaceInput('');setAdding(null);
  }
  async function geocode(){
    if(!radiusQuery.trim()) return;
    setGeocoding(true);setGeoErr('');setRadiusResults([]);
    try{
      const res=await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(radiusQuery)}&format=json&limit=5&addressdetails=1`);
      if(!res.ok) throw new Error('Request failed');
      const data=await res.json();
      if(!data.length) setGeoErr('No results — try a more specific address.');
      setRadiusResults(data);
    }catch{setGeoErr('Geocoding failed — check your connection.');}
    finally{setGeocoding(false);}
  }
  function confirmRadius(){
    if(!radiusSelected) return;
    const label=radiusSelected.display_name.split(',').slice(0,2).join(',').trim();
    onChange([...locs,{id:Date.now()+'',type:'radius',label,lat:parseFloat(radiusSelected.lat),lng:parseFloat(radiusSelected.lon),radius:parseInt(radiusVal)||30,unit:radiusUnit,mode:'include'}]);
    setRadiusQuery('');setRadiusResults([]);setRadiusSelected(null);setRadiusVal(30);setRadiusUnit('km');setAdding(null);
  }
  function remove(id){onChange(locs.filter(l=>l.id!==id));}
  function toggleMode(id){onChange(locs.map(l=>l.id===id?{...l,mode:l.mode==='include'?'exclude':'include'}:l));}

  const iSt={padding:'8px 12px',border:'1px solid #e0e5ec',borderRadius:7,fontSize:13,outline:'none',background:'#fff',width:'100%'};
  return(
    <div style={{marginBottom:14}}>
      <label style={{display:'block',fontWeight:600,fontSize:13,color:'#3a4a5a',marginBottom:8}}>Location Targeting</label>
      {locs.length>0&&(
        <div style={{display:'grid',gap:6,marginBottom:10}}>
          {locs.map(loc=>(
            <div key={loc.id} style={{display:'flex',alignItems:'center',gap:8,padding:'8px 12px',borderRadius:8,background:loc.mode==='exclude'?'#fef2f2':'#f0fdf4',border:`1px solid ${loc.mode==='exclude'?'#fca5a5':'#bbf7d0'}`}}>
              <span style={{fontSize:14}}>{loc.type==='radius'?'🎯':'📍'}</span>
              <span style={{flex:1,fontSize:13,fontWeight:500,color:'#1a2a3a'}}>{loc.type==='radius'?`${loc.radius}${loc.unit} · ${loc.label}`:loc.name}</span>
              <span onClick={()=>toggleMode(loc.id)} style={{fontSize:10,fontWeight:700,padding:'2px 8px',borderRadius:10,cursor:'pointer',background:loc.mode==='include'?'#dcfce7':'#fee2e2',color:loc.mode==='include'?'#166534':'#991b1b',border:`1px solid ${loc.mode==='include'?'#bbf7d0':'#fca5a5'}`}}>{loc.mode==='include'?'✓ Include':'✕ Exclude'}</span>
              <span onClick={()=>remove(loc.id)} style={{fontSize:16,color:'#9aa5b0',cursor:'pointer',lineHeight:1,padding:'0 2px'}}>×</span>
            </div>
          ))}
        </div>
      )}
      {!adding&&(
        <div style={{display:'flex',gap:8}}>
          <button onClick={()=>setAdding('place')} style={{padding:'7px 14px',borderRadius:7,border:'1px dashed #d0d5dd',background:'#f8f9fc',fontSize:12,fontWeight:600,color:'#5a6a7a',cursor:'pointer'}}>+ Add Place</button>
          <button onClick={()=>setAdding('radius')} style={{padding:'7px 14px',borderRadius:7,border:'1px dashed #d0d5dd',background:'#f8f9fc',fontSize:12,fontWeight:600,color:'#5a6a7a',cursor:'pointer'}}>🎯 Add Radius</button>
        </div>
      )}
      {adding==='place'&&(
        <div style={{padding:14,background:'#f8f9fc',borderRadius:8,border:'1px solid #e5e8ee',marginTop:8}}>
          <div style={{fontSize:12,fontWeight:700,color:'#3a4a5a',marginBottom:6}}>📍 Add Place</div>
          <div style={{fontSize:11,color:'#7a8a9a',marginBottom:8}}>Country, region, city, suburb or ZIP — Google Ads accepts any valid location name.</div>
          <div style={{display:'flex',gap:8}}>
            <input style={iSt} value={placeInput} onChange={e=>setPlaceInput(e.target.value)} onKeyDown={e=>e.key==='Enter'&&addPlace()} placeholder="e.g. Cape Town, Gauteng, 8001…"/>
            <button onClick={addPlace} disabled={!placeInput.trim()} style={{padding:'8px 16px',borderRadius:7,border:'none',background:placeInput.trim()?'#e67e22':'#e0e5ec',color:placeInput.trim()?'#fff':'#9aa5b0',fontSize:13,fontWeight:700,cursor:placeInput.trim()?'pointer':'not-allowed',whiteSpace:'nowrap'}}>Add</button>
            <button onClick={()=>{setAdding(null);setPlaceInput('');}} style={{padding:'8px 12px',borderRadius:7,border:'1px solid #e0e5ec',background:'#fff',fontSize:13,cursor:'pointer',color:'#5a6a7a'}}>Cancel</button>
          </div>
        </div>
      )}
      {adding==='radius'&&(
        <div style={{padding:14,background:'#f8f9fc',borderRadius:8,border:'1px solid #e5e8ee',marginTop:8}}>
          <div style={{fontSize:12,fontWeight:700,color:'#3a4a5a',marginBottom:6}}>🎯 Radius Target</div>
          {!radiusSelected?(
            <>
              <div style={{fontSize:11,color:'#7a8a9a',marginBottom:8}}>Search for the centre point — address, landmark, or suburb.</div>
              <div style={{display:'flex',gap:8,marginBottom:8}}>
                <input style={iSt} value={radiusQuery} onChange={e=>setRadiusQuery(e.target.value)} onKeyDown={e=>e.key==='Enter'&&geocode()} placeholder="e.g. Sandton City, Cape Town CBD…"/>
                <button onClick={geocode} disabled={geocoding||!radiusQuery.trim()} style={{padding:'8px 16px',borderRadius:7,border:'none',background:(geocoding||!radiusQuery.trim())?'#e0e5ec':'#1a4b8c',color:(geocoding||!radiusQuery.trim())?'#9aa5b0':'#fff',fontSize:13,fontWeight:700,cursor:(geocoding||!radiusQuery.trim())?'not-allowed':'pointer',whiteSpace:'nowrap'}}>{geocoding?'Searching…':'Find'}</button>
                <button onClick={()=>{setAdding(null);setRadiusQuery('');setRadiusResults([]);}} style={{padding:'8px 12px',borderRadius:7,border:'1px solid #e0e5ec',background:'#fff',fontSize:13,cursor:'pointer',color:'#5a6a7a'}}>Cancel</button>
              </div>
              {geoErr&&<div style={{fontSize:12,color:'#991b1b',marginBottom:8}}>{geoErr}</div>}
              {radiusResults.length>0&&(
                <div style={{border:'1px solid #e5e8ee',borderRadius:7,overflow:'hidden'}}>
                  {radiusResults.map((r,i)=>(
                    <div key={r.place_id} onClick={()=>setRadiusSelected(r)}
                      style={{padding:'8px 12px',fontSize:12,cursor:'pointer',background:'#fff',borderBottom:i<radiusResults.length-1?'1px solid #f0f2f5':'none'}}
                      onMouseEnter={e=>e.currentTarget.style.background='#f5f7ff'} onMouseLeave={e=>e.currentTarget.style.background='#fff'}>
                      <div style={{fontWeight:600,color:'#1a2a3a'}}>{r.display_name.split(',').slice(0,3).join(', ')}</div>
                      <div style={{fontSize:10,color:'#9aa5b0',marginTop:2}}>{parseFloat(r.lat).toFixed(4)}, {parseFloat(r.lon).toFixed(4)} · {r.type}</div>
                    </div>
                  ))}
                </div>
              )}
            </>
          ):(
            <>
              <div style={{padding:'8px 12px',borderRadius:7,background:'#f0fdf4',border:'1px solid #bbf7d0',fontSize:12,marginBottom:12}}>
                <div style={{fontWeight:700,color:'#166534'}}>📍 {radiusSelected.display_name.split(',').slice(0,2).join(',').trim()}</div>
                <div style={{color:'#5a6a7a',fontSize:10,marginTop:2}}>{parseFloat(radiusSelected.lat).toFixed(4)}, {parseFloat(radiusSelected.lon).toFixed(4)}</div>
              </div>
              <div style={{display:'flex',gap:8,alignItems:'flex-end',marginBottom:12}}>
                <div style={{flex:1}}>
                  <label style={{display:'block',fontSize:11,fontWeight:700,color:'#5a6a7a',marginBottom:4}}>RADIUS</label>
                  <input type="number" min="1" max="500" value={radiusVal} onChange={e=>setRadiusVal(e.target.value)} style={iSt}/>
                </div>
                <div style={{width:90}}>
                  <label style={{display:'block',fontSize:11,fontWeight:700,color:'#5a6a7a',marginBottom:4}}>UNIT</label>
                  <select value={radiusUnit} onChange={e=>setRadiusUnit(e.target.value)} style={{...iSt,padding:'8px 10px'}}>
                    <option value="km">km</option>
                    <option value="mi">miles</option>
                  </select>
                </div>
              </div>
              <div style={{display:'flex',gap:8}}>
                <button onClick={confirmRadius} style={{padding:'8px 18px',borderRadius:7,border:'none',background:'#e67e22',color:'#fff',fontSize:13,fontWeight:700,cursor:'pointer'}}>✓ Add {radiusVal}{radiusUnit} Radius</button>
                <button onClick={()=>{setRadiusSelected(null);setRadiusResults([]);}} style={{padding:'8px 12px',borderRadius:7,border:'1px solid #e0e5ec',background:'#fff',fontSize:12,cursor:'pointer',color:'#5a6a7a'}}>← Change</button>
                <button onClick={()=>{setAdding(null);setRadiusQuery('');setRadiusResults([]);setRadiusSelected(null);}} style={{padding:'8px 12px',borderRadius:7,border:'1px solid #e0e5ec',background:'#fff',fontSize:12,cursor:'pointer',color:'#5a6a7a'}}>Cancel</button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function App(){
  const [brief,setBrief]=useState(INIT);
  const [state,setState]=useState('brief');
  const [scanResult,setScanResult]=useState(null);
  const [selectedSvcs,setSelectedSvcs]=useState([]);
  const [customSvcs,setCustomSvcs]=useState('');
  const [campaignAngle,setCampaignAngle]=useState('');
  const [excludeNote,setExcludeNote]=useState('');
  const [stagingWarning,setStagingWarning]=useState(false);
  const [loadingMsg,setLoadingMsg]=useState('');
  const [loadingStep,setLoadingStep]=useState(0);
  const [gen,setGen]=useState(null);
  const [expAgs,setExpAgs]=useState({});
  const [error,setError]=useState(null);
  const [expandedSections,setExpandedSections]=useState({branded:true,targetedSearch:true,pmax:true,demandGen:true,searchRemarketing:true,displayRemarketing:true});
  const [selectedCampaignTypes,setSelectedCampaignTypes]=useState(['branded','targetedSearch']);
  const [transcript,setTranscript]=useState('');
  const [budgetOverrides,setBudgetOverrides]=useState({});
  const [copyAngle,setCopyAngle]=useState('standard');
  const [adCopyLoading,setAdCopyLoading]=useState({});
  const [expCopy,setExpCopy]=useState({});

  const up=(k,v)=>setBrief(p=>({...p,[k]:v}));
  const upTs=(k,v)=>setBrief(p=>({...p,trustSignals:{...(p.trustSignals||{}),[k]:v}}));
  const toggleSection=k=>setExpandedSections(p=>({...p,[k]:!p[k]}));
  const isGeneratingRef=useRef(false);
  const isScanningRef=useRef(false);

  function campName(key){
    const base=brief.businessName||'Campaign';
    const defaults={branded:`${base} | Branded Search`,targetedSearch:`${base} | Targeted Search`,pmax:`${base} | Performance Max`,demandGen:`${base} | Demand Gen`,searchRemarketing:`${base} | Search Remarketing RLSA`,displayRemarketing:`${base} | Display Remarketing`};
    const nameKey='name'+key.charAt(0).toUpperCase()+key.slice(1);
    return brief[nameKey]||defaults[key];
  }

  function getEffectiveBudget(key){
    if(budgetOverrides[key]!=null&&budgetOverrides[key]!==''){return Math.round(Number(budgetOverrides[key]));}
    const total=selectedCampaignTypes.reduce((s,k)=>s+(BUDGET_SPLITS[k]||0),0);
    return Math.round(brief.dailyBudget*(BUDGET_SPLITS[key]||0)/Math.max(total,1));
  }

  function toggleCampaignType(key){
    const ct=CAMPAIGN_TYPES.find(c=>c.key===key);
    if(ct&&ct.always) return;
    setSelectedCampaignTypes(prev=>prev.includes(key)?prev.filter(k=>k!==key):[...prev,key]);
  }

  async function callAI(prompt,maxTok=16000,search=false,_attempt=1){
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),search?90000:75000);
    try{
      const body={model:MODEL,max_tokens:maxTok,messages:[{role:'user',content:prompt}]};
      if(search) body.tools=[{type:'web_search_20250305',name:'web_search'}];
      const r=await fetch('/.netlify/functions/claude-proxy',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:controller.signal});
      if(!r.ok){const t=await r.text();throw new Error('API '+r.status+': '+t.substring(0,200));}
      const d=await r.json();
      if(!d.content||!d.content.length) throw new Error('Empty response');
      if(d.stop_reason==='max_tokens') throw new Error('Response truncated.');
      let txt=d.content.filter(c=>c.type==='text').map(c=>c.text||'').join('');
      txt=txt.replace(/```json\s*/gi,'').replace(/```\s*/g,'').trim();
      const m=txt.match(/\{[\s\S]*\}/);
      if(!m) throw new Error('No JSON in response: '+txt.substring(0,300));
      try{return JSON.parse(m[0]);}catch{throw new Error('Invalid JSON in AI response: '+m[0].substring(0,200));}
    }catch(e){
      if(e.name==='AbortError') throw new Error('Request timed out. Try again.');
      if(_attempt<3&&!e.message.includes('truncated')&&!e.message.includes('No JSON')){
        await new Promise(res=>setTimeout(res,1500*_attempt));
        return callAI(prompt,maxTok,search,_attempt+1);
      }
      throw e;
    }finally{clearTimeout(timer);}
  }

  async function fixOverLimitDescriptions(descriptions,contextNote=''){
    const overIdxs=descriptions.map((d,i)=>d&&d.trim().length>90?i:-1).filter(i=>i>=0);
    if(!overIdxs.length) return descriptions;
    const offending=overIdxs.map(i=>`D${i+1} (${descriptions[i].trim().length} chars): "${descriptions[i].trim()}"`).join('\n');
    try{
      const fix=await callAI(`Rewrite these Google Ads descriptions to be under 90 characters each. Preserve the intent and key message. Count every character including spaces — a space is 1 character.${contextNote?'\nContext: '+contextNote:''}

Descriptions to fix:
${offending}

Return ONLY valid JSON: {"fixed":["rewritten description 1"]}
Array must have exactly ${overIdxs.length} item(s) in the same order as the list above.`,800);
      if(fix&&Array.isArray(fix.fixed)){
        const out=[...descriptions];
        overIdxs.forEach((origIdx,fixIdx)=>{if(fix.fixed[fixIdx])out[origIdx]=fix.fixed[fixIdx].trim();});
        return out.map(d=>{if(!d||d.trim().length<=90)return d;const s=d.trim().substring(0,90);const sp=s.lastIndexOf(' ');return sp>60?s.substring(0,sp):s;});
      }
    }catch(e){console.warn('fixOverLimitDescriptions AI pass failed:',e.message);}
    return descriptions.map(d=>{if(!d||d.trim().length<=90)return d;const s=d.trim().substring(0,90);const sp=s.lastIndexOf(' ');return sp>60?s.substring(0,sp):s;});
  }

  async function fixOverLimitHeadlines(headlines,contextNote=''){
    const overIdxs=headlines.map((h,i)=>h&&h.trim().length>30?i:-1).filter(i=>i>=0);
    if(!overIdxs.length) return headlines;
    const offending=overIdxs.map(i=>`H${i+1} (${headlines[i].trim().length} chars): "${headlines[i].trim()}"`).join('\n');
    try{
      const fix=await callAI(`Rewrite these Google Ads headlines to be 30 characters or fewer. Preserve the core message and intent. Every character including spaces counts.${contextNote?'\nContext: '+contextNote:''}

Headlines to fix:
${offending}

Return ONLY valid JSON: {"fixed":["rewritten headline 1"]}
Array must have exactly ${overIdxs.length} item(s) in the same order as the list above.`,600);
      if(fix&&Array.isArray(fix.fixed)){
        const out=[...headlines];
        overIdxs.forEach((origIdx,fixIdx)=>{if(fix.fixed[fixIdx])out[origIdx]=fix.fixed[fixIdx].trim();});
        return out.map(h=>{if(!h||h.trim().length<=30)return h;const s=h.trim().substring(0,30);const sp=s.lastIndexOf(' ');return sp>15?s.substring(0,sp):s.substring(0,30);});
      }
    }catch(e){console.warn('fixOverLimitHeadlines AI pass failed:',e.message);}
    return headlines.map(h=>{if(!h||h.trim().length<=30)return h;const s=h.trim().substring(0,30);const sp=s.lastIndexOf(' ');return sp>15?s.substring(0,sp):s.substring(0,30);});
  }

  async function fixAdGroupHeadlines(items,contextNote=''){
    for(const item of items){
      if(Array.isArray(item.headlines)&&item.headlines.some(h=>h&&h.trim().length>30))
        item.headlines=await fixOverLimitHeadlines(item.headlines,contextNote+(item.name?' | '+item.name:''));
      for(const ad of item.ads||[])
        if(Array.isArray(ad.headlines)&&ad.headlines.some(h=>h&&h.trim().length>30))
          ad.headlines=await fixOverLimitHeadlines(ad.headlines,contextNote+(item.name?' | '+item.name:''));
    }
  }

  async function fixAdGroupDescriptions(items,contextNote=''){
    for(const item of items){
      if(Array.isArray(item.descriptions)&&item.descriptions.some(d=>d&&d.trim().length>90))
        item.descriptions=await fixOverLimitDescriptions(item.descriptions,contextNote+(item.name?' | '+item.name:''));
      for(const ad of item.ads||[])
        if(Array.isArray(ad.descriptions)&&ad.descriptions.some(d=>d&&d.trim().length>90))
          ad.descriptions=await fixOverLimitDescriptions(ad.descriptions,contextNote+(item.name?' | '+item.name:''));
    }
  }

  async function generateAdCopy(campKey,index){
    const loadKey=`${campKey}-${index}`;
    setAdCopyLoading(p=>({...p,[loadKey]:true}));
    const isRSA=['branded','targetedSearch','searchRemarketing'].includes(campKey);
    const isPMax=campKey==='pmax';
    const isDemandGen=campKey==='demandGen';
    const isDisplay=campKey==='displayRemarketing';
    const usps=brief.usps.split('\n').map(s=>s.trim()).filter(Boolean);
    const angleMap={aggressive:'Use urgency and scarcity. Push hard CTAs. Drive immediate action.','trust-first':'Lead with social proof and risk reducers. Build trust before CTA.',standard:''};
    const angleMod=angleMap[copyAngle]||'';
    const saNote=getLangNote(brief.locationCode);
    try{
      let prompt='';
      const getAg=()=>{
        if(isPMax) return (gen.pmax.assetGroups||[])[index]||{};
        return (gen[campKey].adGroups||[])[index]||{};
      };
      const ag=getAg();
      const brandCtx=getBrandVoiceContext(brief);
      const copyQualityRules=getCopyQualityRules(brief);
      if(isRSA){
        const kws=(ag.keywords||[]).slice(0,10).map(k=>k.text).join(', ');
        const isRLSA=campKey==='searchRemarketing';
        const isBranded=campKey==='branded';
        const temp=isBranded||isRLSA?'Hot':'Warm';
        prompt=`You are a senior Google Ads copywriter. Generate RSA copy for this ad group.

BUSINESS CONTEXT:
Business: ${brief.businessName} | Industry: ${brief.industry}
Target Customer: ${brief.targetCustomer}
USPs: ${usps.join(' | ')||'quality, professional, reliable'}
Ad Group: ${ag.name||''}
Top keywords: ${kws}
Strategic angle: ${campaignAngle||'Direct response — capture buyers actively searching'}

TRAFFIC TEMPERATURE: ${temp}
COPY ANGLE: ${angleMod||'Balanced — strong benefits, clear USPs, and a compelling CTA'}
${getBusinessTypeContext(brief.businessType)}${brandCtx}

7-8 HEADLINE SLOTS:
H1: Relevance Anchor (service name or brand). PIN to position 1.
H2: Value Proposition.
H3: USP.
H4: Social Proof.
H5: Risk Removal.
H6: USP variant.
H7: CTA.
H8: Pain Recognition (optional).

DESCRIPTIONS (2-3):
D1: Keyword + USP + hard CTA. PIN to position 1.
D2: Social proof + CTA.
D3: Risk removal + trust.

WRITING RULES: Visitor-first. Specific, numbers. No two headlines start with same word. ${saNote}
${copyQualityRules}
Return ONLY valid JSON:
{"headlines":["h1","h2","h3","h4","h5","h6","h7"],"descriptions":["d1","d2","d3"],"path1":"Path","path2":"GetQuote","pinnedPositions":{"0":"1","d0":"1"}}
HARD LIMITS: headlines ≤30 chars, descriptions ≤90 chars, path1/path2 ≤15 chars no spaces. 7-8 headlines, 2-3 descriptions.`;
      } else if(isPMax){
        prompt=`You are a senior Google Ads copywriter. Generate Performance Max asset group copy.

CONTEXT:
Business: ${brief.businessName} | Industry: ${brief.industry}
Asset Group: ${ag.name||''} | Audience Signals: ${(ag.audienceSignals||[]).join(', ')}
USPs: ${usps.join(' | ')||'quality, professional, reliable'}
${getBusinessTypeContext(brief.businessType)}${brandCtx}
${copyQualityRules}
Return ONLY valid JSON:
{"headlines":["h1",...15],"longHeadlines":["lh1",...5],"descriptions":["d1",...5],"callToActions":["Get Quote","Learn More"],"audienceSignals":["Website Visitors — All","Custom Intent: service searchers","In-Market: relevant category"]}
HARD LIMITS: headlines ≤30 chars, long headlines + descriptions ≤90 chars. 15 headlines, 5 long headlines, 5 descriptions.`;
      } else if(isDemandGen){
        prompt=`Senior Google Ads copywriter. Demand Gen campaign.
Business: ${brief.businessName} | Industry: ${brief.industry}
Audience Theme: ${ag.audienceTheme||''} | Targeting: ${(ag.audienceTargeting||[]).join(', ')}
${getBusinessTypeContext(brief.businessType)}${brandCtx}${copyQualityRules}
Return ONLY valid JSON:
{"headlines":["h1","h2","h3"],"descriptions":["d1","d2"],"gmailSubjectLines":["s1","s2"],"videoConceptBrief":"1-2 sentence concept"}
3 headlines ≤30 chars. 2 descriptions ≤90 chars. 2 Gmail subject lines ≤70 chars.`;
      } else if(isDisplay){
        prompt=`Senior Google Ads copywriter. Display Remarketing banner.
Business: ${brief.businessName} | Industry: ${brief.industry}
Audience: ${ag.audienceList||''} | Lookback: ${ag.audienceDuration||'30 days'}
${getBusinessTypeContext(brief.businessType)}${brandCtx}${copyQualityRules}
Return ONLY valid JSON:
{"headlines":["h1","h2","h3"],"longHeadline":"long headline ≤90 chars","descriptions":["d1","d2"],"imageConcepts":["concept1","concept2","concept3"],"callToAction":"Get Quote"}
3 headlines ≤30 chars. 2 descriptions ≤90 chars. callToAction ≤15 chars.`;
      }
      const result=await callAI(prompt,2000);
      let rsaAssets=null;
      if(isRSA){
        let hs=(result.headlines||[]).slice(0,8).map(h=>String(h).trim());
        while(hs.length<8)hs.push('');
        if(hs.some(h=>h&&h.length>30)) hs=await fixOverLimitHeadlines(hs,ag.name||'');
        let ds=(result.descriptions||[]).slice(0,3).map(d=>String(d).trim());
        while(ds.length<3)ds.push('');
        if(ds.some(d=>d&&d.length>90)) ds=await fixOverLimitDescriptions(ds,ag.name||'');
        const p1=(result.path1||'').replace(/\s+/g,'').substring(0,15);
        const p2=(result.path2||'').replace(/\s+/g,'').substring(0,15);
        const pins=result.pinnedPositions||{'0':'1','d0':'1'};
        rsaAssets={hs,ds,p1,p2,pins};
      } else {
        if(Array.isArray(result.headlines)&&result.headlines.some(h=>h&&h.trim().length>30))
          result.headlines=await fixOverLimitHeadlines(result.headlines,ag.name||'');
        if(Array.isArray(result.descriptions)&&result.descriptions.some(d=>d&&d.trim().length>90))
          result.descriptions=await fixOverLimitDescriptions(result.descriptions,ag.name||'');
      }
      setGen(prev=>{
        if(isRSA){
          const {hs,ds,p1,p2,pins}=rsaAssets;
          const ags=(prev[campKey].adGroups||[]).map((a,i)=>{
            if(i!==index) return a;
            return{...a,lastCopyUpdate:Date.now(),ads:[{...((a.ads||[])[0]||{}),headlines:hs,descriptions:ds,path1:p1,path2:p2,pinnedPositions:pins}]};
          });
          return{...prev,[campKey]:{...prev[campKey],adGroups:ags}};
        } else if(isPMax){
          const ags=(prev.pmax.assetGroups||[]).map((a,i)=>i!==index?a:{...a,...result,lastCopyUpdate:Date.now()});
          return{...prev,pmax:{...prev.pmax,assetGroups:ags}};
        } else {
          const ags=(prev[campKey].adGroups||[]).map((a,i)=>i!==index?a:{...a,...result,lastCopyUpdate:Date.now()});
          return{...prev,[campKey]:{...prev[campKey],adGroups:ags}};
        }
      });
    }catch(e){console.error('generateAdCopy failed:',e.message);setError('Copy generation failed: '+e.message);}
    finally{setAdCopyLoading(p=>({...p,[loadKey]:false}));}
  }

  function validateCampaignResponse(r,type){
    if(!r||typeof r!=='object') throw new Error(`Invalid response structure for ${type}`);
    const needsAdGroups=['branded','targetedSearch','searchRemarketing','demandGen','displayRemarketing'];
    if(needsAdGroups.includes(type)&&!Array.isArray(r.adGroups))
      throw new Error(`Missing adGroups array in ${type} response`);
    if(type==='pmax'&&!Array.isArray(r.assetGroups))
      throw new Error('Missing assetGroups array in pmax response');
  }

  async function checkKeywordVolumes(keywords,locationCode){
    try{
      const res=await fetch('/.netlify/functions/keyword-planner',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({keywords:keywords.map(k=>k.text||k),locationCode:locationCode||2710})});
      if(!res.ok) return null;
      const data=await res.json();
      if(!data.keywords) return null;
      const map={};
      data.keywords.forEach(k=>{map[k.keyword.toLowerCase()]=k;});
      return map;
    }catch(e){console.warn('Volume check failed:',e.message);return null;}
  }

  async function enrichAdGroupsWithVolume(adGroups,setMsg,locationCode){
    const allKws=[...new Set(adGroups.flatMap(ag=>(ag.keywords||[]).map(k=>k.text)))];
    if(!allKws.length) return adGroups;
    setMsg(`Checking search volumes for ${allKws.length} keywords via Google Ads API...`);
    const batchSize=100;
    const batches=[];
    for(let i=0;i<allKws.length;i+=batchSize) batches.push(allKws.slice(i,i+batchSize));
    const maps=await Promise.all(batches.map(batch=>checkKeywordVolumes(batch,locationCode)));
    const goodMaps=maps.filter(Boolean);
    if(goodMaps.length===0)setMsg('⚠️ Keyword volume check failed — continuing without volume data.');
    else if(goodMaps.length<maps.length)setMsg(`⚠️ Volume check partial (${goodMaps.length}/${maps.length} batches succeeded).`);
    const volumeMap=Object.assign({},...goodMaps);
    return adGroups.map(ag=>({...ag,keywords:(ag.keywords||[]).map(kw=>{
      const data=volumeMap[kw.text.toLowerCase()];
      return{...kw,avgMonthlySearches:data?.avgMonthlySearches??null,competition:data?.competition??null,competitionIndex:data?.competitionIndex??null,cpc:data?.cpc??null,tier:data?.tier??null,hasVolume:data?.hasVolume??null,recommended:data?.recommended??null,volumeChecked:!!data};
    })}));
  }

  async function scanWebsite(){
    if(!brief.website){setError('Enter a website URL first.');return;}
    if(isScanningRef.current) return;
    isScanningRef.current=true;
    setError(null);setStagingWarning(isStagingUrl(brief.website));setState('scanning');
    try{
      const res=await fetch('/.netlify/functions/scan-website',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:brief.website,transcript:transcript.trim()||undefined})});
      if(!res.ok){const txt=await res.text();let msg='HTTP '+res.status;try{msg=JSON.parse(txt).error||msg;}catch{}throw new Error(msg);}
      const r=await res.json();
      setScanResult({...r,source:'website'});
      setSelectedSvcs((r.detectedServices||[]).map((s,i)=>s.advertisable?i:null).filter(i=>i!==null));
      setBrief(p=>({...p,
        businessName:r.businessName||p.businessName,
        businessType:r.businessType||p.businessType,
        description:r.description||p.description,
        industry:r.industry||p.industry,
        targetCustomer:r.targetCustomer||p.targetCustomer,
        usps:Array.isArray(r.usps)?r.usps.join('\n'):p.usps,
        landingPage:r.suggestedLandingPage||p.landingPage,
        toneOfVoice:r.toneOfVoice||p.toneOfVoice,
        toneExamples:Array.isArray(r.toneExamples)?r.toneExamples:p.toneExamples,
        trustSignals:r.trustSignals&&typeof r.trustSignals==='object'?r.trustSignals:p.trustSignals,
        primaryCTA:r.primaryCTA||p.primaryCTA,
        painPoints:Array.isArray(r.painPoints)?r.painPoints:p.painPoints,
        pricingInfo:r.pricingInfo||p.pricingInfo,
      }));
      setState('steer');
    }catch(e){setError('Scan failed: '+e.message);setState('brief');}
    finally{isScanningRef.current=false;}
  }

  async function parseTranscript(){
    if(!transcript.trim()){setError('Paste a meeting transcript first.');return;}
    if(isScanningRef.current) return;
    isScanningRef.current=true;
    setError(null);setState('scanning');
    try{
      const r=await callAI(`You are a Google Ads strategist. Extract all business and campaign information from this client meeting transcript.
Transcript:
${transcript.substring(0,6000)}

RESPOND WITH ONLY VALID JSON:
{"businessName":"","businessType":"leadGen|ecommerce|hybrid","industry":"","description":"","targetCustomer":"","detectedServices":[{"name":"","description":"","advertisable":true}],"usps":[""],"toneOfVoice":"","toneExamples":[""],"trustSignals":{"rating":"","reviewCount":"","reviewPlatform":"","yearsInBusiness":"","clientCount":"","certifications":[],"guarantees":[]},"primaryCTA":"","painPoints":[""],"pricingInfo":"","suggestedLandingPage":"","campaignAngle":"","excludeNote":"","confidence":"high|medium|low","confidenceNote":""}`,5000);
      setScanResult({...r,source:'transcript'});
      setSelectedSvcs((r.detectedServices||[]).map((s,i)=>s.advertisable?i:null).filter(i=>i!==null));
      setBrief(p=>({...p,
        businessName:r.businessName||p.businessName,
        businessType:r.businessType||p.businessType,
        description:r.description||p.description,
        industry:r.industry||p.industry,
        targetCustomer:r.targetCustomer||p.targetCustomer,
        usps:Array.isArray(r.usps)?r.usps.join('\n'):p.usps,
        landingPage:r.suggestedLandingPage||p.landingPage,
        toneOfVoice:r.toneOfVoice||p.toneOfVoice,
        toneExamples:Array.isArray(r.toneExamples)?r.toneExamples:p.toneExamples,
        trustSignals:r.trustSignals&&typeof r.trustSignals==='object'?r.trustSignals:p.trustSignals,
        primaryCTA:r.primaryCTA||p.primaryCTA,
        painPoints:Array.isArray(r.painPoints)?r.painPoints:p.painPoints,
        pricingInfo:r.pricingInfo||p.pricingInfo,
      }));
      if(r.campaignAngle) setCampaignAngle(r.campaignAngle);
      if(r.excludeNote) setExcludeNote(r.excludeNote);
      setState('steer');
    }catch(e){setError('Transcript parsing failed: '+e.message);setState('brief');}
    finally{isScanningRef.current=false;}
  }

  function toggleSvc(i){setSelectedSvcs(prev=>prev.includes(i)?prev.filter(x=>x!==i):[...prev,i]);}

  function normaliseAdGroups(r,minCpc){
    (r.adGroups||[]).forEach(ag=>{
      ag.keywords=(ag.keywords||[]).map(k=>{
        if(typeof k==='string'){
          if(k.startsWith('[')&&k.endsWith(']')) return{text:k.slice(1,-1).toLowerCase().trim(),matchType:'Exact'};
          if(k.startsWith('"')&&k.endsWith('"')) return{text:k.slice(1,-1).toLowerCase().trim(),matchType:'Phrase'};
          return{text:k.toLowerCase().trim(),matchType:'Exact'};
        }
        return{text:(k.text||'').toLowerCase().trim(),matchType:k.matchType==='Phrase'?'Phrase':'Exact'};
      }).filter(k=>k.text.length>0);
      ag.defaultCpc=Math.max(parseFloat(ag.defaultCpc)||minCpc,minCpc);
      (ag.ads||[]).forEach(ad=>{
        ad.headlines=(ad.headlines||[]).slice(0,8).map(h=>String(h).trim());
        while(ad.headlines.length<8)ad.headlines.push('');
        ad.descriptions=(ad.descriptions||[]).slice(0,3).map(d=>String(d).trim());
        while(ad.descriptions.length<3)ad.descriptions.push('');
        ad.path1=(ad.path1||'').replace(/\s+/g,'').substring(0,15);
        ad.path2=(ad.path2||'').replace(/\s+/g,'').substring(0,15);
      });
    });
  }

  function normaliseRlsa(r,minCpc){
    (r.adGroups||[]).forEach(ag=>{
      ag.keywords=(ag.keywords||[]).map(k=>({text:typeof k==='string'?k.toLowerCase().trim():(k.text||'').toLowerCase().trim(),matchType:'Broad'})).filter(k=>k.text.length>0);
      ag.defaultCpc=Math.max(parseFloat(ag.defaultCpc)||minCpc,minCpc);
      (ag.ads||[]).forEach(ad=>{
        ad.headlines=(ad.headlines||[]).slice(0,8).map(h=>String(h).trim());
        while(ad.headlines.length<8)ad.headlines.push('');
        ad.descriptions=(ad.descriptions||[]).slice(0,3).map(d=>String(d).trim());
        while(ad.descriptions.length<3)ad.descriptions.push('');
        ad.path1=(ad.path1||'').replace(/\s+/g,'').substring(0,15);
        ad.path2=(ad.path2||'').replace(/\s+/g,'').substring(0,15);
      });
    });
  }

  function kwStats(ags){let e=0,p=0,b=0;(ags||[]).forEach(ag=>(ag.keywords||[]).forEach(k=>{if(k.matchType==='Phrase')p++;else if(k.matchType==='Broad')b++;else e++;}));return{exact:e,phrase:p,broad:b,total:e+p+b};}
  function kwHealthPct(kws){const c=(kws||[]).filter(k=>k.volumeChecked);return c.length>0?Math.round(c.filter(k=>k.hasVolume).length/c.length*100):null;}

  async function generate(){
    const sr=scanResult;
    const curr=brief.currencySymbol==='R'?'ZAR':brief.currencySymbol==='$'?'USD':brief.currencySymbol==='£'?'GBP':'EUR';
    const minCpc=curr==='ZAR'?8.00:1.00;
    const selected=(sr?sr.detectedServices||[]:[]).filter((_,i)=>selectedSvcs.includes(i)).map(s=>s.name);
    const custom=customSvcs.split('\n').map(s=>s.trim()).filter(Boolean);
    const finalServices=[...selected,...custom];
    if(!brief.businessName){setError('Business name is required.');return;}
    if(finalServices.length===0){setError('Select at least one service to advertise.');return;}
    if(isGeneratingRef.current) return;
    isGeneratingRef.current=true;
    setState('loading');setError(null);setGen({});const campErrors=[];try{
    const usps=brief.usps.split('\n').map(s=>s.trim()).filter(Boolean);
    const txCtx=transcript.trim()?`\nClient meeting notes:\n${transcript.substring(0,2500)}`:'';
    const brandCtx=getBrandVoiceContext(brief);
    const copyQualityRules=getCopyQualityRules(brief);
    const result={};
    const steps=selectedCampaignTypes;
    let stepIdx=0;

    if(steps.includes('branded')){
      setLoadingMsg(`Generating Branded Search... (${++stepIdx}/${steps.length})`);setLoadingStep(stepIdx);
      try{
        const industryNegs=getIndustryNegs(brief.industry);
        const r=await callAI(`Generate a Google Ads BRANDED SEARCH campaign.
Business: ${brief.businessName} | Website: ${brief.website} | Industry: ${brief.industry}
Currency: ${curr} | Min CPC: ${minCpc}${txCtx}

${getBusinessTypeContext(brief.businessType)}${brandCtx}
${copyQualityRules}
Return ONLY valid JSON:
{"adGroups":[{"name":"Brand - Core","defaultCpc":${minCpc},"keywords":[{"text":"keyword","matchType":"Exact"}],"ads":[{"headlines":["h1","h2","h3","h4","h5","h6","h7"],"descriptions":["d1","d2","d3"],"path1":"Brand","path2":"Official"}]}],"industryNegatives":["competitor term"],"sitelinks":[{"text":"Sitelink","description1":"Benefit 1","description2":"Benefit 2","finalUrl":"${brief.website}"}],"callouts":["Free Quote","Trusted","Fast Response"]}
Rules: 8-12 brand keywords. 7 headlines ≤30 chars. 3 descriptions ≤90 chars. path1/path2 ≤15 chars.${industryNegs.length?` Industry negatives: ${industryNegs.join(', ')}`:'' }`,8000);
        validateCampaignResponse(r,'branded');
        normaliseAdGroups(r,minCpc);
        await fixAdGroupDescriptions(r.adGroups||[],brief.businessName);
        await fixAdGroupHeadlines(r.adGroups||[],brief.businessName);
        result.branded={
          adGroups:r.adGroups||[],
          negatives:[...new Set([...STD_NEGS,...(r.industryNegatives||[])])],
          sitelinks:(r.sitelinks||[]).map(sl=>({text:(sl.text||'').substring(0,25),description1:(sl.description1||'').substring(0,35),description2:(sl.description2||'').substring(0,35),finalUrl:sl.finalUrl||brief.website||''})),
          callouts:(r.callouts||[]).map(c=>String(c).substring(0,25)).filter(Boolean),
        };
        setGen(prev=>({...prev,branded:result.branded}));
      }catch(e){console.error('Branded failed:',e.message);campErrors.push('Branded Search: '+e.message);}
    }

    if(steps.includes('targetedSearch')){
      setLoadingMsg(`Generating Targeted Search... (${++stepIdx}/${steps.length})`);setLoadingStep(stepIdx);
      const allAdGroups=[];
      let sharedExtensions=null;
      for(let si=0;si<finalServices.length;si++){
        const svc=finalServices[si];
        setLoadingMsg(`Targeted Search: building "${svc}" (${si+1}/${finalServices.length})...`);
        try{
          const isFirst=si===0;
          const industryNegs2=getIndustryNegs(brief.industry);
          const prompt=`Generate ONE Google Ads ad group for the service: "${svc}"
Business: ${brief.businessName} | Website: ${brief.website} | Industry: ${brief.industry}
Target Customer: ${brief.targetCustomer}
USPs: ${usps.join(' | ')||'quality, professional, reliable'}
Campaign angle: ${campaignAngle||'Direct response — capture buyers actively searching for this service'}
Currency: ${curr} | Min CPC: ${minCpc}
${excludeNote?'DO NOT include: '+excludeNote:''}${txCtx}
${getBusinessTypeContext(brief.businessType)}${brandCtx}

KEYWORD STRATEGY — Volume-first (12-15 keywords total):
${getMarketNote(brief.locationCode)}
Major cities for this market (pick max 2): ${getMajorCities(brief.locationCode,brief.locations)}

TIER 1 — Core (4-6, Exact, 1-3 words): service name, synonyms, service + top city (max 2).
TIER 2 — Commercial intent (4-5, Phrase, 2-4 words): "${svc} price", "${svc} quote", "${svc} near me", "best ${svc}".
TIER 3 — Modifiers (3-4, Exact): "commercial ${svc}", "custom ${svc}", "corporate ${svc}".

ABSOLUTE RULES:
- Maximum 15 keywords total
- NEVER combine service + modifier + location
- NEVER 5+ word keywords
- NEVER suburb names (Sandton, Midrand, etc.)

RSA COPY — 7-8 headlines + 3 descriptions.
${copyQualityRules}
${isFirst?`SITELINKS: 4 sitelinks. CALLOUTS: 6-8 short phrases. STRUCTURED SNIPPET: 4-6 services.`:''}

Return ONLY valid JSON:
{"adGroups":[{"name":"${svc}","defaultCpc":${minCpc},"keywords":[{"text":"keyword","matchType":"Exact"}],"ads":[{"headlines":["h1","h2","h3","h4","h5","h6","h7"],"descriptions":["d1","d2","d3"],"path1":"Path","path2":"GetQuote"}]}]${isFirst?`,"industryNegatives":["competitor"],"sitelinks":[{"text":"Title","description1":"Benefit 1","description2":"Benefit 2","finalUrl":"${brief.website}"}],"callouts":["Free Quote","No Obligation","10+ Years"],"structuredSnippet":{"header":"Services","values":["Service 1","Service 2"]}`:''}}
HARD LIMITS: headlines ≤30 chars, descriptions ≤90 chars, path1/path2 ≤15 chars. 7-8 headlines, 3 descriptions.${industryNegs2.length?` Industry negatives: ${industryNegs2.join(', ')}`:'' }`;
          const r=await callAI(prompt,6000);
          validateCampaignResponse(r,'targetedSearch');
          if(r.adGroups&&r.adGroups.length>0){
            normaliseAdGroups(r,minCpc);
            const negSet=new Set(STD_NEGS.map(n=>n.toLowerCase()));
            r.adGroups.forEach(ag=>{ag.keywords=(ag.keywords||[]).filter(k=>k.text&&!negSet.has(k.text));});
            allAdGroups.push(...r.adGroups);
          }
          if(isFirst&&r.sitelinks) sharedExtensions=r;
        }catch(e){console.error(`"${svc}" failed:`,e.message);campErrors.push(`Targeted "${svc}": `+e.message);}
      }
      if(allAdGroups.length>0){
        const seenKws=new Set();
        allAdGroups.forEach(ag=>{
          ag.keywords=(ag.keywords||[]).filter(kw=>{
            const key=kw.text.toLowerCase()+'|'+(kw.matchType||'Exact');
            if(seenKws.has(key)) return false;
            seenKws.add(key);
            return true;
          });
        });
        const enriched=await enrichAdGroupsWithVolume(allAdGroups,setLoadingMsg,brief.locationCode);
        setLoadingMsg('Removing zero-volume keywords...');
        const filtered=enriched.map(ag=>{
          const confirmed0=ag.keywords.filter(k=>k.volumeChecked&&!k.hasVolume);
          if(confirmed0.length===0) return ag;
          const withVol=ag.keywords.filter(k=>!k.volumeChecked||k.hasVolume);
          if(withVol.length>0) return{...ag,keywords:withVol,autoRemovedCount:confirmed0.length};
          const top3=[...ag.keywords].sort((a,b)=>(b.avgMonthlySearches||0)-(a.avgMonthlySearches||0)).slice(0,3);
          return{...ag,keywords:top3,autoRemovedCount:confirmed0.length-top3.length};
        });
        await fixAdGroupDescriptions(filtered,brief.businessName);
        await fixAdGroupHeadlines(filtered,brief.businessName);
        result.targetedSearch={
          adGroups:filtered,
          negatives:[...new Set([...STD_NEGS,...(sharedExtensions?.industryNegatives||[])])],
          sitelinks:(sharedExtensions?.sitelinks||[]).map(sl=>({text:(sl.text||'').substring(0,25),description1:(sl.description1||'').substring(0,35),description2:(sl.description2||'').substring(0,35),finalUrl:sl.finalUrl||brief.website||''})),
          callouts:(sharedExtensions?.callouts||[]).map(c=>String(c).substring(0,25)),
          structuredSnippet:sharedExtensions?.structuredSnippet||{header:'Services',values:[]},
        };
        setGen(prev=>({...prev,targetedSearch:result.targetedSearch}));
      } else {
        setError('Targeted Search generated no ad groups.');
      }
    }

    if(steps.includes('pmax')){
      setLoadingMsg(`Generating Performance Max... (${++stepIdx}/${steps.length})`);setLoadingStep(stepIdx);
      try{
        const r=await callAI(`Generate a Google Ads PERFORMANCE MAX campaign (no product feed, lead generation).
Business: ${brief.businessName} | Industry: ${brief.industry}
Services: ${finalServices.join(', ')} | Target Customer: ${brief.targetCustomer}
USPs: ${usps.join(' | ')}${txCtx}
${getBusinessTypeContext(brief.businessType)}${brandCtx}${copyQualityRules}
Return ONLY valid JSON:
{"assetGroups":[{"name":"Asset Group - Name","headlines":["h1",...15],"longHeadlines":["lh1",...5],"descriptions":["d1",...5],"callToActions":["Get Quote","Learn More"],"audienceSignals":["Website Visitors — All","Custom Intent: service searchers","In-Market: Category"]}]}
Max 4 asset groups. 15 headlines ≤30 chars, 5 long headlines ≤90 chars, 5 descriptions ≤90 chars.`,10000);
        validateCampaignResponse(r,'pmax');
        await fixAdGroupDescriptions(r.assetGroups||[],brief.businessName);
        await fixAdGroupHeadlines(r.assetGroups||[],brief.businessName);
        result.pmax={assetGroups:r.assetGroups||[]};
        setGen(prev=>({...prev,pmax:result.pmax}));
      }catch(e){console.error('PMax failed:',e.message);campErrors.push('Performance Max: '+e.message);}
    }

    if(steps.includes('demandGen')){
      setLoadingMsg(`Generating Demand Gen... (${++stepIdx}/${steps.length})`);setLoadingStep(stepIdx);
      try{
        const r=await callAI(`Generate a Google Ads DEMAND GEN campaign (YouTube, Discover, Gmail).
Business: ${brief.businessName} | Industry: ${brief.industry}
Services: ${finalServices.join(', ')} | Target Customer: ${brief.targetCustomer}
USPs: ${usps.join(' | ')}${txCtx}
${getBusinessTypeContext(brief.businessType)}${brandCtx}${copyQualityRules}
Create 2-3 ad groups (Warm Remarketing, Cool Custom, Cold In-Market).
Return ONLY valid JSON:
{"adGroups":[{"audienceTheme":"Theme","audienceTargeting":["aud1","aud2"],"headlines":["h1","h2","h3"],"descriptions":["d1","d2"],"videoConceptBrief":"concept","gmailSubjectLines":["s1","s2"]}]}
3 headlines ≤30 chars. 2 descriptions ≤90 chars. 2 Gmail subjects ≤70 chars.`,8000);
        validateCampaignResponse(r,'demandGen');
        await fixAdGroupDescriptions(r.adGroups||[],brief.businessName);
        await fixAdGroupHeadlines(r.adGroups||[],brief.businessName);
        result.demandGen={adGroups:r.adGroups||[]};
        setGen(prev=>({...prev,demandGen:result.demandGen}));
      }catch(e){console.error('DemandGen failed:',e.message);campErrors.push('Demand Gen: '+e.message);}
    }

    if(steps.includes('searchRemarketing')){
      setLoadingMsg(`Generating Search Remarketing (RLSA)... (${++stepIdx}/${steps.length})`);setLoadingStep(stepIdx);
      try{
        const r=await callAI(`Generate a Google Ads SEARCH REMARKETING (RLSA) campaign.
Business: ${brief.businessName} | Services: ${finalServices.join(', ')} | Currency: ${curr} | Min CPC: ${minCpc}${txCtx}
${getBusinessTypeContext(brief.businessType)}${brandCtx}${copyQualityRules}
Create 2-3 audience segments: High-Intent 7 Days (+50%), All Visitors 30 Days (+30%), All Visitors 90 Days (+15%).
Keywords: Broad match, 8-12 keywords covering main services.
Return ONLY valid JSON:
{"adGroups":[{"name":"All Website Visitors","audienceList":"All Website Visitors - 30 days","bidAdjustment":"+30%","defaultCpc":${minCpc},"keywords":[{"text":"keyword","matchType":"Broad"}],"ads":[{"headlines":["h1","h2","h3","h4","h5","h6","h7"],"descriptions":["d1","d2","d3"],"path1":"Return","path2":"GetQuote"}]}]}
HARD LIMITS: headlines ≤30 chars, descriptions ≤90 chars. 7-8 headlines, 3 descriptions.`,10000);
        validateCampaignResponse(r,'searchRemarketing');
        normaliseRlsa(r,minCpc);
        await fixAdGroupDescriptions(r.adGroups||[],brief.businessName);
        await fixAdGroupHeadlines(r.adGroups||[],brief.businessName);
        result.searchRemarketing={adGroups:r.adGroups||[]};
        setGen(prev=>({...prev,searchRemarketing:result.searchRemarketing}));
      }catch(e){console.error('RLSA failed:',e.message);campErrors.push('Search Remarketing: '+e.message);}
    }

    if(steps.includes('displayRemarketing')){
      setLoadingMsg(`Generating Display Remarketing... (${++stepIdx}/${steps.length})`);setLoadingStep(stepIdx);
      try{
        const r=await callAI(`Generate a Google Ads DISPLAY REMARKETING campaign (GDN banner ads).
Business: ${brief.businessName} | Industry: ${brief.industry}
Target Customer: ${brief.targetCustomer} | USPs: ${usps.join(' | ')}${txCtx}
${getBusinessTypeContext(brief.businessType)}${brandCtx}${copyQualityRules}
Create 2-3 ad groups by audience temperature with exclusions.
Return ONLY valid JSON:
{"adGroups":[{"name":"High-Intent Visitors — 30 Days","audienceList":"Service Page Visitors","audienceDuration":"30 days","targetCPM":20,"headlines":["h1","h2","h3"],"descriptions":["d1","d2"],"longHeadline":"long headline","imageConcepts":["concept1","concept2"],"callToAction":"Get a Quote"}]}`,8000);
        validateCampaignResponse(r,'displayRemarketing');
        await fixAdGroupDescriptions(r.adGroups||[],brief.businessName);
        await fixAdGroupHeadlines(r.adGroups||[],brief.businessName);
        result.displayRemarketing={adGroups:r.adGroups||[]};
        setGen(prev=>({...prev,displayRemarketing:result.displayRemarketing}));
      }catch(e){console.error('Display failed:',e.message);campErrors.push('Display Remarketing: '+e.message);}
    }

    if(campErrors.length>0) setError('⚠️ '+campErrors.length+' campaign'+(campErrors.length>1?'s':'')+' failed to generate — '+campErrors.join(' · '));
    setExpAgs({});setState('results');
    }finally{isGeneratingRef.current=false;}
  }

  function buildAllCSVs(){
    const g=gen;if(!g) return[];
    const csvs=[];
    const fu=(brief.landingPage||brief.website||'https://example.com').trim();
    const allLocations=(brief.locations&&brief.locations.length)?brief.locations:[{id:'fb',type:'named',name:'South Africa',mode:'include'}];
    const SCOLS=['Campaign','Campaign type','Campaign status','Campaign daily budget','Bid strategy type','Networks','Languages','EU political ads','Ad group','Ad group status','Default max. CPC','Keyword','Match type','Keyword status','Max CPC','Headline 1','Headline 2','Headline 3','Headline 4','Headline 5','Headline 6','Headline 7','Headline 8','Headline 9','Headline 10','Headline 11','Headline 12','Headline 13','Headline 14','Headline 15','Description 1','Description 2','Description 3','Description 4','Final URL','Path 1','Path 2','Ad status','Location','Reach','Excluded target','Proximity target latitude','Proximity target longitude','Proximity target radius','Proximity target unit','Sitelink text','Description line 1','Description line 2','Sitelink final URL','Callout text','Structured snippet header','Structured snippet values','Audience','Bid adjustment'];
    const er=()=>Object.fromEntries(SCOLS.map(c=>[c,'']));
    function addLocRows(rows,cname,emptyFn){allLocations.forEach(loc=>{const lr=emptyFn();lr['Campaign']=cname;if(loc.type==='radius'){lr['Proximity target latitude']=String(loc.lat);lr['Proximity target longitude']=String(loc.lng);lr['Proximity target radius']=String(loc.radius);lr['Proximity target unit']=loc.unit;if(loc.mode!=='exclude')lr['Reach']='People in or regularly in targeted locations';}else{lr['Location']=loc.name;if(loc.mode==='exclude'){lr['Excluded target']='true';}else{lr['Reach']='People in or regularly in targeted locations';}}rows.push(lr);});}
    function addCamp(rows,cname,budget,bidStrat){const r=er();r['Campaign']=cname;r['Campaign type']='Search';r['Campaign status']='Paused';r['Campaign daily budget']=String(budget);r['Bid strategy type']=bidStrat||'Maximize conversions';r['Networks']='Google Search';r['Languages']=brief.language||'en';r['EU political ads']='No';rows.push(r);addLocRows(rows,cname,er);}
    function addAG(rows,cname,ag,defMatch){const cpc=Number(ag.defaultCpc||10).toFixed(2);const a=er();a['Campaign']=cname;a['Ad group']=ag.name;a['Ad group status']='Enabled';a['Default max. CPC']=cpc;if(ag.audienceList){a['Audience']=ag.audienceList;a['Bid adjustment']=ag.bidAdjustment||'+0%';}rows.push(a);(ag.keywords||[]).forEach(kw=>{const mt=kw.matchType||defMatch||'Exact';const r=er();r['Campaign']=cname;r['Ad group']=ag.name;r['Keyword']=kw.text;r['Match type']=mt==='Exact'?'Exact match':mt==='Phrase'?'Phrase match':'Broad match';r['Keyword status']='Enabled';r['Max CPC']=cpc;rows.push(r);});(ag.ads||[]).forEach(ad=>{const r=er();r['Campaign']=cname;r['Ad group']=ag.name;r['Ad status']='Enabled';r['Final URL']=fu;r['Path 1']=ad.path1||'';r['Path 2']=ad.path2||'';const hl=[...(ad.headlines||[])];while(hl.length<15)hl.push('');const ds=[...(ad.descriptions||[])];while(ds.length<4)ds.push('');for(let i=0;i<15;i++)r[`Headline ${i+1}`]=hl[i]||'';for(let i=0;i<4;i++)r[`Description ${i+1}`]=ds[i]||'';rows.push(r);});}
    function addNegs(rows,cname,negs){(negs||[]).forEach(neg=>{const r=er();r['Campaign']=cname;r['Keyword']=neg;r['Match type']='Phrase match negative';rows.push(r);});}
    if(g.branded){const rows=[];const cn=campName('branded');addCamp(rows,cn,getEffectiveBudget('branded'),'Target Impression Share');(g.branded.adGroups||[]).forEach(ag=>addAG(rows,cn,ag,'Exact'));addNegs(rows,cn,g.branded.negatives);(g.branded.sitelinks||[]).forEach(sl=>{const r=er();r['Campaign']=cn;r['Sitelink text']=sl.text;r['Description line 1']=sl.description1;r['Description line 2']=sl.description2;r['Sitelink final URL']=sl.finalUrl||fu;rows.push(r);});(g.branded.callouts||[]).forEach(c=>{const r=er();r['Campaign']=cn;r['Callout text']=String(c);rows.push(r);});csvs.push({name:'01_Branded_Search',cols:SCOLS,rows});}
    if(g.targetedSearch){const rows=[];const cn=campName('targetedSearch');addCamp(rows,cn,getEffectiveBudget('targetedSearch'),brief.bidStrategy||'Maximize conversions');(g.targetedSearch.adGroups||[]).forEach(ag=>addAG(rows,cn,ag,'Exact'));addNegs(rows,cn,g.targetedSearch.negatives);const ts=g.targetedSearch;(ts.sitelinks||[]).forEach(sl=>{const r=er();r['Campaign']=cn;r['Sitelink text']=sl.text;r['Description line 1']=sl.description1;r['Description line 2']=sl.description2;r['Sitelink final URL']=sl.finalUrl||fu;rows.push(r);});(ts.callouts||[]).forEach(c=>{const r=er();r['Campaign']=cn;r['Callout text']=String(c);rows.push(r);});if(ts.structuredSnippet?.values?.length){const r=er();r['Campaign']=cn;r['Structured snippet header']=ts.structuredSnippet.header;r['Structured snippet values']=ts.structuredSnippet.values.join('; ');rows.push(r);}csvs.push({name:'02_Targeted_Search',cols:SCOLS,rows});}
    if(g.pmax){const PCOLS=['Campaign','Campaign type','Campaign status','Campaign daily budget','Bid strategy type','Asset group','Asset group status','Final URL','Headline 1','Headline 2','Headline 3','Headline 4','Headline 5','Headline 6','Headline 7','Headline 8','Headline 9','Headline 10','Headline 11','Headline 12','Headline 13','Headline 14','Headline 15','Long headline 1','Long headline 2','Long headline 3','Long headline 4','Long headline 5','Description 1','Description 2','Description 3','Description 4','Description 5','Call to action 1','Call to action 2','Audience signal 1','Audience signal 2','Audience signal 3','Location','Reach','Excluded target','Proximity target latitude','Proximity target longitude','Proximity target radius','Proximity target unit'];const rows=[];const cn=campName('pmax');const cr=Object.fromEntries(PCOLS.map(k=>[k,'']));cr['Campaign']=cn;cr['Campaign type']='Performance max';cr['Campaign status']='Paused';cr['Campaign daily budget']=String(getEffectiveBudget('pmax'));cr['Bid strategy type']='Maximize conversions';rows.push(cr);addLocRows(rows,cn,()=>Object.fromEntries(PCOLS.map(k=>[k,''])));(g.pmax.assetGroups||[]).forEach(ag=>{const r=Object.fromEntries(PCOLS.map(k=>[k,'']));r['Campaign']=cn;r['Asset group']=ag.name;r['Asset group status']='Enabled';r['Final URL']=fu;const hl=[...(ag.headlines||[])];while(hl.length<15)hl.push('');const lh=[...(ag.longHeadlines||[])];while(lh.length<5)lh.push('');const ds=[...(ag.descriptions||[])];while(ds.length<5)ds.push('');for(let i=0;i<15;i++)r[`Headline ${i+1}`]=hl[i]||'';for(let i=0;i<5;i++)r[`Long headline ${i+1}`]=lh[i]||'';for(let i=0;i<5;i++)r[`Description ${i+1}`]=ds[i]||'';if(ag.callToActions?.[0])r['Call to action 1']=ag.callToActions[0];if(ag.callToActions?.[1])r['Call to action 2']=ag.callToActions[1];(ag.audienceSignals||[]).forEach((s,i)=>{if(i<3)r[`Audience signal ${i+1}`]=s;});rows.push(r);});csvs.push({name:'03_Performance_Max',cols:PCOLS,rows});}
    if(g.searchRemarketing){const rows=[];const cn=campName('searchRemarketing');addCamp(rows,cn,getEffectiveBudget('searchRemarketing'),'Maximize conversions');(g.searchRemarketing.adGroups||[]).forEach(ag=>addAG(rows,cn,ag,'Broad'));csvs.push({name:'05_Search_Remarketing_RLSA',cols:SCOLS,rows});}
    if(g.demandGen){const DGCOLS=['Campaign','Campaign type','Campaign status','Campaign daily budget','Bid strategy type','Ad group','Ad group status','Audience targeting 1','Audience targeting 2','Audience targeting 3','Headline 1','Headline 2','Headline 3','Description 1','Description 2','Video concept brief','Gmail subject line 1','Gmail subject line 2','Final URL','Location','Reach','Excluded target','Proximity target latitude','Proximity target longitude','Proximity target radius','Proximity target unit'];const rows=[];const cn=campName('demandGen');const cr=Object.fromEntries(DGCOLS.map(k=>[k,'']));cr['Campaign']=cn;cr['Campaign type']='Demand gen';cr['Campaign status']='Paused';cr['Campaign daily budget']=String(getEffectiveBudget('demandGen'));cr['Bid strategy type']='Maximize conversions';rows.push(cr);addLocRows(rows,cn,()=>Object.fromEntries(DGCOLS.map(k=>[k,''])));(g.demandGen.adGroups||[]).forEach(ag=>{const r=Object.fromEntries(DGCOLS.map(k=>[k,'']));r['Campaign']=cn;r['Ad group']=ag.audienceTheme||'';r['Ad group status']='Enabled';r['Final URL']=fu;(ag.audienceTargeting||[]).forEach((a,i)=>{if(i<3)r[`Audience targeting ${i+1}`]=a;});(ag.headlines||[]).forEach((h,i)=>{if(i<3)r[`Headline ${i+1}`]=h;});(ag.descriptions||[]).forEach((d,i)=>{if(i<2)r[`Description ${i+1}`]=d;});r['Video concept brief']=ag.videoConceptBrief||'';if(ag.gmailSubjectLines?.[0])r['Gmail subject line 1']=ag.gmailSubjectLines[0];if(ag.gmailSubjectLines?.[1])r['Gmail subject line 2']=ag.gmailSubjectLines[1];rows.push(r);});csvs.push({name:'04_Demand_Gen',cols:DGCOLS,rows});}
    if(g.displayRemarketing){const DRCOLS=['Campaign','Campaign type','Campaign status','Campaign daily budget','Bid strategy type','Ad group','Ad group status','Audience list','Audience duration','Target CPM','Headline 1','Headline 2','Headline 3','Long headline','Description 1','Description 2','Image concept 1','Image concept 2','Image concept 3','Call to action','Final URL','Location','Reach','Excluded target','Proximity target latitude','Proximity target longitude','Proximity target radius','Proximity target unit'];const rows=[];const cn=campName('displayRemarketing');const cr=Object.fromEntries(DRCOLS.map(k=>[k,'']));cr['Campaign']=cn;cr['Campaign type']='Display';cr['Campaign status']='Paused';cr['Campaign daily budget']=String(getEffectiveBudget('displayRemarketing'));cr['Bid strategy type']='Target CPM';rows.push(cr);addLocRows(rows,cn,()=>Object.fromEntries(DRCOLS.map(k=>[k,''])));(g.displayRemarketing.adGroups||[]).forEach(ag=>{const r=Object.fromEntries(DRCOLS.map(k=>[k,'']));r['Campaign']=cn;r['Ad group']=ag.name||'';r['Ad group status']='Enabled';r['Final URL']=fu;r['Audience list']=ag.audienceList||'';r['Audience duration']=ag.audienceDuration||'30 days';r['Target CPM']=String(ag.targetCPM||'');(ag.headlines||[]).forEach((h,i)=>{if(i<3)r[`Headline ${i+1}`]=h;});r['Long headline']=ag.longHeadline||'';(ag.descriptions||[]).forEach((d,i)=>{if(i<2)r[`Description ${i+1}`]=d;});(ag.imageConcepts||[]).forEach((ic,i)=>{if(i<3)r[`Image concept ${i+1}`]=ic;});r['Call to action']=ag.callToAction||'';rows.push(r);});csvs.push({name:'06_Display_Remarketing',cols:DRCOLS,rows});}
    return csvs;
  }

  function toCSV(cols,rows){const esc=v=>{const s=String(v==null?'':v);return(s.includes(',')||s.includes('"')||s.includes('\n'))?'"'+s.replace(/"/g,'""')+'"':s;};return cols.map(esc).join(',')+'\n'+rows.map(r=>cols.map(c=>esc(r[c]||'')).join(',')).join('\n');}

  function exportStrategyDoc(){
    const g=gen;
    const biz=brief.businessName||'Client';
    const fu=brief.landingPage||brief.website||'';
    const curr=brief.currencySymbol;
    const today=new Date().toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric'});
    const totalEffBudget=selectedCampaignTypes.reduce((s,k)=>s+getEffectiveBudget(k),0);
    const ctMeta={
      branded:{label:'Branded Search',color:'#1a4b8c'},
      targetedSearch:{label:'Targeted Search',color:'#92400e'},
      pmax:{label:'Performance Max',color:'#5b21b6'},
      demandGen:{label:'Demand Gen',color:'#0e7490'},
      searchRemarketing:{label:'Search Remarketing (RLSA)',color:'#9f1239'},
      displayRemarketing:{label:'Display Remarketing',color:'#065f46'},
    };

    const adGroupHTML=(ag,showAudience=false)=>`
<div style="margin-bottom:20px;border:1px solid #e0e5ec;border-radius:8px;overflow:hidden">
  <div style="background:#f8f9fb;padding:11px 16px;display:flex;justify-content:space-between;border-bottom:1px solid #e5e8ee">
    <div>
      <div style="font-weight:700;font-size:14px">${ag.name}</div>
      ${showAudience&&ag.audienceList?`<div style="font-size:11px;color:#9f1239;margin-top:2px">Audience: ${ag.audienceList} ${ag.bidAdjustment?'('+ag.bidAdjustment+')':''}</div>`:''}
    </div>
    <div style="font-size:11px;color:#9aa5b0;text-align:right">${ag.keywords.length} keywords · CPC: ${curr}${(parseFloat(ag.defaultCpc)||10).toFixed(2)}</div>
  </div>
  <div style="padding:14px 16px">
    <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#9aa5b0;margin-bottom:7px">Keywords</div>
    <div style="display:flex;flex-wrap:wrap;gap:5px;margin-bottom:14px">
      ${(ag.keywords||[]).map(k=>{
        const vol=k.avgMonthlySearches;
        const volBadge=k.volumeChecked&&vol!==null?`<span style="font-size:9px;font-weight:700;padding:1px 5px;border-radius:8px;margin-left:3px;background:${vol>=1000?'#dcfce7':vol>=100?'#fef9c3':vol>=10?'#fff7ed':'#fef2f2'};color:${vol>=1000?'#166534':vol>=100?'#854d0e':vol>=10?'#9a3412':'#991b1b'};border:1px solid ${vol>=1000?'#bbf7d0':vol>=100?'#fde68a':vol>=10?'#fed7aa':'#fca5a5'}">${vol>=1000?(vol/1000).toFixed(1)+'k':vol===0?'0':vol+'/mo'}</span>`:'';
        return`<span style="padding:3px 9px;border-radius:12px;font-size:11px;font-family:monospace;${k.matchType==='Phrase'?'background:#f0fdf4;color:#166534;border:1px solid #bbf7d0':'background:#edf4ff;color:#1a4b8c;border:1px solid #c3d9fe'}">${k.matchType==='Exact'?`[${k.text}]`:`"${k.text}"`}${volBadge}</span>`;
      }).join('')}
    </div>
    ${(ag.ads||[]).map(ad=>`
    <div style="border:1px solid #e0e5ec;border-radius:7px;padding:14px;background:#fff">
      <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#9aa5b0;margin-bottom:8px">Responsive Search Ad — Preview</div>
      <div style="font-size:12px;color:#1a6e1a;margin-bottom:3px">${fu} › ${[ad.path1,ad.path2].filter(Boolean).join(' › ')}</div>
      <div style="font-size:17px;color:#1558d6;font-weight:400;margin-bottom:4px;line-height:1.35">${ad.headlines.slice(0,3).filter(Boolean).join(' | ')}</div>
      <div style="font-size:13px;color:#4d5156;margin-bottom:12px">${ad.descriptions.slice(0,2).filter(Boolean).join(' ')}</div>
      <div style="border-top:1px solid #f0f2f5;padding-top:10px">
        <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#9aa5b0;margin-bottom:6px">All Headlines (${ad.headlines.filter(Boolean).length}/15)</div>
        <table style="width:100%;border-collapse:collapse;font-size:12px;margin-bottom:10px">
          ${ad.headlines.map((h,i)=>h?`<tr style="${i%2?'background:#fafbfc':''}"><td style="padding:4px 8px;color:#9aa5b0;font-weight:700;font-size:10px;width:28px">H${i+1}</td><td style="padding:4px 8px;font-family:monospace">${h}</td></tr>`:'').filter(Boolean).join('')}
        </table>
        <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#9aa5b0;margin-bottom:6px">Descriptions (${ad.descriptions.filter(Boolean).length}/4)</div>
        <table style="width:100%;border-collapse:collapse;font-size:12px">
          ${ad.descriptions.map((d,i)=>d?`<tr style="${i%2?'background:#fafbfc':''}"><td style="padding:5px 8px;color:#9aa5b0;font-weight:700;font-size:10px;width:28px">D${i+1}</td><td style="padding:5px 8px">${d}</td></tr>`:'').filter(Boolean).join('')}
        </table>
      </div>
    </div>`).join('')}
  </div>
</div>`;

    let sections='';
    let sn=3;

    if(g.branded){
      sections+=`<div style="margin-bottom:48px">
  <div style="display:flex;align-items:flex-start;gap:14px;margin-bottom:20px;padding-bottom:14px;border-bottom:2px solid #f0f2f5">
    <div style="font-size:11px;font-weight:700;color:#e67e22;letter-spacing:1px;padding-top:5px">${String(sn++).padStart(2,'0')} —</div>
    <div style="font-family:'Playfair Display',serif;font-size:23px;font-weight:700">Branded Search Campaign</div>
  </div>
  <p style="font-size:13px;color:#5a6a7a;line-height:1.8;margin-bottom:20px;padding:13px 16px;background:#f8f9fc;border-radius:8px;border-left:3px solid #d0d5dd">The Branded Search campaign captures users searching for <strong>${biz}</strong> by name, protecting brand terms from competitors and typically achieving the highest Quality Scores and lowest CPCs in the account.</p>
  ${(g.branded.adGroups||[]).map(ag=>adGroupHTML(ag)).join('')}
</div>`;}

    if(g.targetedSearch){
      const ts=g.targetedSearch;
      const allKws=(ts.adGroups||[]).flatMap(ag=>ag.keywords||[]);
      const checked=allKws.filter(k=>k.volumeChecked);
      const withVol=checked.filter(k=>k.hasVolume);
      const healthPct=kwHealthPct(allKws);
      sections+=`<div style="margin-bottom:48px">
  <div style="display:flex;align-items:flex-start;gap:14px;margin-bottom:20px;padding-bottom:14px;border-bottom:2px solid #f0f2f5">
    <div style="font-size:11px;font-weight:700;color:#e67e22;letter-spacing:1px;padding-top:5px">${String(sn++).padStart(2,'0')} —</div>
    <div style="font-family:'Playfair Display',serif;font-size:23px;font-weight:700">Targeted Search Campaign</div>
  </div>
  <p style="font-size:13px;color:#5a6a7a;line-height:1.8;margin-bottom:20px;padding:13px 16px;background:#f8f9fc;border-radius:8px;border-left:3px solid #d0d5dd">The Targeted Search campaign captures high-intent buyers actively searching for the specific services offered by <strong>${biz}</strong>. Each ad group targets a single service ensuring maximum relevance between keyword, ad and landing page.</p>
  ${healthPct!==null?`<div style="background:#fff;border:1px solid #e5e8ee;border-radius:8px;padding:14px;margin-bottom:16px">
    <div style="font-size:12px;font-weight:700;color:#3a4a5a;margin-bottom:8px">📊 Keyword Volume Health (${(LOCATION_OPTIONS.find(o=>o.v===brief.locationCode)||{l:'Target Market'}).l})</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px">
      <span style="font-size:12px;padding:4px 10px;border-radius:10px;background:#dcfce7;color:#166534;border:1px solid #bbf7d0;font-weight:600">✓ ${withVol.length} have volume</span>
      <span style="font-size:12px;padding:4px 10px;border-radius:10px;background:#f0f2f5;color:#5a6a7a;border:1px solid #e0e5ec">${healthPct}% health score</span>
    </div>
    <div style="height:6px;background:#f0f2f5;border-radius:3px;overflow:hidden"><div style="height:100%;width:${healthPct}%;background:${healthPct>=80?'#059669':healthPct>=60?'#f59e0b':'#dc2626'};border-radius:3px"></div></div>
  </div>`:''}
  <div style="display:flex;gap:10px;margin-bottom:12px;font-size:11px;color:#6b7280;align-items:center">
    <span style="padding:3px 9px;border-radius:12px;font-family:monospace;background:#edf4ff;color:#1a4b8c;border:1px solid #c3d9fe">[exact match]</span> Matches precise search &nbsp;·&nbsp;
    <span style="padding:3px 9px;border-radius:12px;font-family:monospace;background:#f0fdf4;color:#166534;border:1px solid #bbf7d0">"phrase match"</span> Matches containing the phrase
  </div>
  ${(ts.adGroups||[]).map(ag=>adGroupHTML(ag)).join('')}
  ${ts.sitelinks?.length?`<div style="margin-top:20px;padding-top:18px;border-top:1px solid #f0f2f5">
    <div style="font-size:13px;font-weight:700;margin-bottom:10px">Sitelink Extensions</div>
    <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px">
      ${ts.sitelinks.map(sl=>`<div style="border:1px solid #e5e8ee;border-radius:7px;padding:11px 13px;background:#fafbfc"><div style="font-weight:700;font-size:13px;color:#1558d6;margin-bottom:3px">${sl.text}</div><div style="font-size:11px;color:#5a6a7a">${sl.description1}</div><div style="font-size:11px;color:#5a6a7a">${sl.description2}</div></div>`).join('')}
    </div></div>`:''}
  ${ts.callouts?.length?`<div style="margin-top:16px"><div style="font-size:13px;font-weight:700;margin-bottom:8px">Callout Extensions</div><div style="display:flex;flex-wrap:wrap;gap:6px">${ts.callouts.map(c=>`<span style="background:#f0fdf4;color:#166534;border:1px solid #bbf7d0;border-radius:14px;padding:4px 12px;font-size:12px">${c}</span>`).join('')}</div></div>`:''}
  ${ts.structuredSnippet?.values?.length?`<div style="margin-top:16px"><div style="font-size:13px;font-weight:700;margin-bottom:8px">Structured Snippet</div><div style="background:#f8f9fc;border:1px solid #e5e8ee;border-radius:7px;padding:11px 14px"><div style="font-size:12px;font-weight:700;color:#5a6a7a;margin-bottom:4px">${ts.structuredSnippet.header}:</div><div style="font-size:13px">${ts.structuredSnippet.values.join(' · ')}</div></div></div>`:''}
</div>`;}

    if(g.pmax){
      sections+=`<div style="margin-bottom:48px">
  <div style="display:flex;align-items:flex-start;gap:14px;margin-bottom:20px;padding-bottom:14px;border-bottom:2px solid #f0f2f5">
    <div style="font-size:11px;font-weight:700;color:#e67e22;letter-spacing:1px;padding-top:5px">${String(sn++).padStart(2,'0')} —</div>
    <div style="font-family:'Playfair Display',serif;font-size:23px;font-weight:700">Performance Max Campaign</div>
  </div>
  <p style="font-size:13px;color:#5a6a7a;line-height:1.8;margin-bottom:16px;padding:13px 16px;background:#f8f9fc;border-radius:8px;border-left:3px solid #d0d5dd">Performance Max is Google's AI-driven campaign type serving ads across Search, Display, YouTube, Discover, Gmail and Maps from a single campaign. No product feed required.</p>
  <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:12px 15px;font-size:13px;color:#78350f;margin-bottom:16px"><strong>Action Required:</strong> Image assets and your logo must be uploaded in Google Ads before this campaign can go live.</div>
  ${(g.pmax.assetGroups||[]).map(ag=>`
  <div style="border:1px solid #ddd6fe;border-radius:8px;overflow:hidden;margin-bottom:14px">
    <div style="background:#5b21b6;padding:11px 15px;color:white;font-weight:700;font-size:14px">${ag.name}</div>
    <div style="padding:15px">
      <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#9aa5b0;margin-bottom:6px">Audience Signals</div>
      <div style="margin-bottom:12px">${(ag.audienceSignals||[]).map(s=>`<span style="display:inline-block;padding:3px 9px;border-radius:11px;font-size:11px;background:#ede9fe;color:#5b21b6;border:1px solid #c4b5fd;margin:2px">${s}</span>`).join('')}</div>
      <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#9aa5b0;margin-bottom:6px">Headlines (15)</div>
      <table style="width:100%;border-collapse:collapse;font-size:12px;margin-bottom:12px">${(ag.headlines||[]).filter(Boolean).map((h,i)=>`<tr style="${i%2?'background:#fafbfc':''}"><td style="padding:4px 8px;color:#9aa5b0;font-size:10px;font-weight:700;width:28px">H${i+1}</td><td style="padding:4px 8px;font-family:monospace">${h}</td></tr>`).join('')}</table>
      <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#9aa5b0;margin-bottom:6px">Descriptions (5)</div>
      <table style="width:100%;border-collapse:collapse;font-size:12px">${(ag.descriptions||[]).filter(Boolean).map((d,i)=>`<tr style="${i%2?'background:#fafbfc':''}"><td style="padding:5px 8px;color:#9aa5b0;font-size:10px;font-weight:700;width:28px">D${i+1}</td><td style="padding:5px 8px">${d}</td></tr>`).join('')}</table>
    </div>
  </div>`).join('')}
</div>`;}

    if(g.searchRemarketing){
      sections+=`<div style="margin-bottom:48px">
  <div style="display:flex;align-items:flex-start;gap:14px;margin-bottom:20px;padding-bottom:14px;border-bottom:2px solid #f0f2f5">
    <div style="font-size:11px;font-weight:700;color:#e67e22;letter-spacing:1px;padding-top:5px">${String(sn++).padStart(2,'0')} —</div>
    <div style="font-family:'Playfair Display',serif;font-size:23px;font-weight:700">Search Remarketing — RLSA</div>
  </div>
  <p style="font-size:13px;color:#5a6a7a;line-height:1.8;margin-bottom:16px;padding:13px 16px;background:#f8f9fc;border-radius:8px;border-left:3px solid #d0d5dd">Re-engages past website visitors on Google Search with tailored messaging and adjusted bids, recovering prospects who did not convert on their first visit.</p>
  <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:12px 15px;font-size:13px;color:#78350f;margin-bottom:16px"><strong>Prerequisite:</strong> Remarketing audiences require 1,000+ users before activating on Search.</div>
  ${(g.searchRemarketing.adGroups||[]).map(ag=>adGroupHTML(ag,true)).join('')}
</div>`;}

    if(g.displayRemarketing){
      sections+=`<div style="margin-bottom:48px">
  <div style="display:flex;align-items:flex-start;gap:14px;margin-bottom:20px;padding-bottom:14px;border-bottom:2px solid #f0f2f5">
    <div style="font-size:11px;font-weight:700;color:#e67e22;letter-spacing:1px;padding-top:5px">${String(sn++).padStart(2,'0')} —</div>
    <div style="font-family:'Playfair Display',serif;font-size:23px;font-weight:700">Display Remarketing</div>
  </div>
  <p style="font-size:13px;color:#5a6a7a;line-height:1.8;margin-bottom:16px;padding:13px 16px;background:#f8f9fc;border-radius:8px;border-left:3px solid #d0d5dd">Keeps your brand visible by serving banner ads to past visitors across the Google Display Network.</p>
  ${(g.displayRemarketing.adGroups||[]).map(ag=>`
  <div style="border:1px solid #6ee7b7;border-radius:8px;overflow:hidden;margin-bottom:14px">
    <div style="background:#047857;padding:11px 15px;color:white;font-weight:700;font-size:14px">${ag.name}</div>
    <div style="padding:15px;background:#f0fdf4">
      <div style="font-size:12px;color:#5a6a7a;margin-bottom:10px">Audience: ${ag.audienceList} · Lookback: ${ag.audienceDuration} · Target CPM: ${curr}${ag.targetCPM}</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:10px">
        <div><div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#9aa5b0;margin-bottom:5px">Headlines</div>${(ag.headlines||[]).map(h=>`<div style="padding:3px 8px;background:#fff;border-radius:4px;font-size:12px;margin-bottom:3px;border:1px solid #e5e8ee">${h}</div>`).join('')}${ag.longHeadline?`<div style="padding:4px 8px;background:#ecfdf5;border-radius:4px;font-size:12px;margin-top:5px;font-style:italic;color:#047857"><b>Long:</b> ${ag.longHeadline}</div>`:''}</div>
        <div><div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#9aa5b0;margin-bottom:5px">Descriptions</div>${(ag.descriptions||[]).map(d=>`<div style="padding:3px 8px;background:#fff;border-radius:4px;font-size:12px;margin-bottom:3px;border:1px solid #e5e8ee">${d}</div>`).join('')}</div>
      </div>
      ${(ag.imageConcepts||[]).length?`<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#9aa5b0;margin-bottom:6px">Image Concepts</div>${(ag.imageConcepts||[]).map((ic,j)=>`<div style="padding:8px 11px;background:#fef9c3;border:1px solid #fde68a;border-radius:6px;font-size:12px;color:#78350f;margin-bottom:5px">${j+1}. ${ic}</div>`).join('')}`:''}
    </div>
  </div>`).join('')}
</div>`;}

    if(g.demandGen){
      sections+=`<div style="margin-bottom:48px">
  <div style="display:flex;align-items:flex-start;gap:14px;margin-bottom:20px;padding-bottom:14px;border-bottom:2px solid #f0f2f5">
    <div style="font-size:11px;font-weight:700;color:#e67e22;letter-spacing:1px;padding-top:5px">${String(sn++).padStart(2,'0')} —</div>
    <div style="font-family:'Playfair Display',serif;font-size:23px;font-weight:700">Demand Generation Campaign</div>
  </div>
  <p style="font-size:13px;color:#5a6a7a;line-height:1.8;margin-bottom:16px;padding:13px 16px;background:#f8f9fc;border-radius:8px;border-left:3px solid #d0d5dd">Reaches prospective customers across YouTube, Google Discover and Gmail before they begin actively searching, building brand awareness.</p>
  ${(g.demandGen.adGroups||[]).map(ag=>`
  <div style="border:1px solid #a5f3fc;border-radius:8px;overflow:hidden;margin-bottom:14px">
    <div style="background:#0e7490;padding:11px 15px;color:white;font-weight:700;font-size:14px">${ag.audienceTheme}</div>
    <div style="padding:15px;background:#f0fdfe">
      <div style="margin-bottom:10px">${(ag.audienceTargeting||[]).map(a=>`<span style="display:inline-block;padding:3px 9px;border-radius:11px;font-size:11px;background:#cffafe;color:#0e7490;border:1px solid #67e8f9;margin:2px">${a}</span>`).join('')}</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:10px">
        <div><div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#9aa5b0;margin-bottom:5px">Headlines</div>${(ag.headlines||[]).map(h=>`<div style="padding:3px 8px;background:#fff;border-radius:4px;font-size:12px;margin-bottom:3px;border:1px solid #e5e8ee">${h}</div>`).join('')}</div>
        <div><div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#9aa5b0;margin-bottom:5px">Gmail Subject Lines</div>${(ag.gmailSubjectLines||[]).map(s=>`<div style="padding:3px 8px;background:#fef9c3;border-radius:4px;font-size:12px;margin-bottom:3px">${s}</div>`).join('')}</div>
      </div>
      ${ag.videoConceptBrief?`<div style="padding:10px 13px;background:#f0fdf4;border-left:3px solid #34d399;border-radius:0 6px 6px 0;font-size:12px;color:#065f46"><strong>Video Concept:</strong> ${ag.videoConceptBrief}</div>`:''}
    </div>
  </div>`).join('')}
</div>`;}

    const allNegs=[...new Set([...(g.branded?.negatives||[]),...(g.targetedSearch?.negatives||[])])];
    if(allNegs.length){
      sections+=`<div style="margin-bottom:48px">
  <div style="display:flex;align-items:flex-start;gap:14px;margin-bottom:20px;padding-bottom:14px;border-bottom:2px solid #f0f2f5">
    <div style="font-size:11px;font-weight:700;color:#e67e22;letter-spacing:1px;padding-top:5px">${String(sn++).padStart(2,'0')} —</div>
    <div style="font-family:'Playfair Display',serif;font-size:23px;font-weight:700">Negative Keywords &amp; Brand Safety</div>
  </div>
  <p style="font-size:13px;color:#5a6a7a;line-height:1.8;margin-bottom:16px">These terms are applied as phrase-match negatives across all Search campaigns.</p>
  <div style="display:flex;flex-wrap:wrap;gap:5px">${allNegs.map(n=>`<span style="padding:3px 9px;border-radius:11px;font-size:11px;font-family:monospace;background:#fef2f2;color:#991b1b;border:1px solid #fca5a5">${n}</span>`).join('')}</div>
</div>`;}

    sections+=`<div style="margin-bottom:48px">
  <div style="display:flex;align-items:flex-start;gap:14px;margin-bottom:20px;padding-bottom:14px;border-bottom:2px solid #f0f2f5">
    <div style="font-size:11px;font-weight:700;color:#e67e22;letter-spacing:1px;padding-top:5px">${String(sn++).padStart(2,'0')} —</div>
    <div style="font-family:'Playfair Display',serif;font-size:23px;font-weight:700">Tracking Requirements</div>
  </div>
  <p style="font-size:13px;color:#5a6a7a;line-height:1.8;margin-bottom:16px">Tracking setup required before campaigns go live. Smart Bidding cannot optimise without accurate conversion data.</p>
  <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#9aa5b0;margin-bottom:10px">Foundation (Required Before Launch)</div>
  <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:20px">
    ${[
      ['Google Ads Conversion Pixel','Tracks form submissions, calls, and key page visits. Install via GTM or site plugin.','🔴 Critical'],
      ['Google Tag Manager (GTM)','Container for all tracking tags.','🔴 Critical'],
      ['Conversion Action — Form Submission','Set up a conversion action for each lead form. Set to "Primary".','🔴 Critical'],
      ['Phone Call Conversion','If phone is a primary conversion, use Google forwarding numbers or CallRail.','🟡 Recommended'],
      ['Google Analytics 4 (GA4) Linked','Link GA4 to Google Ads for audience creation and reporting.','🟡 Recommended'],
    ].map(([name,desc,priority],i)=>`<tr style="background:${i%2?'#fff':'#f8f9fc'}"><td style="padding:10px 14px;font-weight:600;border-bottom:1px solid #f0f2f5;width:220px">${name}</td><td style="padding:10px 14px;color:#5a6a7a;border-bottom:1px solid #f0f2f5;font-size:12px">${desc}</td><td style="padding:10px 14px;border-bottom:1px solid #f0f2f5;font-size:11px;font-weight:700;white-space:nowrap">${priority}</td></tr>`).join('')}
  </table>
  <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#9aa5b0;margin-bottom:10px">Enhancement (Add After Launch)</div>
  <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:16px">
    ${[
      ['Enhanced Conversions','Sends hashed first-party data with conversion events.','🟢 High Value'],
      ['Offline Conversion Tracking (OCT)','Import qualified leads and closed deals from CRM back into Google Ads.','🟢 High Value'],
      ['Remarketing Audiences','Tag site visitors with audience lists. Required for RLSA and Display.','🟢 Required for Remarketing'],
      ['Data-Driven Attribution','Set attribution model to Data-Driven in conversion settings.','🟡 Recommended'],
    ].map(([name,desc,priority],i)=>`<tr style="background:${i%2?'#fff':'#f8f9fc'}"><td style="padding:10px 14px;font-weight:600;border-bottom:1px solid #f0f2f5;width:220px">${name}</td><td style="padding:10px 14px;color:#5a6a7a;border-bottom:1px solid #f0f2f5;font-size:12px">${desc}</td><td style="padding:10px 14px;border-bottom:1px solid #f0f2f5;font-size:11px;font-weight:700;white-space:nowrap">${priority}</td></tr>`).join('')}
  </table>
  <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:12px 15px;font-size:13px;color:#78350f"><strong>Important:</strong> Do not enable Smart Bidding strategies until at least 30 conversions have been recorded in a 30-day period.</div>
</div>`;

    sections+=`<div style="margin-bottom:48px">
  <div style="display:flex;align-items:flex-start;gap:14px;margin-bottom:20px;padding-bottom:14px;border-bottom:2px solid #f0f2f5">
    <div style="font-size:11px;font-weight:700;color:#e67e22;letter-spacing:1px;padding-top:5px">${String(sn++).padStart(2,'0')} —</div>
    <div style="font-family:'Playfair Display',serif;font-size:23px;font-weight:700">Launch Sequence &amp; Milestones</div>
  </div>
  <p style="font-size:13px;color:#5a6a7a;line-height:1.8;margin-bottom:20px">Campaigns should be enabled in phases. Each phase builds the data foundation needed for the next.</p>
  <div style="display:flex;flex-direction:column;gap:4px">
    ${[
      ['Week 1','🟢 Enable Now','Enable Branded + Targeted Search','Maximise Conversions bidding. Verify conversion tracking. Monitor search terms daily.','#059669','#dcfce7','#bbf7d0'],
      ['Week 2–4','🟡 Review','Keyword & Copy Refinement','Review search term reports. Pause zero-impression keywords. Add negatives. Check ad copy performance.','#d97706','#fef9c3','#fde68a'],
      ['Month 2 (30+ conversions)','🔵 Milestone','Enable PMax + RLSA','Enable PMax with brand exclusions. Enable RLSA once audience has 1,000 members. Migrate to Target CPA.','#2563eb','#eff6ff','#bfdbfe'],
      ['Month 3 (50+ conversions)','🟣 Scale','Enable Display + Demand Gen','Launch Display Remarketing. Enable Demand Gen for upper-funnel. Optimise PMax asset groups.','#7c3aed','#f5f3ff','#ddd6fe'],
      ['Ongoing','⚙️ Continuous','Optimise, Test, Scale','Monthly: bid targets, budget allocation, performance. Quarterly: full account audit.','#374151','#f9fafb','#e5e7eb'],
    ].map(([phase,status,title,desc,color,bg,border])=>`
    <div style="display:flex;gap:0;margin-bottom:8px">
      <div style="width:160px;flex-shrink:0;padding:14px 16px;background:${bg};border:1px solid ${border};border-right:none;border-radius:8px 0 0 8px">
        <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:${color};margin-bottom:4px">${phase}</div>
        <div style="font-size:11px;font-weight:700;color:${color}">${status}</div>
      </div>
      <div style="flex:1;padding:14px 16px;background:#fff;border:1px solid ${border};border-radius:0 8px 8px 0">
        <div style="font-weight:700;font-size:13px;color:#1a2a3a;margin-bottom:4px">${title}</div>
        <div style="font-size:12px;color:#5a6a7a;line-height:1.6">${desc}</div>
      </div>
    </div>`).join('')}
  </div>
</div>`;

    sections+=`<div style="margin-bottom:48px">
  <div style="display:flex;align-items:flex-start;gap:14px;margin-bottom:20px;padding-bottom:14px;border-bottom:2px solid #f0f2f5">
    <div style="font-size:11px;font-weight:700;color:#e67e22;letter-spacing:1px;padding-top:5px">${String(sn++).padStart(2,'0')} —</div>
    <div style="font-family:'Playfair Display',serif;font-size:23px;font-weight:700">Optimization Cadence</div>
  </div>
  <p style="font-size:13px;color:#5a6a7a;line-height:1.8;margin-bottom:20px">Consistent account management is the difference between a campaign that grinds forward and one that compounds.</p>
  <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px">
    ${[
      ['📅 Weekly','#1a4b8c','#edf4ff','#b8d4fe',['Review search term report — add negatives','Check for disapproved ads','Monitor conversion volume','Check budget utilisation','Avoid changes on Learning campaigns']],
      ['📆 Monthly','#6d28d9','#f5f3ff','#ddd6fe',['Adjust bid targets (≤20% per change)','Pause poor performers','Check ad copy asset ratings','Rebalance budget by CPA','Add new keywords from search terms']],
      ['🗓️ Quarterly','#047857','#f0fdf4','#bbf7d0',['Full account structure audit','Verify conversion tracking accuracy','Refresh ad copy','Review negative lists','Update audience lists','Check Quality Scores']],
    ].map(([title,color,bg,border,items])=>`<div style="background:${bg};border:1px solid ${border};border-radius:10px;padding:18px">
      <div style="font-weight:700;font-size:15px;color:${color};margin-bottom:12px">${title}</div>
      <ul style="list-style:none;padding:0">${items.map(item=>`<li style="padding:5px 0;border-bottom:1px solid ${border};font-size:12px;color:#3a4a5a;display:flex;gap:8px;align-items:flex-start"><span style="color:${color};font-weight:700;flex-shrink:0">✓</span>${item}</li>`).join('')}</ul>
    </div>`).join('')}
  </div>
</div>`;

    sections+=`<div style="margin-bottom:48px">
  <div style="display:flex;align-items:flex-start;gap:14px;margin-bottom:20px;padding-bottom:14px;border-bottom:2px solid #f0f2f5">
    <div style="font-size:11px;font-weight:700;color:#e67e22;letter-spacing:1px;padding-top:5px">${String(sn++).padStart(2,'0')} —</div>
    <div style="font-family:'Playfair Display',serif;font-size:23px;font-weight:700">Audience Strategy</div>
  </div>
  <p style="font-size:13px;color:#5a6a7a;line-height:1.8;margin-bottom:20px">Build from the inside out — warmer audiences convert better and cost less.</p>
  <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:20px">
    <thead><tr style="background:#0f1a2a"><th style="text-align:left;padding:10px 13px;color:rgba(168,200,255,0.9);font-size:11px;text-transform:uppercase">Temperature</th><th style="text-align:left;padding:10px 13px;color:rgba(168,200,255,0.9);font-size:11px;text-transform:uppercase">Audience</th><th style="text-align:left;padding:10px 13px;color:rgba(168,200,255,0.9);font-size:11px;text-transform:uppercase">Campaign</th><th style="text-align:left;padding:10px 13px;color:rgba(168,200,255,0.9);font-size:11px;text-transform:uppercase">Messaging</th><th style="text-align:left;padding:10px 13px;color:rgba(168,200,255,0.9);font-size:11px;text-transform:uppercase">Prereq</th></tr></thead>
    <tbody>
      ${[
        ['🔥 Hot','Contact Page Visitors (7 days)','RLSA + Display','Close them. Urgency + risk removal.','1,000+ members'],
        ['🌡️ Warm','All Website Visitors (30 days)','RLSA + Display','Re-engage. Trust-building + soft nudge.','1,000+ members'],
        ['❄️ Cool','Custom Intent: Competitor URLs','PMax + Demand Gen','Differentiate. Position against alternatives.','Audience Manager'],
        ['🧊 Cold','In-Market: Relevant Categories','PMax + Demand Gen','Build awareness. Aspirational copy.','None'],
        ['🌐 Prospecting','Active Search Keywords','Branded + Targeted Search','Match intent. Direct response.','None'],
      ].map(([temp,type,camp,msg,req],i)=>`<tr style="background:${i%2?'#fff':'#f8f9fc'}"><td style="padding:10px 13px;font-weight:700;border-bottom:1px solid #f0f2f5">${temp}</td><td style="padding:10px 13px;border-bottom:1px solid #f0f2f5;font-size:12px">${type}</td><td style="padding:10px 13px;border-bottom:1px solid #f0f2f5;font-size:12px;color:#6d28d9">${camp}</td><td style="padding:10px 13px;border-bottom:1px solid #f0f2f5;font-size:12px;color:#5a6a7a">${msg}</td><td style="padding:10px 13px;border-bottom:1px solid #f0f2f5;font-size:11px;color:#dc2626">${req}</td></tr>`).join('')}
    </tbody>
  </table>
  <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:12px 15px;font-size:13px;color:#78350f;margin-bottom:12px"><strong>Customer Match:</strong> Upload existing customer email list to Google Ads (Audience Manager → Customer Match). Highest-quality PMax signal. Min 1,000 matched users; 5,000+ recommended.</div>
  <div style="background:#edf4ff;border:1px solid #b8d4fe;border-radius:8px;padding:12px 15px;font-size:13px;color:#1a4b8c"><strong>Exclusion Strategy:</strong> Exclude "Converted — Last 30 Days" from prospecting. Exclude warmer audiences from colder campaigns to prevent overlap.</div>
</div>`;

    if(selectedCampaignTypes.includes('targetedSearch')){
    sections+=`<div style="margin-bottom:48px">
  <div style="display:flex;align-items:flex-start;gap:14px;margin-bottom:20px;padding-bottom:14px;border-bottom:2px solid #f0f2f5">
    <div style="font-size:11px;font-weight:700;color:#e67e22;letter-spacing:1px;padding-top:5px">${String(sn++).padStart(2,'0')} —</div>
    <div style="font-family:'Playfair Display',serif;font-size:23px;font-weight:700">Dynamic Search Ads (DSA) — Recommended</div>
  </div>
  <p style="font-size:13px;color:#5a6a7a;line-height:1.8;margin-bottom:16px">DSA automatically generates ad headlines from website content, filling keyword coverage gaps and uncovering new search terms.</p>
  <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:16px 18px;margin-bottom:16px">
    <div style="font-weight:700;font-size:13px;color:#166534;margin-bottom:10px">Why Add DSA:</div>
    <ul style="list-style:none;padding:0">${['Catches long-tail searches not explicitly targeted','Google auto-generates headlines from landing pages','Reveals real searches for migration to exact-match','Typically lower CPCs than exact-match','Works best with clear, descriptive site copy'].map(item=>`<li style="padding:5px 0;border-bottom:1px solid #dcfce7;font-size:12px;color:#166534;display:flex;gap:8px"><span style="font-weight:700">✓</span>${item}</li>`).join('')}</ul>
  </div>
  <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#9aa5b0;margin-bottom:10px">Setup</div>
  <table style="width:100%;border-collapse:collapse;font-size:13px">
    ${[
      ['Campaign','Add as ad group within Targeted Search, or separate DSA campaign'],
      ['Website target','All web pages or specific URL paths'],
      ['Descriptions','2 descriptions ≤90 chars — headlines auto-generated'],
      ['Negatives','Add all exact-match keywords as negatives to prevent overlap'],
      ['Budget','Start with 10-15% of Targeted Search budget'],
      ['Monitoring','Review search terms weekly — migrate performers to exact-match'],
    ].map(([step,desc],i)=>`<tr style="background:${i%2?'#fff':'#f8f9fc'}"><td style="padding:10px 14px;font-weight:600;border-bottom:1px solid #f0f2f5;width:160px">${step}</td><td style="padding:10px 14px;color:#5a6a7a;border-bottom:1px solid #f0f2f5;font-size:12px">${desc}</td></tr>`).join('')}
  </table>
</div>`;}

    const extraSections=['Tracking Requirements','Launch Sequence &amp; Milestones','Optimization Cadence','Audience Strategy','DSA Recommendation'];
    const tocItems=[
      ['01','Executive Summary &amp; Objectives'],
      ['02','Budget Allocation &amp; Campaign Mix'],
      ...selectedCampaignTypes.map((k,i)=>[String(i+3).padStart(2,'0'),ctMeta[k]?.label||k]),
      [String(selectedCampaignTypes.length+3).padStart(2,'0'),'Negative Keywords &amp; Brand Safety'],
      ...extraSections.map((s,i)=>[String(selectedCampaignTypes.length+4+i).padStart(2,'0'),s]),
    ];

    const html=`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Google Ads Strategy — ${biz}</title>
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,wght@0,400;0,500;0,600;0,700;1,400&family=Playfair+Display:wght@700&display=swap" rel="stylesheet"/>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:'DM Sans',sans-serif;background:#f4f5f7;color:#1a2a3a;line-height:1.75;font-size:14px}
  .page{max-width:900px;margin:0 auto;background:#fff;box-shadow:0 0 60px rgba(0,0,0,0.08)}
  @media print{body{background:#fff}.page{box-shadow:none;max-width:100%}.no-print{display:none!important}@page{margin:18mm 20mm;size:A4}}
  .print-btn{position:fixed;bottom:28px;right:28px;background:#0f1a2a;color:white;border:none;padding:13px 22px;border-radius:10px;font-size:13px;font-weight:700;cursor:pointer;box-shadow:0 4px 20px rgba(0,0,0,0.3);font-family:'DM Sans',sans-serif;z-index:999}
</style>
</head>
<body>
<div class="page">
<div style="background:#0f1a2a;color:white;padding:68px 60px 52px;position:relative;overflow:hidden">
  <div style="position:absolute;right:0;top:0;width:320px;height:100%;background:linear-gradient(135deg,rgba(230,126,34,0.12),rgba(241,196,15,0.06));clip-path:polygon(30% 0,100% 0,100% 100%,0% 100%)"></div>
  <div style="position:absolute;right:60px;bottom:52px;width:76px;height:76px;border-radius:18px;background:linear-gradient(135deg,#e67e22,#f1c40f);display:flex;align-items:center;justify-content:center;font-size:36px;font-weight:800;color:white">S</div>
  <div style="font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#e67e22;margin-bottom:16px">Prepared by Syte Digital</div>
  <div style="font-family:'Playfair Display',serif;font-size:40px;font-weight:700;line-height:1.15;margin-bottom:8px">Google Ads Strategy</div>
  <div style="font-family:'Playfair Display',serif;font-size:40px;font-weight:700;color:#e67e22;margin-bottom:10px">${biz}</div>
  <div style="font-size:15px;color:rgba(255,255,255,0.5);margin-bottom:44px;font-style:italic">Campaign Structure, Ad Copy &amp; Budget Recommendations</div>
  <div style="width:44px;height:3px;background:linear-gradient(90deg,#e67e22,#f39c12);border-radius:2px;margin-bottom:30px"></div>
  <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:22px;border-top:1px solid rgba(255,255,255,0.1);padding-top:26px">
    ${[['Date Prepared',today],['Total Daily Budget',`${curr}${brief.dailyBudget} per day`],['Campaigns Included',`${selectedCampaignTypes.length} campaign type${selectedCampaignTypes.length!==1?'s':''}`],['Target Market',(brief.locations||[]).filter(l=>l.mode==='include').map(l=>l.type==='radius'?`${l.radius}${l.unit} · ${l.label}`:l.name).join(', ')||'—'],['Website',fu||brief.website||'—'],['Document Status','For Client Review']].map(([l,v])=>`<div><div style="font-size:10px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:rgba(255,255,255,0.35);margin-bottom:4px">${l}</div><div style="font-size:13px;font-weight:600;color:rgba(255,255,255,0.9);word-break:break-all">${v}</div></div>`).join('')}
  </div>
</div>
<div style="padding:52px 60px">
<div style="background:#f8f9fc;border-left:4px solid #0f1a2a;padding:26px 30px;margin-bottom:48px">
  <div style="font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#9aa5b0;margin-bottom:16px">Table of Contents</div>
  ${tocItems.map(([n,l])=>`<div style="display:flex;align-items:baseline;padding:5px 0;border-bottom:1px dotted #e0e5ec"><span style="font-size:11px;font-weight:700;color:#e67e22;width:26px;flex-shrink:0">${n}</span><span style="font-size:13px;color:#3a4a5a">${l}</span></div>`).join('')}
</div>
<div style="margin-bottom:48px">
  <div style="display:flex;align-items:flex-start;gap:14px;margin-bottom:20px;padding-bottom:14px;border-bottom:2px solid #f0f2f5">
    <div style="font-size:11px;font-weight:700;color:#e67e22;letter-spacing:1px;padding-top:5px">01 —</div>
    <div style="font-family:'Playfair Display',serif;font-size:23px;font-weight:700">Executive Summary &amp; Objectives</div>
  </div>
  <p style="font-size:14px;color:#5a6a7a;line-height:1.8;margin-bottom:20px">This document outlines the proposed Google Ads strategy for <strong>${biz}</strong>. All campaigns are configured in <strong>Paused</strong> status and ready for review prior to launch.</p>
  <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:20px">
    ${[['Business',biz],['Industry',brief.industry||'—'],['Website',fu||brief.website||'—'],['Target Customer',brief.targetCustomer||'—'],['Business Type',brief.businessType==='ecommerce'?'🛍️ Ecommerce (Online Sales)':brief.businessType==='hybrid'?'🔀 Hybrid (Services + Ecommerce)':'🎯 Lead Generation (Enquiries & Calls)'],['Strategic Focus',campaignAngle||'Direct response — maximise qualified lead volume'],['Target Locations',(brief.locations||[]).map(l=>`${l.mode==='exclude'?'✕ ':''}${l.type==='radius'?`${l.radius}${l.unit} · ${l.label}`:l.name}`).join(', ')||'—'],['Ad Language',brief.language==='en'?'English':brief.language]].map(([k,v],i)=>`<tr style="background:${i%2?'#fff':'#f8f9fc'}"><td style="padding:10px 14px;font-weight:600;color:#6b7280;width:180px;border-bottom:1px solid #f0f2f5">${k}</td><td style="padding:10px 14px;border-bottom:1px solid #f0f2f5">${v}</td></tr>`).join('')}
  </table>
  ${brief.usps?`<div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#9aa5b0;margin-bottom:10px">Key Value Propositions</div><ul style="list-style:none;padding:0">${brief.usps.split('\n').filter(Boolean).map(u=>`<li style="padding:7px 0 7px 18px;position:relative;font-size:13px;color:#3a4a5a;border-bottom:1px solid #f5f6f8"><span style="position:absolute;left:0;top:15px;width:6px;height:6px;border-radius:50%;background:#e67e22;display:inline-block"></span>${u}</li>`).join('')}</ul>`:''}
  ${brief.description?`<div style="margin-top:18px;padding:13px 16px;background:#f8f9fc;border-radius:8px;border-left:3px solid #d0d5dd;font-size:13px;color:#5a6a7a;line-height:1.8"><strong>Business Overview:</strong> ${brief.description}</div>`:''}
</div>
<div style="margin-bottom:48px">
  <div style="display:flex;align-items:flex-start;gap:14px;margin-bottom:20px;padding-bottom:14px;border-bottom:2px solid #f0f2f5">
    <div style="font-size:11px;font-weight:700;color:#e67e22;letter-spacing:1px;padding-top:5px">02 —</div>
    <div style="font-family:'Playfair Display',serif;font-size:23px;font-weight:700">Budget Allocation &amp; Campaign Mix</div>
  </div>
  <p style="font-size:14px;color:#5a6a7a;line-height:1.8;margin-bottom:20px">Total daily budget of <strong>${curr}${brief.dailyBudget}</strong> allocated across ${selectedCampaignTypes.length} campaign type${selectedCampaignTypes.length!==1?'s':''}.</p>
  <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:18px">
    <thead><tr style="background:#0f1a2a"><th style="text-align:left;padding:10px 13px;color:rgba(168,200,255,0.9);font-size:11px;text-transform:uppercase">Campaign</th><th style="text-align:left;padding:10px 13px;color:rgba(168,200,255,0.9);font-size:11px;text-transform:uppercase">Type</th><th style="text-align:left;padding:10px 13px;color:rgba(168,200,255,0.9);font-size:11px;text-transform:uppercase">Daily Budget</th><th style="text-align:left;padding:10px 13px;color:rgba(168,200,255,0.9);font-size:11px;text-transform:uppercase">Share</th><th style="text-align:left;padding:10px 13px;color:rgba(168,200,255,0.9);font-size:11px;text-transform:uppercase">Bid Strategy</th></tr></thead>
    <tbody>
      ${selectedCampaignTypes.map((key,i)=>{
        const amt=getEffectiveBudget(key);
        const pct=totalEffBudget>0?Math.round((amt/totalEffBudget)*100):0;
        const strats={branded:'Target Impression Share',targetedSearch:brief.bidStrategy||'Maximize Conversions',pmax:'Maximize Conversions',demandGen:'Maximize Conversions',searchRemarketing:'Maximize Conversions',displayRemarketing:'Target CPM'};
        const types={branded:'Google Search',targetedSearch:'Google Search',pmax:'Performance Max',demandGen:'Demand Gen',searchRemarketing:'Google Search',displayRemarketing:'Google Display'};
        return`<tr style="background:${i%2?'#fff':'#f8f9fc'}"><td style="padding:10px 13px;font-weight:600;border-bottom:1px solid #f0f2f5">${ctMeta[key]?.label||key}</td><td style="padding:10px 13px;color:#6b7280;border-bottom:1px solid #f0f2f5">${types[key]||'Search'}</td><td style="padding:10px 13px;font-weight:700;border-bottom:1px solid #f0f2f5">${curr}${amt}</td><td style="padding:10px 13px;color:#6b7280;border-bottom:1px solid #f0f2f5">${pct}%</td><td style="padding:10px 13px;font-size:12px;color:#6b7280;border-bottom:1px solid #f0f2f5">${strats[key]||'Maximize Conversions'}</td></tr>`;
      }).join('')}
      <tr style="background:#f8f9fc"><td colspan="2" style="padding:10px 13px;font-weight:700;border-top:2px solid #e0e5ec">Total</td><td style="padding:10px 13px;font-weight:700;font-size:14px;border-top:2px solid #e0e5ec">${curr}${totalEffBudget}</td><td style="padding:10px 13px;font-weight:700;border-top:2px solid #e0e5ec">100%</td><td style="border-top:2px solid #e0e5ec"></td></tr>
    </tbody>
  </table>
  <div style="background:#edf4ff;border:1px solid #b8d4fe;border-radius:8px;padding:12px 15px;font-size:13px;color:#1a4b8c;line-height:1.7"><strong>Launch Sequence:</strong> Enable Branded Search first, then Targeted Search in week one. Enable Performance Max and remarketing after 2–4 weeks of conversion data.</div>
  <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:12px 15px;font-size:13px;color:#166534;line-height:1.8;margin-top:10px"><strong>Bidding Progression:</strong> Start on <strong>Maximize Conversions</strong>. Once a campaign reaches <strong>30+ conversions/month</strong>, migrate to <strong>Target CPA</strong>. Make adjustments under 25% at a time.</div>
</div>
${sections}
</div>
<div style="background:#0f1a2a;padding:32px 60px;display:flex;justify-content:space-between;align-items:center">
  <div><div style="color:white;font-size:15px;font-weight:700">Syte Digital</div><div style="color:rgba(255,255,255,0.4);font-size:12px;margin-top:3px">Google Ads Strategy · ${today}</div></div>
  <div style="font-size:11px;color:rgba(255,255,255,0.3);text-align:right">Confidential &amp; Proprietary<br>For client review only</div>
</div>
</div>
<button class="print-btn no-print" onclick="window.print()">🖨️ Print / Save as PDF</button>
</body></html>`;

    const blob=new Blob([html],{type:'text/html;charset=utf-8;'});
    const slug=(biz||'campaign').replace(/\s+/g,'_').toLowerCase();
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');a.href=url;a.download=`${slug}_google_ads_strategy.html`;
    document.body.appendChild(a);a.click();document.body.removeChild(a);
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  }

  function downloadSingleCSV(name,cols,rows){
    const slug=(brief.businessName||'campaign').replace(/\s+/g,'_').toLowerCase();
    const blob=new Blob(['\ufeff'+toCSV(cols,rows)],{type:'text/csv;charset=utf-8;'});
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');a.href=url;a.download=`${slug}_${name}.csv`;
    document.body.appendChild(a);a.click();document.body.removeChild(a);
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  }

  async function downloadAllCSVs(){
    const csvs=buildAllCSVs();
    for(let i=0;i<csvs.length;i++){
      const {name,cols,rows}=csvs[i];
      downloadSingleCSV(name,cols,rows);
      await new Promise(res=>setTimeout(res,1200));
    }
  }

  function Err(){return error?(<div style={{padding:'12px 16px',borderRadius:8,fontSize:13,marginBottom:16,background:'#fef2f2',border:'1px solid #fca5a5',color:'#991b1b',display:'flex',justifyContent:'space-between'}}><div><b>⚠️ </b>{error}</div><span style={{cursor:'pointer',fontWeight:700,marginLeft:12}} onClick={()=>setError(null)}>×</span></div>):null;}

  if(state==='scanning'){
    return(
      <div><Hdr step={1}/>
      <div style={{maxWidth:700,margin:'0 auto',padding:'80px 24px',textAlign:'center'}}>
        <div style={{width:56,height:56,border:'4px solid #e5e8ee',borderTopColor:'#e67e22',borderRadius:'50%',animation:'spin 0.8s linear infinite',margin:'0 auto 20px'}}/>
        <div style={{fontSize:17,fontWeight:700,color:'#1a2a3a',marginBottom:8}}>{brief.website?`Scanning ${brief.website}`:'Analysing transcript...'}</div>
        <div style={{fontSize:13,color:'#7a8a9a'}}>{brief.website?'AI is visiting the site — 20–40 seconds...':'Extracting services, USPs and campaign context — ~15 seconds...'}</div>
      </div></div>
    );
  }

  if(state==='steer'&&scanResult){
    const sr=scanResult;
    const allSvcs=sr.detectedServices||[];
    const selectedSvcCount=selectedSvcs.length+(customSvcs.split('\n').filter(s=>s.trim()).length);
    return(
      <div><Hdr step={2}/>
      <div style={{maxWidth:860,margin:'0 auto',padding:24}}>
        <Err/>
        <div style={{background:'#fff',border:'1px solid #e5e8ee',borderRadius:12,padding:24,marginBottom:20}}>
          <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',gap:16,flexWrap:'wrap',marginBottom:16}}>
            <div>
              <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:4}}>
                <div style={{fontSize:11,fontWeight:700,padding:'3px 10px',borderRadius:12,background:sr.confidence==='high'?'#dcfce7':sr.confidence==='medium'?'#fef9c3':'#fee2e2',color:sr.confidence==='high'?'#166534':sr.confidence==='medium'?'#854d0e':'#991b1b'}}>
                  {sr.confidence==='high'?'✓ HIGH':sr.confidence==='medium'?'⚠ MEDIUM':'⚠ LOW'} CONFIDENCE {sr.source==='transcript'?'TRANSCRIPT':'SCAN'}
                </div>
                {sr.source==='transcript'&&<div style={{fontSize:11,fontWeight:700,padding:'3px 10px',borderRadius:12,background:'#f5f3ff',color:'#5b21b6',border:'1px solid #ddd6fe'}}>🎙️ From Transcript</div>}
                {sr.source==='website'&&transcript.trim()&&<div style={{fontSize:11,fontWeight:700,padding:'3px 10px',borderRadius:12,background:'#ecfdf5',color:'#065f46',border:'1px solid #a7f3d0'}}>+ Transcript</div>}
              </div>
              <div style={{fontFamily:"'Playfair Display',serif",fontSize:22,fontWeight:700}}>{sr.businessName}</div>
              <div style={{fontSize:13,color:'#5a6a7a',marginTop:4,maxWidth:540}}>{sr.description}</div>
              {(()=>{
                const ts=brief.trustSignals||{};
                const chips=[];
                if(ts.rating&&ts.reviewCount) chips.push(`⭐ ${ts.rating} from ${ts.reviewCount} reviews${ts.reviewPlatform?' ('+ts.reviewPlatform+')':''}`);
                else if(ts.rating) chips.push(`⭐ ${ts.rating}★ rating`);
                if(ts.yearsInBusiness) chips.push(`🏆 ${ts.yearsInBusiness} years in business`);
                if(ts.clientCount) chips.push(`👥 ${ts.clientCount} clients`);
                if(ts.certifications&&ts.certifications.length) chips.push(...ts.certifications.slice(0,2).map(c=>`✓ ${c}`));
                if(!chips.length) return null;
                return <div style={{display:'flex',flexWrap:'wrap',gap:6,marginTop:8}}>{chips.map((c,i)=><span key={i} style={{fontSize:11,fontWeight:600,padding:'3px 10px',borderRadius:10,background:'#f0fdf4',color:'#166534',border:'1px solid #bbf7d0'}}>{c}</span>)}</div>;
              })()}
            </div>
            <button onClick={()=>{setState('brief');setScanResult(null);}} style={{padding:'7px 14px',borderRadius:8,border:'1px solid #e0e5ec',background:'#f8f9fc',color:'#5a6a7a',fontSize:12,fontWeight:600,cursor:'pointer'}}>← Edit Brief</button>
          </div>
          {stagingWarning&&<div style={{padding:'10px 14px',borderRadius:8,background:'#fef2f2',border:'1px solid #fca5a5',color:'#991b1b',fontSize:13}}>🚧 <b>Staging URL detected.</b> Review services carefully below.</div>}
        </div>

        <BrandSignalsPanel brief={brief} up={up} upTs={upTs} expandedSections={expandedSections} toggleSection={toggleSection}/>

        <div style={{background:'#fff',border:'1px solid #e5e8ee',borderRadius:12,padding:24,marginBottom:20}}>
          <div style={{fontFamily:"'Playfair Display',serif",fontSize:20,fontWeight:700,marginBottom:4}}>🏷️ Business Type</div>
          <div style={{fontSize:13,color:'#7a8a9a',marginBottom:14}}>This determines campaign goals, CTAs, and copy strategy.</div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:10}}>
            {[
              {v:'leadGen',icon:'🎯',label:'Lead Generation',desc:'Enquiries, quotes, bookings, calls'},
              {v:'ecommerce',icon:'🛍️',label:'Ecommerce',desc:'Online product sales with cart'},
              {v:'hybrid',icon:'🔀',label:'Hybrid',desc:'Both services AND online products'},
            ].map(opt=>{
              const sel=brief.businessType===opt.v;
              return(
                <div key={opt.v} onClick={()=>up('businessType',opt.v)} style={{border:`2px solid ${sel?'#e67e22':'#e0e5ec'}`,borderRadius:10,padding:'14px 16px',cursor:'pointer',background:sel?'#fff3e8':'#fff'}}>
                  <div style={{fontSize:22,marginBottom:6}}>{opt.icon}</div>
                  <div style={{fontWeight:700,fontSize:14,color:sel?'#b45309':'#1a2a3a',marginBottom:3}}>{opt.label}</div>
                  <div style={{fontSize:12,color:'#6b7280',lineHeight:1.4}}>{opt.desc}</div>
                </div>
              );
            })}
          </div>
        </div>

        <div style={{background:'#fff',border:'1px solid #e5e8ee',borderRadius:12,padding:24,marginBottom:20}}>
          <div style={{fontFamily:"'Playfair Display',serif",fontSize:20,fontWeight:700,marginBottom:4}}>🗂️ Campaign Mix</div>
          <div style={{fontSize:13,color:'#7a8a9a',marginBottom:12}}>Select which campaigns to generate.</div>
          <div style={{display:'grid',gap:8,marginBottom:16}}>
            {CAMPAIGN_TYPES.map(ct=>{
              const sel=selectedCampaignTypes.includes(ct.key);
              return(
                <div key={ct.key} className={`ctype-card${sel?' selected':''}${ct.always?' always-on':''}`} onClick={()=>toggleCampaignType(ct.key)}>
                  <div style={{display:'flex',alignItems:'flex-start',gap:12}}>
                    <div style={{width:18,height:18,borderRadius:4,border:`2px solid ${sel?ct.color:'#d0d5dd'}`,background:sel?ct.color:'#fff',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0,marginTop:2,color:'#fff',fontSize:11,fontWeight:700}}>{sel?'✓':''}</div>
                    <div style={{flex:1}}>
                      <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
                        <span style={{fontWeight:700,fontSize:14}}>{ct.icon} {ct.label}</span>
                        <span className={`budget-tag ${ct.budgetTag}`}>{ct.budgetLabel}</span>
                        {ct.always&&<span style={{fontSize:10,color:'#9aa5b0',fontWeight:600}}>Always included</span>}
                      </div>
                      <div style={{fontSize:12,color:'#5a6a7a',marginTop:3}}>{ct.desc}</div>
                      <div style={{fontSize:11,color:'#9aa5b0',marginTop:2,fontStyle:'italic'}}>{ct.budgetNote}</div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          <div style={{borderTop:'1px solid #f0f2f5',paddingTop:16}}>
            <div style={{fontSize:12,fontWeight:700,color:'#5a6a7a',marginBottom:10,textTransform:'uppercase'}}>Campaign Names (optional)</div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
              {selectedCampaignTypes.map(key=>{
                const ct=CAMPAIGN_TYPES.find(c=>c.key===key);
                const nameKey='name'+key.charAt(0).toUpperCase()+key.slice(1);
                return(
                  <div key={key}>
                    <label style={{display:'block',fontSize:11,fontWeight:600,color:'#6b7280',marginBottom:4}}>{ct?.icon} {ct?.label}</label>
                    <input value={brief[nameKey]||''} onChange={e=>up(nameKey,e.target.value)} placeholder={campName(key)} style={{width:'100%',padding:'8px 12px',border:'1px solid #e0e5ec',borderRadius:6,fontSize:12,outline:'none',color:'#1a2a3a',background:'#fff'}}/>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div style={{background:'#fff',border:'1px solid #e5e8ee',borderRadius:12,padding:24,marginBottom:20}}>
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:4}}>
            <div style={{fontFamily:"'Playfair Display',serif",fontSize:20,fontWeight:700}}>✅ Services to Advertise</div>
            <div style={{display:'flex',gap:6}}>
              <button onClick={()=>setSelectedSvcs(allSvcs.map((_,i)=>i).filter(i=>allSvcs[i].advertisable!==false))} style={{padding:'5px 12px',borderRadius:6,border:'1px solid #e0e5ec',background:'#fff',fontSize:12,fontWeight:600,cursor:'pointer',color:'#3a4a5a'}}>Select All</button>
              <button onClick={()=>setSelectedSvcs([])} style={{padding:'5px 12px',borderRadius:6,border:'1px solid #e0e5ec',background:'#fff',fontSize:12,fontWeight:600,cursor:'pointer',color:'#3a4a5a'}}>Select None</button>
            </div>
          </div>
          <div style={{fontSize:13,color:'#7a8a9a',marginBottom:12}}>Each selected service = one ad group.</div>
          <div style={{display:'grid',gap:8,marginBottom:16}}>
            {allSvcs.map((svc,i)=>(
              <div key={i} className={`svc-chip${selectedSvcs.includes(i)?' selected':''}`} onClick={()=>toggleSvc(i)}>
                <div className="check">{selectedSvcs.includes(i)?'✓':''}</div>
                <div style={{flex:1}}>
                  <div style={{fontWeight:600,fontSize:13}}>{svc.name}</div>
                  {svc.description&&<div style={{fontSize:11,color:'#8a95a5',marginTop:1}}>{svc.description}</div>}
                </div>
                {!svc.advertisable&&<span style={{fontSize:10,padding:'2px 8px',borderRadius:10,background:'#f0f2f5',color:'#8a95a5',fontWeight:600}}>non-ad</span>}
              </div>
            ))}
          </div>
          <label style={{display:'block',fontWeight:600,fontSize:13,color:'#3a4a5a',marginBottom:6}}>➕ Add missed services (one per line)</label>
          <textarea value={customSvcs} onChange={e=>setCustomSvcs(e.target.value)} placeholder="e.g. Fleet Branding" style={{width:'100%',padding:'10px 14px',border:'2px solid #e0e5ec',borderRadius:8,fontSize:13,outline:'none',minHeight:60,resize:'vertical',background:'#fff',color:'#1a2a3a'}}/>
        </div>

        <div style={{background:'#fff',border:'1px solid #e5e8ee',borderRadius:12,padding:24,marginBottom:20}}>
          <div style={{fontFamily:"'Playfair Display',serif",fontSize:20,fontWeight:700,marginBottom:4}}>🎯 Campaign Angle</div>
          <TA label="Focus / angle" value={campaignAngle} onChange={setCampaignAngle} ph="e.g. Target B2B fleet managers. Focus on ROI."/>
          <Fld label="Anything to exclude?" value={excludeNote} onChange={setExcludeNote} ph="e.g. No pricing mentions"/>
        </div>

        <div style={{background:'#fff',border:'1px solid #e5e8ee',borderRadius:12,padding:24,marginBottom:20}}>
          <div style={{fontFamily:"'Playfair Display',serif",fontSize:20,fontWeight:700,marginBottom:16}}>⚙️ Campaign Settings</div>
          <Fld label="Business Name *" value={brief.businessName} onChange={v=>up('businessName',v)}/>
          <Fld label="Landing Page URL" value={brief.landingPage} onChange={v=>up('landingPage',v)} ph={brief.website}/>
          <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:12,marginBottom:12}}>
            <Fld label="Daily Budget" value={brief.dailyBudget} onChange={v=>up('dailyBudget',parseFloat(v)||0)} type="number"/>
            <Sel label="Currency" value={brief.currencySymbol} onChange={v=>up('currencySymbol',v)} options={[{v:'R',l:'ZAR (R)'},{v:'$',l:'USD ($)'},{v:'£',l:'GBP (£)'},{v:'€',l:'EUR (€)'}]}/>
            <Sel label="Bid Strategy" value={brief.bidStrategy} onChange={v=>up('bidStrategy',v)} options={[{v:'Maximize conversions',l:'Max Conversions'},{v:'Maximize clicks',l:'Max Clicks'},{v:'Target CPA',l:'Target CPA'},{v:'Manual CPC',l:'Manual CPC'}]}/>
            <Sel label="Language" value={brief.language} onChange={v=>up('language',v)} options={[{v:'en',l:'English'},{v:'af',l:'Afrikaans'},{v:'fr',l:'French'},{v:'de',l:'German'}]}/>
          </div>
          <LocationTargeting locations={brief.locations} onChange={v=>up('locations',v)}/>
          <Sel label="Keyword Volume Location" value={brief.locationCode} onChange={v=>up('locationCode',parseInt(v))} options={LOCATION_OPTIONS}/>
          <div style={{background:'#f8f9fc',borderRadius:8,padding:12,marginTop:4}}>
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:8}}>
              <div style={{fontSize:12,fontWeight:700,color:'#3a4a5a'}}>💰 Budget Split</div>
              {Object.values(budgetOverrides).some(v=>v!=null&&v!=='')&&(
                <button onClick={()=>setBudgetOverrides({})} style={{fontSize:11,color:'#e67e22',background:'none',border:'none',cursor:'pointer',fontWeight:600,padding:0}}>↺ Reset</button>
              )}
            </div>
            <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(150px,1fr))',gap:8}}>
              {selectedCampaignTypes.map(key=>{
                const ct=CAMPAIGN_TYPES.find(c=>c.key===key);
                const eff=getEffectiveBudget(key);
                const totalEff=selectedCampaignTypes.reduce((s,k)=>s+getEffectiveBudget(k),0);
                const pct=totalEff>0?Math.round((eff/totalEff)*100):0;
                const isOverride=budgetOverrides[key]!=null&&budgetOverrides[key]!=='';
                return(
                  <div key={key} style={{padding:'8px 10px',borderRadius:6,background:'#fff',border:`1px solid ${isOverride?'#e67e22':'#e5e8ee'}`,fontSize:12}}>
                    <div style={{fontWeight:600,color:'#1a2a3a',marginBottom:6}}>{ct?.icon} {ct?.label}</div>
                    <div style={{display:'flex',alignItems:'center',gap:3,marginBottom:3}}>
                      <span style={{color:'#5a6a7a',fontSize:12,flexShrink:0}}>{brief.currencySymbol}</span>
                      <input type="number" min="0" value={isOverride?budgetOverrides[key]:eff}
                        onChange={e=>setBudgetOverrides(p=>({...p,[key]:e.target.value===''?null:e.target.value}))}
                        style={{width:'100%',padding:'3px 6px',border:'1px solid #e0e5ec',borderRadius:5,fontSize:12,fontWeight:700,color:'#e67e22',outline:'none',background:'transparent'}}/>
                      <span style={{color:'#9aa5b0',fontSize:11,flexShrink:0}}>/day</span>
                    </div>
                    <div style={{fontSize:10,color:'#9aa5b0'}}>{pct}% of total</div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div style={{textAlign:'center',padding:'8px 0 32px'}}>
          <div style={{fontSize:13,color:'#7a8a9a',marginBottom:12}}>
            <b style={{color:selectedSvcCount>0?'#059669':'#dc2626'}}>{selectedSvcCount} service{selectedSvcCount!==1?'s':''}</b> · <b style={{color:'#6d28d9'}}>{selectedCampaignTypes.length} campaigns</b>
            {selectedCampaignTypes.includes('targetedSearch')&&<span style={{color:'#b45309'}}> · volume data via Google Ads API</span>}
          </div>
          <button onClick={generate} disabled={selectedSvcCount===0||!brief.businessName}
            style={{padding:'14px 44px',borderRadius:10,border:'none',background:(selectedSvcCount===0||!brief.businessName)?'#e0e5ec':'linear-gradient(135deg, #e67e22, #f39c12)',color:(selectedSvcCount===0||!brief.businessName)?'#9aa5b0':'white',fontSize:16,fontWeight:700,cursor:(selectedSvcCount===0||!brief.businessName)?'not-allowed':'pointer',boxShadow:(selectedSvcCount===0||!brief.businessName)?'none':'0 4px 16px rgba(230,126,34,0.35)'}}>
            ✨ Generate All Campaigns
          </button>
          <div style={{fontSize:12,color:'#9aa5b0',marginTop:8}}>Keywords validated against real search volume</div>
        </div>
      </div></div>
    );
  }

  if(state==='loading'){
    return(
      <div><Hdr step={3}/>
      <div style={{maxWidth:700,margin:'0 auto',padding:'80px 24px',textAlign:'center'}}>
        <div style={{width:56,height:56,border:'4px solid #e5e8ee',borderTopColor:'#e67e22',borderRadius:'50%',animation:'spin 0.8s linear infinite',margin:'0 auto 20px'}}/>
        <div style={{fontSize:17,fontWeight:700,color:'#1a2a3a',marginBottom:8}}>{loadingMsg}</div>
        <div style={{display:'flex',gap:8,justifyContent:'center',marginTop:20,flexWrap:'wrap'}}>
          {selectedCampaignTypes.map((key,i)=>{
            const ct=CAMPAIGN_TYPES.find(c=>c.key===key);
            const done=i<loadingStep-1;const active=i===loadingStep-1;
            return(
              <div key={key} style={{padding:'6px 14px',borderRadius:20,fontSize:12,fontWeight:600,background:done?'#dcfce7':active?'#fff3e8':'#f0f2f5',color:done?'#166534':active?'#b45309':'#8a95a5',border:`1px solid ${done?'#bbf7d0':active?'#fcd34d':'#e0e5ec'}`}}>
                {done?'✓ ':active?'⟳ ':''}{ct?.icon} {ct?.label}
              </div>
            );
          })}
        </div>
      </div></div>
    );
  }

  if(state==='results'&&gen){
    const g=gen;
    const allCsvs=buildAllCSVs();
    const totalKw=Object.values(g).reduce((s,v)=>v&&v.adGroups?s+kwStats(v.adGroups).total:s,0);

    return(
      <div><Hdr step={4}/>
      <div style={{maxWidth:980,margin:'0 auto',padding:24}}>
        <Err/>

        <div style={{display:'flex',gap:12,marginBottom:20,flexWrap:'wrap',alignItems:'center'}}>
          <Btn onClick={()=>setState('steer')} bg="#f5f3ff" color="#7c3aed" border="1px solid #d4b4ff">← Back</Btn>
          <Btn onClick={generate} bg="#f5f3ff" color="#7c3aed" border="1px solid #d4b4ff">🔄 Regenerate All</Btn>
          <div style={{display:'flex',alignItems:'center',gap:6,marginLeft:'auto'}}>
            <span style={{fontSize:12,fontWeight:600,color:'#5a6a7a'}}>Copy tone:</span>
            <div style={{display:'flex',gap:0,borderRadius:20,overflow:'hidden',border:'1px solid #e0e5ec'}}>
              {[['standard','Standard'],['aggressive','Aggressive'],['trust-first','Trust-first']].map(([val,label])=>(
                <button key={val} onClick={()=>setCopyAngle(val)} style={{padding:'5px 13px',fontSize:12,fontWeight:600,border:'none',borderRight:'1px solid #e0e5ec',background:copyAngle===val?'#e67e22':'#f8f9fc',color:copyAngle===val?'white':'#5a6a7a',cursor:'pointer'}}>{label}</button>
              ))}
            </div>
          </div>
          <div style={{display:'flex',gap:10}}>
            <button onClick={exportStrategyDoc} style={{padding:'12px 22px',borderRadius:10,border:'none',background:'linear-gradient(135deg, #1a4b8c, #2563eb)',color:'white',fontSize:14,fontWeight:700,cursor:'pointer',boxShadow:'0 4px 14px rgba(26,75,140,0.3)',display:'flex',alignItems:'center',gap:7}}>📄 Export Strategy Doc</button>
            <button onClick={downloadAllCSVs} style={{padding:'12px 22px',borderRadius:10,border:'none',background:'linear-gradient(135deg, #059669, #10b981)',color:'white',fontSize:14,fontWeight:700,cursor:'pointer',boxShadow:'0 4px 14px rgba(5,150,105,0.35)'}}>⬇️ Download {allCsvs.length} CSV{allCsvs.length!==1?'s':''}</button>
          </div>
        </div>

        <div style={{display:'flex',gap:10,marginBottom:24,flexWrap:'wrap'}}>
          <SC n={selectedCampaignTypes.length} l="Campaigns" color="#6d28d9"/>
          <SC n={allCsvs.length} l="CSV Files" color="#0891b2"/>
          <SC n={totalKw} l="Total Keywords"/>
          <SC n={(g.targetedSearch?.adGroups||[]).length} l="Targeted AGs" color="#b45309"/>
          <SC n={(g.branded?.adGroups||[]).length} l="Branded AGs" color="#1a4b8c"/>
          {g.pmax&&<SC n={(g.pmax.assetGroups||[]).length} l="PMax Groups" color="#6d28d9"/>}
        </div>

        <div style={{background:'#fff',border:'1px solid #e5e8ee',borderRadius:12,padding:20,marginBottom:24}}>
          <div style={{fontFamily:"'Playfair Display',serif",fontSize:18,fontWeight:700,marginBottom:12}}>📋 Files to Download ({allCsvs.length})</div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(260px,1fr))',gap:8}}>
            {allCsvs.map(({name,cols,rows},i)=>{
              const ct=CAMPAIGN_TYPES.find(c=>name.toLowerCase().includes(c.key.toLowerCase()));
              return(
                <div key={i} style={{padding:'10px 14px',borderRadius:8,background:'#f8f9fc',border:'1px solid #e5e8ee',fontSize:12,display:'flex',alignItems:'center',justifyContent:'space-between',gap:10}}>
                  <div>
                    <div style={{fontWeight:700,color:'#1a2a3a'}}>{ct?.icon||'📄'} {name}.csv</div>
                    <div style={{color:'#6b7280',fontSize:11,marginTop:2}}>{rows.length} rows</div>
                  </div>
                  <button onClick={()=>downloadSingleCSV(name,cols,rows)} style={{padding:'6px 12px',borderRadius:6,border:'1px solid #059669',background:'#fff',color:'#059669',fontSize:11,fontWeight:700,cursor:'pointer',whiteSpace:'nowrap',flexShrink:0}}>⬇️ Download</button>
                </div>
              );
            })}
          </div>
        </div>

        {g.branded&&(
          <CampSection title={`⭐ ${campName('branded')}`} color="#1a4b8c" bg="#edf4ff" expanded={expandedSections.branded} onToggle={()=>toggleSection('branded')}>
            <IB type="info">Branded campaign · Target Impression Share · Budget ~{brief.currencySymbol}{getEffectiveBudget('branded')}/day</IB>
            {g.branded.adGroups.map((ag,i)=><AgCard key={i} ag={ag} agi={`b_${i}`} brief={brief} gen={g} setGen={setGen} expAgs={expAgs} setExpAgs={setExpAgs} campKey="branded" copyAngle={copyAngle} setCopyAngle={setCopyAngle} expCopy={expCopy} setExpCopy={setExpCopy} adCopyLoading={adCopyLoading} generateAdCopy={generateAdCopy}/>)}
            {g.branded.sitelinks?.length>0&&(
              <div style={{marginTop:16}}>
                <div style={{fontSize:13,fontWeight:700,marginBottom:8}}>📌 Sitelinks</div>
                <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(190px,1fr))',gap:8}}>
                  {g.branded.sitelinks.map((sl,i)=>(
                    <div key={i} style={{background:'#f8f9fc',border:'1px solid #e5e8ee',borderRadius:6,padding:10}}>
                      <div style={{fontWeight:600,fontSize:12,color:'#1a0dab'}}>{sl.text}</div>
                      <div style={{fontSize:11,color:'#545454'}}>{sl.description1}</div>
                      <div style={{fontSize:11,color:'#545454'}}>{sl.description2}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {g.branded.callouts?.length>0&&(
              <div style={{marginTop:12}}>
                <div style={{fontSize:13,fontWeight:700,marginBottom:6}}>💬 Callouts</div>
                <div style={{display:'flex',flexWrap:'wrap',gap:5}}>
                  {g.branded.callouts.map((c,i)=><span key={i} style={{padding:'4px 10px',borderRadius:20,fontSize:11,background:'#e8f5e9',color:'#1b5e20',border:'1px solid #a5d6a7'}}>{c}</span>)}
                </div>
              </div>
            )}
          </CampSection>
        )}

        {g.targetedSearch&&(
          <CampSection title={`🎯 ${campName('targetedSearch')}`} color="#b45309" bg="#fff3e8" expanded={expandedSections.targetedSearch} onToggle={()=>toggleSection('targetedSearch')}>
            {(()=>{
              const allKws=(g.targetedSearch.adGroups||[]).flatMap(ag=>ag.keywords||[]);
              const checked=allKws.filter(k=>k.volumeChecked);
              const withVol=checked.filter(k=>k.hasVolume);
              const noVol=checked.filter(k=>!k.hasVolume);
              const healthPct=kwHealthPct(allKws);
              return(
                <div>
                  <div style={{fontSize:13,color:'#5a6a7a',marginBottom:12}}>
                    <b>{g.targetedSearch.adGroups.length} ad groups</b> · {kwStats(g.targetedSearch.adGroups).total} keywords · Budget ~{brief.currencySymbol}{getEffectiveBudget('targetedSearch')}/day
                  </div>
                  {healthPct!==null&&(
                    <div style={{background:'#fff',border:'1px solid #e5e8ee',borderRadius:10,padding:14,marginBottom:16}}>
                      <div style={{fontSize:12,fontWeight:700,color:'#3a4a5a',marginBottom:8}}>📊 Keyword Volume Health ({(LOCATION_OPTIONS.find(o=>o.v===brief.locationCode)||{l:'Target'}).l})</div>
                      <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:10}}>
                        <span style={{fontSize:12,padding:'4px 10px',borderRadius:10,background:'#dcfce7',color:'#166534',border:'1px solid #bbf7d0',fontWeight:600}}>✓ {withVol.length} have volume</span>
                        {noVol.length>0&&<span style={{fontSize:12,padding:'4px 10px',borderRadius:10,background:'#fef2f2',color:'#991b1b',border:'1px solid #fca5a5',fontWeight:600}}>⚠️ {noVol.length} zero volume</span>}
                        <span style={{fontSize:12,padding:'4px 10px',borderRadius:10,background:'#f0f2f5',color:'#5a6a7a',border:'1px solid #e0e5ec'}}>{healthPct}% health</span>
                      </div>
                      <div style={{height:6,background:'#f0f2f5',borderRadius:3,overflow:'hidden'}}>
                        <div style={{height:'100%',width:healthPct+'%',background:healthPct>=HEALTH_GOOD?'#059669':healthPct>=HEALTH_OK?'#f59e0b':'#dc2626',borderRadius:3}}/>
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}
            {g.targetedSearch.adGroups.map((ag,i)=><AgCard key={i} ag={ag} agi={`ts_${i}`} brief={brief} gen={g} setGen={setGen} expAgs={expAgs} setExpAgs={setExpAgs} campKey="targetedSearch" copyAngle={copyAngle} setCopyAngle={setCopyAngle} expCopy={expCopy} setExpCopy={setExpCopy} adCopyLoading={adCopyLoading} generateAdCopy={generateAdCopy}/>)}
            {g.targetedSearch.sitelinks?.length>0&&(
              <div style={{marginTop:16}}>
                <div style={{fontSize:13,fontWeight:700,marginBottom:8}}>📌 Sitelinks</div>
                <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(190px,1fr))',gap:8}}>
                  {g.targetedSearch.sitelinks.map((sl,i)=>(
                    <div key={i} style={{background:'#f8f9fc',border:'1px solid #e5e8ee',borderRadius:6,padding:10}}>
                      <div style={{fontWeight:600,fontSize:12,color:'#1a0dab'}}>{sl.text}</div>
                      <div style={{fontSize:11,color:'#545454'}}>{sl.description1}</div>
                      <div style={{fontSize:11,color:'#545454'}}>{sl.description2}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {g.targetedSearch.callouts?.length>0&&(
              <div style={{marginTop:12}}>
                <div style={{fontSize:13,fontWeight:700,marginBottom:6}}>💬 Callouts</div>
                <div style={{display:'flex',flexWrap:'wrap',gap:5}}>
                  {g.targetedSearch.callouts.map((c,i)=><span key={i} style={{padding:'4px 10px',borderRadius:20,fontSize:11,background:'#e8f5e9',color:'#1b5e20',border:'1px solid #a5d6a7'}}>{c}</span>)}
                </div>
              </div>
            )}
          </CampSection>
        )}

        {g.pmax&&(
          <CampSection title={`🚀 ${campName('pmax')}`} color="#6d28d9" bg="#f5f3ff" expanded={expandedSections.pmax} onToggle={()=>toggleSection('pmax')}>
            <IB type="warning">⚠️ Upload image assets and logo before enabling.</IB>
            <IB type="warning">🔴 Add brand name as negative keyword in PMax to prevent it claiming branded search traffic.</IB>
            {(g.pmax.assetGroups||[]).map((ag,i)=>(
              <div key={i} style={{background:'#fff',border:'1px solid #e5e8ee',borderRadius:10,padding:16,marginBottom:12}}>
                <div style={{fontWeight:700,fontSize:14,color:'#6d28d9',marginBottom:8}}>{ag.name}</div>
                <div style={{fontSize:11,fontWeight:600,color:'#7a8a9a',marginBottom:4}}>AUDIENCE SIGNALS</div>
                <div style={{display:'flex',flexWrap:'wrap',gap:5,marginBottom:10}}>{(ag.audienceSignals||[]).map((s,j)=><span key={j} style={{padding:'3px 10px',borderRadius:12,fontSize:11,background:'#ede9fe',color:'#5b21b6',border:'1px solid #c4b5fd'}}>{s}</span>)}</div>
                <div style={{fontSize:11,fontWeight:600,color:'#7a8a9a',marginBottom:4}}>HEADLINES</div>
                <div style={{display:'flex',flexWrap:'wrap',gap:4,marginBottom:10}}>{(ag.headlines||[]).filter(Boolean).map((h,j)=><span key={j} style={{padding:'3px 8px',borderRadius:5,fontSize:11,background:'#f5f3ff',color:'#4c1d95',border:'1px solid #ddd6fe',fontFamily:'monospace'}}>{h}</span>)}</div>
                <div style={{fontSize:11,fontWeight:600,color:'#7a8a9a',marginBottom:4}}>DESCRIPTIONS</div>
                {(ag.descriptions||[]).filter(Boolean).map((d,j)=><div key={j} style={{padding:'4px 8px',borderRadius:5,fontSize:12,background:'#f8f9fc',marginBottom:3}}>{d}</div>)}
                <div style={{display:'flex',alignItems:'center',gap:8,marginTop:10,flexWrap:'wrap'}}>
                  <span style={{fontSize:12,color:'#e67e22',cursor:'pointer',fontWeight:600}} onClick={()=>setExpCopy(p=>({...p,[`pmax_${i}`]:!p[`pmax_${i}`]}))}>{expCopy[`pmax_${i}`]?'▾ Hide copy':'▸ Edit copy'}</span>
                  <button disabled={!!adCopyLoading[`pmax-${i}`]} onClick={()=>generateAdCopy('pmax',i)} style={{padding:'4px 12px',borderRadius:6,border:'1px solid #6d28d9',background:adCopyLoading[`pmax-${i}`]?'#f0f2f5':'#f5f3ff',color:adCopyLoading[`pmax-${i}`]?'#9aa5b0':'#6d28d9',fontSize:12,fontWeight:600,cursor:adCopyLoading[`pmax-${i}`]?'not-allowed':'pointer',marginLeft:'auto'}}>{adCopyLoading[`pmax-${i}`]?'Generating...':'✍️ Regenerate'}</button>
                </div>
                {expCopy[`pmax_${i}`]&&<CopyPanel ag={ag} campKey="pmax" agIdx={i} brief={brief} gen={g} setGen={setGen} onRegenerate={generateAdCopy} loading={!!adCopyLoading[`pmax-${i}`]} copyAngle={copyAngle} setCopyAngle={setCopyAngle}/>}
              </div>
            ))}
          </CampSection>
        )}

        {g.demandGen&&(
          <CampSection title={`📺 ${campName('demandGen')}`} color="#0e7490" bg="#ecfeff" expanded={expandedSections.demandGen} onToggle={()=>toggleSection('demandGen')}>
            {(g.demandGen.adGroups||[]).map((ag,i)=>(
              <div key={i} style={{background:'#fff',border:'1px solid #cffafe',borderRadius:10,padding:16,marginBottom:12}}>
                <div style={{fontWeight:700,fontSize:14,color:'#0e7490',marginBottom:8}}>{ag.audienceTheme}</div>
                <div style={{display:'flex',flexWrap:'wrap',gap:5,marginBottom:8}}>{(ag.audienceTargeting||[]).map((a,j)=><span key={j} style={{padding:'3px 10px',borderRadius:12,fontSize:11,background:'#cffafe',color:'#0e7490',border:'1px solid #67e8f9'}}>{a}</span>)}</div>
                {ag.videoConceptBrief&&<div style={{padding:'8px 12px',borderRadius:6,background:'#f0fdf4',border:'1px solid #bbf7d0',fontSize:12,color:'#166534'}}>🎬 {ag.videoConceptBrief}</div>}
                <div style={{display:'flex',alignItems:'center',gap:8,marginTop:10,flexWrap:'wrap'}}>
                  <span style={{fontSize:12,color:'#e67e22',cursor:'pointer',fontWeight:600}} onClick={()=>setExpCopy(p=>({...p,[`dg_${i}`]:!p[`dg_${i}`]}))}>{expCopy[`dg_${i}`]?'▾ Hide copy':'▸ Edit copy'}</span>
                  <button disabled={!!adCopyLoading[`demandGen-${i}`]} onClick={()=>generateAdCopy('demandGen',i)} style={{padding:'4px 12px',borderRadius:6,border:'1px solid #0e7490',background:adCopyLoading[`demandGen-${i}`]?'#f0f2f5':'#ecfeff',color:adCopyLoading[`demandGen-${i}`]?'#9aa5b0':'#0e7490',fontSize:12,fontWeight:600,cursor:adCopyLoading[`demandGen-${i}`]?'not-allowed':'pointer',marginLeft:'auto'}}>{adCopyLoading[`demandGen-${i}`]?'Generating...':'✍️ Regenerate'}</button>
                </div>
                {expCopy[`dg_${i}`]&&<CopyPanel ag={ag} campKey="demandGen" agIdx={i} brief={brief} gen={g} setGen={setGen} onRegenerate={generateAdCopy} loading={!!adCopyLoading[`demandGen-${i}`]} copyAngle={copyAngle} setCopyAngle={setCopyAngle}/>}
              </div>
            ))}
          </CampSection>
        )}

        {g.searchRemarketing&&(
          <CampSection title={`🔁 ${campName('searchRemarketing')}`} color="#be123c" bg="#fff1f2" expanded={expandedSections.searchRemarketing} onToggle={()=>toggleSection('searchRemarketing')}>
            <IB type="warning">⚠️ Requires 1,000+ users in remarketing audiences before activating.</IB>
            {(g.searchRemarketing.adGroups||[]).map((ag,i)=><AgCard key={i} ag={ag} agi={`rlsa_${i}`} brief={brief} gen={g} setGen={setGen} expAgs={expAgs} setExpAgs={setExpAgs} campKey="searchRemarketing" showAudience={true} copyAngle={copyAngle} setCopyAngle={setCopyAngle} expCopy={expCopy} setExpCopy={setExpCopy} adCopyLoading={adCopyLoading} generateAdCopy={generateAdCopy}/>)}
          </CampSection>
        )}

        {g.displayRemarketing&&(
          <CampSection title={`🖼️ ${campName('displayRemarketing')}`} color="#047857" bg="#ecfdf5" expanded={expandedSections.displayRemarketing} onToggle={()=>toggleSection('displayRemarketing')}>
            {(g.displayRemarketing.adGroups||[]).map((ag,i)=>(
              <div key={i} style={{background:'#fff',border:'1px solid #d1fae5',borderRadius:10,padding:16,marginBottom:12}}>
                <div style={{fontWeight:700,fontSize:14,color:'#047857'}}>{ag.name}</div>
                <div style={{fontSize:12,color:'#5a6a7a',marginTop:2,marginBottom:8}}>Audience: {ag.audienceList} · {ag.audienceDuration} · CPM: {brief.currencySymbol}{ag.targetCPM}</div>
                <div style={{display:'flex',flexWrap:'wrap',gap:4}}>{(ag.headlines||[]).map((h,j)=><span key={j} style={{padding:'3px 8px',background:'#f0fdf4',borderRadius:5,fontSize:11}}>{h}</span>)}</div>
                {(ag.imageConcepts||[]).length>0&&<div style={{marginTop:8}}>{(ag.imageConcepts||[]).map((ic,j)=><div key={j} style={{padding:'6px 10px',borderRadius:5,background:'#fef3c7',border:'1px solid #fde68a',fontSize:12,color:'#78350f',marginBottom:4}}>{j+1}. {ic}</div>)}</div>}
                <div style={{display:'flex',alignItems:'center',gap:8,marginTop:10,flexWrap:'wrap'}}>
                  <span style={{fontSize:12,color:'#e67e22',cursor:'pointer',fontWeight:600}} onClick={()=>setExpCopy(p=>({...p,[`dr_${i}`]:!p[`dr_${i}`]}))}>{expCopy[`dr_${i}`]?'▾ Hide copy':'▸ Edit copy'}</span>
                  <button disabled={!!adCopyLoading[`displayRemarketing-${i}`]} onClick={()=>generateAdCopy('displayRemarketing',i)} style={{padding:'4px 12px',borderRadius:6,border:'1px solid #047857',background:adCopyLoading[`displayRemarketing-${i}`]?'#f0f2f5':'#ecfdf5',color:adCopyLoading[`displayRemarketing-${i}`]?'#9aa5b0':'#047857',fontSize:12,fontWeight:600,cursor:adCopyLoading[`displayRemarketing-${i}`]?'not-allowed':'pointer',marginLeft:'auto'}}>{adCopyLoading[`displayRemarketing-${i}`]?'Generating...':'✍️ Regenerate'}</button>
                </div>
                {expCopy[`dr_${i}`]&&<CopyPanel ag={ag} campKey="displayRemarketing" agIdx={i} brief={brief} gen={g} setGen={setGen} onRegenerate={generateAdCopy} loading={!!adCopyLoading[`displayRemarketing-${i}`]} copyAngle={copyAngle} setCopyAngle={setCopyAngle}/>}
              </div>
            ))}
          </CampSection>
        )}

        <div style={{display:'flex',gap:12,justifyContent:'center',padding:'24px 0 8px',flexWrap:'wrap'}}>
          <button onClick={exportStrategyDoc} style={{padding:'14px 32px',borderRadius:10,border:'none',background:'linear-gradient(135deg, #1a4b8c, #2563eb)',color:'white',fontSize:15,fontWeight:700,cursor:'pointer',boxShadow:'0 6px 20px rgba(26,75,140,0.3)'}}>📄 Export Strategy Doc</button>
          <button onClick={downloadAllCSVs} style={{padding:'14px 32px',borderRadius:10,border:'none',background:'linear-gradient(135deg, #059669, #10b981)',color:'white',fontSize:15,fontWeight:700,cursor:'pointer',boxShadow:'0 6px 20px rgba(5,150,105,0.35)'}}>⬇️ Download {allCsvs.length} CSV Files</button>
        </div>
      </div></div>
    );
  }

  return(
    <div><Hdr step={0}/>
    <div style={{maxWidth:800,margin:'0 auto',padding:24}}>
      <Err/>
      <div style={{background:'#fff',border:'1px solid #e5e8ee',borderRadius:12,padding:28,marginBottom:20}}>
        <div style={{fontFamily:"'Playfair Display',serif",fontSize:22,fontWeight:700,marginBottom:4}}>🧭 Campaign Direction</div>
        <div style={{fontSize:13,color:'#7a8a9a',marginBottom:14}}>How does this business make money?</div>
        <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:10}}>
          {[
            {v:'leadGen',icon:'🎯',label:'Lead Generation',desc:'Enquiries, quotes, bookings, calls'},
            {v:'ecommerce',icon:'🛍️',label:'Ecommerce',desc:'Online product sales with cart'},
            {v:'hybrid',icon:'🔀',label:'Hybrid',desc:'Both services AND online products'},
          ].map(opt=>{
            const sel=brief.businessType===opt.v;
            return(
              <div key={opt.v} onClick={()=>up('businessType',opt.v)} style={{border:`2px solid ${sel?'#e67e22':'#e0e5ec'}`,borderRadius:10,padding:'14px 16px',cursor:'pointer',background:sel?'#fff3e8':'#fff'}}>
                <div style={{fontSize:22,marginBottom:6}}>{opt.icon}</div>
                <div style={{fontWeight:700,fontSize:13,color:sel?'#b45309':'#1a2a3a',marginBottom:3}}>{opt.label}</div>
                <div style={{fontSize:11,color:'#7a8a9a',lineHeight:1.4}}>{opt.desc}</div>
              </div>
            );
          })}
        </div>
      </div>
      <div style={{background:'#fff',border:'1px solid #e5e8ee',borderRadius:12,padding:28,marginBottom:20}}>
        <div style={{fontFamily:"'Playfair Display',serif",fontSize:22,fontWeight:700,marginBottom:4}}>🌐 Website & Business</div>
        <IB type="ai">✨ Enter the URL and scan — AI detects services. Keywords validated against real Google Ads API search volume.</IB>
        <Fld label="Website URL *" value={brief.website} onChange={v=>up('website',v)} ph="https://www.example.co.za"/>
        <div style={{marginBottom:20}}>
          <button onClick={scanWebsite} disabled={!brief.website} style={{padding:'11px 28px',borderRadius:9,border:'none',background:!brief.website?'#e0e5ec':'linear-gradient(135deg, #e67e22, #f39c12)',color:!brief.website?'#9aa5b0':'white',fontSize:14,fontWeight:700,cursor:!brief.website?'not-allowed':'pointer'}}>🔍 Scan Website</button>
          <span style={{fontSize:12,color:'#9aa5b0',marginLeft:12}}>AI reads the site · ~20 seconds</span>
        </div>
        <div style={{borderTop:'1px solid #f0f2f5',paddingTop:20}}>
          <div style={{fontSize:13,color:'#7a8a9a',marginBottom:16}}>Or fill in manually:</div>
          <Fld label="Business Name *" value={brief.businessName} onChange={v=>up('businessName',v)}/>
          <TA label="Business Description" value={brief.description} onChange={v=>up('description',v)} ph="What do they do? 2-3 sentences."/>
          <Fld label="Industry" value={brief.industry} onChange={v=>up('industry',v)}/>
          <TA label="Target Customer" value={brief.targetCustomer} onChange={v=>up('targetCustomer',v)}/>
          <TA label="USPs / Key Benefits (one per line)" value={brief.usps} onChange={v=>up('usps',v)}/>
        </div>
      </div>
      <div style={{background:'#fff',border:'1px solid #e5e8ee',borderRadius:12,padding:28,marginBottom:20}}>
        <div style={{fontFamily:"'Playfair Display',serif",fontSize:22,fontWeight:700,marginBottom:4}}>🎙️ Meeting Transcript</div>
        <IB type="ai">✨ Paste a client meeting transcript to auto-extract services, USPs and campaign angles.</IB>
        <div style={{marginBottom:14}}>
          <label style={{display:'block',fontWeight:600,fontSize:13,color:'#3a4a5a',marginBottom:5}}>Transcript (optional)</label>
          <textarea value={transcript} onChange={e=>setTranscript(e.target.value)} placeholder="Paste transcript here..." style={{width:'100%',padding:'10px 14px',border:'2px solid #e0e5ec',borderRadius:8,fontSize:13,outline:'none',minHeight:120,resize:'vertical',background:'#fff',color:'#1a2a3a',lineHeight:1.6}}/>
        </div>
        <div style={{display:'flex',gap:10,alignItems:'center',flexWrap:'wrap'}}>
          {transcript.trim()&&(
            <button onClick={parseTranscript} style={{padding:'11px 28px',borderRadius:9,border:'none',background:'linear-gradient(135deg,#7c3aed,#a78bfa)',color:'white',fontSize:14,fontWeight:700,cursor:'pointer'}}>🎙️ Extract from Transcript</button>
          )}
        </div>
      </div>
      <div style={{background:'#fff',border:'1px solid #e5e8ee',borderRadius:12,padding:28,marginBottom:20}}>
        <div style={{fontFamily:"'Playfair Display',serif",fontSize:22,fontWeight:700,marginBottom:16}}>⚙️ Campaign Settings</div>
        <div style={{display:'flex',gap:16}}>
          <Fld label="Total Daily Budget" value={brief.dailyBudget} onChange={v=>up('dailyBudget',parseFloat(v)||0)} type="number"/>
          <Sel label="Currency" value={brief.currencySymbol} onChange={v=>up('currencySymbol',v)} options={[{v:'R',l:'ZAR (R)'},{v:'$',l:'USD ($)'},{v:'£',l:'GBP (£)'},{v:'€',l:'EUR (€)'}]}/>
        </div>
        <div style={{display:'flex',gap:16}}>
          <Sel label="Bid Strategy" value={brief.bidStrategy} onChange={v=>up('bidStrategy',v)} options={[{v:'Maximize conversions',l:'Max Conversions'},{v:'Maximize clicks',l:'Max Clicks'},{v:'Target CPA',l:'Target CPA'},{v:'Manual CPC',l:'Manual CPC'}]}/>
          <Sel label="Language" value={brief.language} onChange={v=>up('language',v)} options={[{v:'en',l:'English'},{v:'af',l:'Afrikaans'},{v:'fr',l:'French'},{v:'de',l:'German'}]}/>
        </div>
        <LocationTargeting locations={brief.locations} onChange={v=>up('locations',v)}/>
        <Sel label="Keyword Volume Location" value={brief.locationCode} onChange={v=>up('locationCode',parseInt(v))} options={LOCATION_OPTIONS}/>
      </div>
    </div></div>
  );
}

function CampSection({title,color,bg,expanded,onToggle,children}){
  return(
    <div className="camp-section">
      <div className="camp-section-hdr" style={{background:bg}} onClick={onToggle}>
        <div style={{fontFamily:"'Playfair Display',serif",fontSize:18,fontWeight:700,color}}>{title}</div>
        <div style={{fontSize:16,color,fontWeight:700}}>{expanded?'▾':'▸'}</div>
      </div>
      {expanded&&<div className="camp-section-body">{children}</div>}
    </div>
  );
}

function AgCard({ag,agi,brief,gen,setGen,expAgs,setExpAgs,campKey,showAudience,copyAngle,setCopyAngle,expCopy,setExpCopy,adCopyLoading,generateAdCopy}){
  const tot=(ag.keywords||[]).length;
  const ex=(ag.keywords||[]).filter(k=>k.matchType==='Exact').length;
  const ph=(ag.keywords||[]).filter(k=>k.matchType==='Phrase').length;
  const br=(ag.keywords||[]).filter(k=>k.matchType==='Broad').length;
  const checked=(ag.keywords||[]).filter(k=>k.volumeChecked);
  const noVol=checked.filter(k=>!k.hasVolume);
  const hasVolumeData=checked.length>0;

  function removeNoVolume(){
    const agIdx=gen[campKey].adGroups.indexOf(ag);
    const ng={...gen,[campKey]:{...gen[campKey],adGroups:gen[campKey].adGroups.map((a,i)=>i===agIdx?{...a,keywords:a.keywords.filter(k=>!k.volumeChecked||k.hasVolume)}:a)}};
    setGen(ng);
  }

  function VolBadge({kw}){
    if(!kw.volumeChecked) return null;
    const vol=kw.avgMonthlySearches;
    if(vol===null||vol===undefined) return null;
    const bg=vol>=1000?'#dcfce7':vol>=100?'#fef9c3':vol>=10?'#fff7ed':'#fef2f2';
    const color=vol>=1000?'#166534':vol>=100?'#854d0e':vol>=10?'#9a3412':'#991b1b';
    const border=vol>=1000?'#bbf7d0':vol>=100?'#fde68a':vol>=10?'#fed7aa':'#fca5a5';
    return <span style={{fontSize:9,fontWeight:700,padding:'1px 5px',borderRadius:8,marginLeft:3,background:bg,color,border:`1px solid ${border}`}}>{vol>=1000?(vol/1000).toFixed(1)+'k':vol===0?'0':vol+'/mo'}</span>;
  }

  return(
    <div style={{background:'#f8f9fc',border:'1px solid #e5e8ee',borderRadius:10,padding:16,marginBottom:12}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:8,flexWrap:'wrap',gap:8}}>
        <div>
          <div style={{fontWeight:700,fontSize:14}}>{ag.name}</div>
          <div style={{fontSize:12,color:'#8a95a5'}}>
            {tot} kw{ex>0?` · ${ex} exact`:''}{ph>0?` · ${ph} phrase`:''}{br>0?` · ${br} broad`:''}
            {ag.defaultCpc?` · CPC: ${brief.currencySymbol}${(parseFloat(ag.defaultCpc)||10).toFixed(2)}`:''}
          </div>
          {showAudience&&ag.audienceList&&<div style={{fontSize:12,color:'#be123c',marginTop:2}}>🎯 {ag.audienceList} {ag.bidAdjustment&&`(${ag.bidAdjustment})`}</div>}
          {hasVolumeData&&(
            <div style={{display:'flex',gap:8,marginTop:4,flexWrap:'wrap',alignItems:'center'}}>
              <span style={{fontSize:11,color:'#166534',background:'#dcfce7',border:'1px solid #bbf7d0',padding:'2px 8px',borderRadius:10}}>✓ {checked.length-noVol.length} have volume</span>
              {noVol.length>0&&<span style={{fontSize:11,color:'#991b1b',background:'#fef2f2',border:'1px solid #fca5a5',padding:'2px 8px',borderRadius:10}}>⚠️ {noVol.length} zero volume</span>}
              {noVol.length>0&&<button onClick={removeNoVolume} style={{fontSize:11,color:'#991b1b',background:'#fff',border:'1px solid #fca5a5',padding:'2px 10px',borderRadius:10,cursor:'pointer',fontWeight:600}}>Remove zero-volume</button>}
            </div>
          )}
        </div>
      </div>
      <div style={{display:'flex',flexWrap:'wrap',gap:5,marginBottom:8}}>
        {(ag.keywords||[]).map((kw,ki)=>(
          <span key={ki} className={kw.matchType==='Phrase'?'match-phrase':kw.matchType==='Broad'?'':'match-exact'}
            style={{display:'inline-flex',alignItems:'center',gap:4,padding:'3px 10px',borderRadius:20,fontSize:11,fontFamily:'monospace',
              background:kw.matchType==='Broad'?'#f3f4f6':(kw.volumeChecked&&!kw.hasVolume?'#fef2f2':''),
              color:kw.matchType==='Broad'?'#374151':(kw.volumeChecked&&!kw.hasVolume?'#991b1b':''),
              border:kw.matchType==='Broad'?'1px solid #e5e7eb':(kw.volumeChecked&&!kw.hasVolume?'1px solid #fca5a5':''),
              opacity:kw.volumeChecked&&!kw.hasVolume?0.7:1}}>
            {kw.matchType==='Exact'?`[${kw.text}]`:kw.matchType==='Phrase'?`"${kw.text}"`:kw.text}
            <VolBadge kw={kw}/>
            {kw.cpc&&kw.hasVolume&&<span style={{fontSize:9,color:'#6b7280',marginLeft:2}}>{brief.currencySymbol}{kw.cpc}</span>}
            <span style={{cursor:'pointer',color:'#aaa',fontSize:13}} onClick={()=>{
              const agIdx=gen[campKey].adGroups.indexOf(ag);
              const ng={...gen,[campKey]:{...gen[campKey],adGroups:gen[campKey].adGroups.map((a,i)=>i===agIdx?{...a,keywords:a.keywords.filter((_,j)=>j!==ki)}:a)}};
              setGen(ng);
            }}>×</span>
          </span>
        ))}
      </div>
      {(()=>{
        const agIdx=(gen[campKey].adGroups||[]).indexOf(ag);
        const loadKey=`${campKey}-${agIdx}`;
        const isLoading=!!adCopyLoading[loadKey];
        const copyOpen=!!expCopy[agi];
        return(
          <div style={{marginTop:8}}>
            <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
              <span style={{fontSize:12,color:'#e67e22',cursor:'pointer',fontWeight:600}} onClick={()=>setExpCopy(p=>({...p,[agi]:!p[agi]}))}>{copyOpen?'▾ Hide ad copy':'▸ Show & edit ad copy'}</span>
              <button disabled={isLoading} onClick={()=>generateAdCopy(campKey,agIdx)} style={{padding:'4px 12px',borderRadius:6,border:'1px solid #e67e22',background:isLoading?'#f0f2f5':'#fff8f3',color:isLoading?'#9aa5b0':'#e67e22',fontSize:12,fontWeight:600,cursor:isLoading?'not-allowed':'pointer',marginLeft:'auto'}}>{isLoading?'Generating...':'✍️ Regenerate'}</button>
            </div>
            {copyOpen&&<CopyPanel ag={ag} campKey={campKey} agIdx={agIdx} brief={brief} gen={gen} setGen={setGen} onRegenerate={generateAdCopy} loading={isLoading} copyAngle={copyAngle} setCopyAngle={setCopyAngle}/>}
          </div>
        );
      })()}
    </div>
  );
}

function CopyPanel({ag,campKey,agIdx,brief,gen,setGen,onRegenerate,loading,copyAngle,setCopyAngle}){
  const isRSA=['branded','targetedSearch','searchRemarketing'].includes(campKey);
  const isPMax=campKey==='pmax';
  const isDemandGen=campKey==='demandGen';
  const isDisplay=campKey==='displayRemarketing';

  const ad=(ag.ads||[])[0]||{};
  const headlines=isRSA?(ad.headlines||Array(8).fill('')):(ag.headlines||[]);
  const descriptions=isRSA?(ad.descriptions||Array(3).fill('')):(ag.descriptions||[]);

  function slotStatus(val,limit){
    if(!val||!val.trim()) return 'empty';
    if(val.length>limit) return 'over';
    if(val.length>=limit-5) return 'near';
    return 'ok';
  }
  function statusDot(val,limit){
    const s=slotStatus(val,limit);
    const col=s==='ok'?'#059669':s==='near'?'#f59e0b':'#dc2626';
    return <span style={{display:'inline-block',width:8,height:8,borderRadius:'50%',background:col,flexShrink:0}}/>;
  }
  function hasDupes(arr){const c=arr.filter(Boolean).map(s=>s.toLowerCase().trim());return c.length!==new Set(c).size;}

  function HealthBadge(){
    if(isRSA){
      const filledH=headlines.filter(Boolean).length;
      const filledD=descriptions.filter(Boolean).length;
      const overLimitH=headlines.some(h=>h&&h.length>30);
      const overLimitD=descriptions.some(d=>d&&d.length>90);
      const dupes=hasDupes(headlines);
      const ok=filledH>=7&&filledD>=2&&!overLimitH&&!overLimitD&&!dupes;
      const bg=ok?'#dcfce7':overLimitH||overLimitD||dupes?'#fef2f2':'#fef9c3';
      const col=ok?'#166534':overLimitH||overLimitD||dupes?'#991b1b':'#854d0e';
      const border=ok?'#bbf7d0':overLimitH||overLimitD||dupes?'#fca5a5':'#fde68a';
      const msg=overLimitH?'⚠️ Headline over 30 chars':overLimitD?'⚠️ Desc over 90 chars':dupes?'⚠️ Duplicate headlines':filledH<7?`⚠️ ${filledH}/7 headlines filled`:`✓ ${filledH} headlines · ${filledD} descriptions`;
      return <span style={{fontSize:11,padding:'3px 10px',borderRadius:10,background:bg,color:col,border:`1px solid ${border}`,fontWeight:600}}>{msg}</span>;
    }
    return null;
  }

  function setRSAHeadline(hi,val){
    setGen(prev=>({...prev,[campKey]:{...prev[campKey],adGroups:prev[campKey].adGroups.map((a,i)=>i!==agIdx?a:{...a,ads:a.ads.map((ad2,j)=>j===0?{...ad2,headlines:ad2.headlines.map((h,k)=>k===hi?val:h)}:ad2)})}}));
  }
  function setRSADesc(di,val){
    setGen(prev=>({...prev,[campKey]:{...prev[campKey],adGroups:prev[campKey].adGroups.map((a,i)=>i!==agIdx?a:{...a,ads:a.ads.map((ad2,j)=>j===0?{...ad2,descriptions:ad2.descriptions.map((d,k)=>k===di?val:d)}:ad2)})}}));
  }
  function setRSAPath(field,val){
    setGen(prev=>({...prev,[campKey]:{...prev[campKey],adGroups:prev[campKey].adGroups.map((a,i)=>i!==agIdx?a:{...a,ads:a.ads.map((ad2,j)=>j===0?{...ad2,[field]:val.replace(/\s+/g,'').substring(0,15)}:ad2)})}}));
  }
  function setPMaxField(field,idx,val){
    setGen(prev=>({...prev,pmax:{...prev.pmax,assetGroups:prev.pmax.assetGroups.map((a,i)=>i!==agIdx?a:{...a,[field]:a[field].map((v,k)=>k===idx?val:v)})}}));
  }
  function setFlatField(field,idx,val){
    setGen(prev=>({...prev,[campKey]:{...prev[campKey],adGroups:prev[campKey].adGroups.map((a,i)=>i!==agIdx?a:{...a,[field]:Array.isArray(a[field])?a[field].map((v,k)=>k===idx?val:v):val})}}));
  }

  function AdPreview(){
    if(!isRSA) return null;
    let domain='example.co.za';
    try{domain=new URL(brief.landingPage||brief.website||'https://example.co.za').hostname;}catch(e){}
    const hs=headlines.filter(Boolean).slice(0,3);
    const d1=(descriptions[0]||'').substring(0,80);
    return(
      <div style={{background:'#f8f9fc',border:'1px solid #e0e5ec',borderRadius:8,padding:'12px 16px',marginBottom:12}}>
        <div style={{fontSize:12,color:'#202124',marginBottom:2}}>{domain}{ad.path1?` › ${ad.path1}`:''}{ad.path2?` › ${ad.path2}`:''}</div>
        <div style={{fontSize:18,color:'#1558d6',fontWeight:400,marginBottom:2,lineHeight:1.3}}>{hs.length?hs.join(' | '):'Headline 1 | Headline 2 | Headline 3'}</div>
        <div style={{fontSize:13,color:'#4d5156',lineHeight:1.5}}>{d1||'Description will appear here.'}{descriptions[0]?.length>80?'…':''}</div>
      </div>
    );
  }

  function SlotRow({label,role,val,limit,onEdit,isTextarea,pinPos}){
    const s=slotStatus(val||'',limit);
    const borderCol=s==='over'?'#dc2626':s==='near'?'#f59e0b':'#e0e5ec';
    return(
      <tr>
        <td style={{padding:'5px 8px',fontSize:11,color:'#5a6a7a',fontWeight:600,whiteSpace:'nowrap',verticalAlign:'top',paddingTop:8}}>{label}</td>
        <td style={{padding:'5px 8px',fontSize:11,color:'#8a95a5',verticalAlign:'top',paddingTop:8}}>{role}</td>
        <td style={{padding:'4px 6px'}}>
          {isTextarea
            ?<textarea value={val||''} onChange={e=>onEdit(e.target.value)} style={{width:'100%',padding:'4px 8px',border:`1px solid ${borderCol}`,borderRadius:5,fontSize:12,outline:'none',resize:'vertical',minHeight:36,fontFamily:'inherit'}}/>
            :<input value={val||''} onChange={e=>onEdit(e.target.value)} style={{width:'100%',padding:'4px 8px',border:`1px solid ${borderCol}`,borderRadius:5,fontSize:12,outline:'none'}}/>
          }
        </td>
        <td style={{padding:'5px 8px',fontSize:11,color:s==='over'?'#dc2626':s==='near'?'#f59e0b':'#9aa5b0',textAlign:'right',whiteSpace:'nowrap',verticalAlign:'top',paddingTop:8}}>{(val||'').length}/{limit}</td>
        <td style={{padding:'5px 8px',verticalAlign:'top',paddingTop:9}}>{statusDot(val||'',limit)}</td>
      </tr>
    );
  }

  const H_ROLES=['Relevance Anchor','Value Proposition','USP / Benefit','Social Proof','Risk Removal','USP variant','CTA','Pain Recognition'];

  return(
    <div style={{marginTop:10,background:'#fff',border:'1px solid #e5e8ee',borderRadius:8,padding:14}}>
      <div style={{display:'flex',gap:8,alignItems:'center',marginBottom:10,flexWrap:'wrap'}}>
        <HealthBadge/>
        {ag.lastCopyUpdate&&<span style={{fontSize:11,color:'#9aa5b0',marginLeft:'auto'}}>Updated: {new Date(ag.lastCopyUpdate).toLocaleString('en-GB',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})}</span>}
      </div>
      <AdPreview/>
      <div style={{overflowX:'auto'}}>
        <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
          <thead>
            <tr style={{borderBottom:'2px solid #e5e8ee'}}>
              <th style={{padding:'6px 8px',textAlign:'left',fontSize:11,color:'#5a6a7a',fontWeight:700}}>Slot</th>
              <th style={{padding:'6px 8px',textAlign:'left',fontSize:11,color:'#5a6a7a',fontWeight:700}}>Role</th>
              <th style={{padding:'6px 8px',textAlign:'left',fontSize:11,color:'#5a6a7a',fontWeight:700}}>Copy</th>
              <th style={{padding:'6px 8px',textAlign:'right',fontSize:11,color:'#5a6a7a',fontWeight:700}}>Chars</th>
              <th style={{padding:'6px 8px',fontSize:11,color:'#5a6a7a',fontWeight:700}}>✓</th>
            </tr>
          </thead>
          <tbody>
            {isRSA&&(<>
              {headlines.map((h,i)=><SlotRow key={`h${i}`} label={`H${i+1}`} role={H_ROLES[i]||'Headline'} val={h} limit={30} onEdit={v=>setRSAHeadline(i,v)}/>)}
              <SlotRow label="Path 1" role="URL path" val={ad.path1||''} limit={15} onEdit={v=>setRSAPath('path1',v)}/>
              <SlotRow label="Path 2" role="URL path" val={ad.path2||''} limit={15} onEdit={v=>setRSAPath('path2',v)}/>
              {descriptions.map((d,i)=><SlotRow key={`d${i}`} label={`D${i+1}`} role={i===0?'Problem + Solution + CTA':i===1?'Proof + CTA':'Risk Removal'} val={d} limit={90} onEdit={v=>setRSADesc(i,v)} isTextarea/>)}
            </>)}
            {isPMax&&(<>
              {(ag.headlines||Array(15).fill('')).map((h,i)=><SlotRow key={`h${i}`} label={`H${i+1}`} role="Headline" val={h} limit={30} onEdit={v=>setPMaxField('headlines',i,v)}/>)}
              {(ag.longHeadlines||Array(5).fill('')).map((h,i)=><SlotRow key={`lh${i}`} label={`LH${i+1}`} role="Long headline" val={h} limit={90} onEdit={v=>setPMaxField('longHeadlines',i,v)} isTextarea/>)}
              {(ag.descriptions||Array(5).fill('')).map((d,i)=><SlotRow key={`d${i}`} label={`D${i+1}`} role="Description" val={d} limit={90} onEdit={v=>setPMaxField('descriptions',i,v)} isTextarea/>)}
              {(ag.callToActions||['','']).map((c,i)=><SlotRow key={`cta${i}`} label={`CTA${i+1}`} role="CTA" val={c} limit={15} onEdit={v=>setPMaxField('callToActions',i,v)}/>)}
            </>)}
            {isDemandGen&&(<>
              {(ag.headlines||Array(3).fill('')).map((h,i)=><SlotRow key={`h${i}`} label={`H${i+1}`} role="Hook" val={h} limit={30} onEdit={v=>setFlatField('headlines',i,v)}/>)}
              {(ag.descriptions||Array(2).fill('')).map((d,i)=><SlotRow key={`d${i}`} label={`D${i+1}`} role="Story" val={d} limit={90} onEdit={v=>setFlatField('descriptions',i,v)} isTextarea/>)}
              {(ag.gmailSubjectLines||Array(2).fill('')).map((s,i)=><SlotRow key={`gs${i}`} label={`Gmail ${i+1}`} role="Subject" val={s} limit={70} onEdit={v=>setFlatField('gmailSubjectLines',i,v)}/>)}
              <SlotRow label="Video Brief" role="Concept" val={ag.videoConceptBrief||''} limit={300} onEdit={v=>setFlatField('videoConceptBrief',0,v)} isTextarea/>
            </>)}
            {isDisplay&&(<>
              {(ag.headlines||Array(3).fill('')).map((h,i)=><SlotRow key={`h${i}`} label={`H${i+1}`} role="Punchy" val={h} limit={30} onEdit={v=>setFlatField('headlines',i,v)}/>)}
              <SlotRow label="Long H" role="Banner headline" val={ag.longHeadline||''} limit={90} onEdit={v=>setFlatField('longHeadline',0,v)} isTextarea/>
              {(ag.descriptions||Array(2).fill('')).map((d,i)=><SlotRow key={`d${i}`} label={`D${i+1}`} role="Outcome" val={d} limit={90} onEdit={v=>setFlatField('descriptions',i,v)} isTextarea/>)}
              {(ag.imageConcepts||['','']).map((ic,i)=><SlotRow key={`ic${i}`} label={`Image ${i+1}`} role="Creative brief" val={ic} limit={200} onEdit={v=>setFlatField('imageConcepts',i,v)} isTextarea/>)}
              <SlotRow label="CTA" role="Call to action" val={ag.callToAction||''} limit={15} onEdit={v=>setFlatField('callToAction',0,v)}/>
            </>)}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Hdr({step}){
  const steps=['Brief','Steer','Generate','Results'];
  return(
    <div style={{background:'#0f1a2a',color:'white',padding:'14px 28px',display:'flex',alignItems:'center',gap:14,position:'sticky',top:0,zIndex:50,boxShadow:'0 2px 12px rgba(0,0,0,0.3)'}}>
      <div style={{width:34,height:34,borderRadius:8,background:'linear-gradient(135deg, #e67e22, #f1c40f)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:17,fontWeight:700}}>S</div>
      <div>
        <div style={{fontWeight:700,fontSize:15}}>Syte Campaign Creator</div>
        <div style={{fontSize:11,opacity:0.5}}>Multi-Campaign · Google Ads API Volume · v6.3</div>
      </div>
      {step!==undefined&&(
        <div style={{marginLeft:'auto',display:'flex',gap:6,alignItems:'center'}}>
          {steps.map((s,i)=>(
            <div key={i} style={{display:'flex',alignItems:'center',gap:4}}>
              <div style={{width:24,height:24,borderRadius:'50%',background:i<step?'#059669':i===step?'#e67e22':'rgba(255,255,255,0.15)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:10,fontWeight:700,color:'white'}}>{i<step?'✓':i+1}</div>
              {i<3&&<div style={{width:16,height:2,background:i<step?'#059669':'rgba(255,255,255,0.15)',borderRadius:1}}/>}
            </div>
          ))}
        </div>
      )}
      <div style={{fontSize:11,background:'linear-gradient(135deg, #7c3aed, #a78bfa)',padding:'4px 10px',borderRadius:10,fontWeight:700,marginLeft:8}}>v6.3 ✨</div>
    </div>
  );
}

function Fld({label,value,onChange,ph,type='text'}){return(<div style={{marginBottom:14,flex:1}}><label style={{display:'block',fontWeight:600,fontSize:13,color:'#3a4a5a',marginBottom:5}}>{label}</label><input type={type} value={value} placeholder={ph||''} onChange={e=>onChange(e.target.value)} style={{width:'100%',padding:'10px 14px',border:'2px solid #e0e5ec',borderRadius:8,fontSize:13,outline:'none',background:'#fff',color:'#1a2a3a'}}/></div>);}
function TA({label,value,onChange,ph}){return(<div style={{marginBottom:14}}><label style={{display:'block',fontWeight:600,fontSize:13,color:'#3a4a5a',marginBottom:5}}>{label}</label><textarea value={value} placeholder={ph||''} onChange={e=>onChange(e.target.value)} style={{width:'100%',padding:'10px 14px',border:'2px solid #e0e5ec',borderRadius:8,fontSize:13,outline:'none',minHeight:72,resize:'vertical',background:'#fff',color:'#1a2a3a'}}/></div>);}
function Sel({label,value,onChange,options}){
  const hasGroups=options.some(o=>o.g);
  const groups=hasGroups?[...new Set(options.map(o=>o.g||''))]:[];
  return(<div style={{marginBottom:14,flex:1}}><label style={{display:'block',fontWeight:600,fontSize:13,color:'#3a4a5a',marginBottom:5}}>{label}</label><select value={value} onChange={e=>onChange(e.target.value)} style={{width:'100%',padding:'10px 14px',border:'2px solid #e0e5ec',borderRadius:8,fontSize:13,outline:'none',background:'#fff'}}>
    {hasGroups?groups.map(g=>g?<optgroup key={g} label={g}>{options.filter(o=>o.g===g).map(o=><option key={o.v} value={o.v}>{o.l}</option>)}</optgroup>:options.filter(o=>!o.g).map(o=><option key={o.v} value={o.v}>{o.l}</option>)):options.map(o=><option key={o.v} value={o.v}>{o.l}</option>)}
  </select></div>);}
function IB({type,children}){const s={info:{bg:'#edf4ff',b:'#b8d4fe',c:'#1a4b8c'},warning:{bg:'#fff8e1',b:'#ffe082',c:'#7a5e00'},ai:{bg:'#f5f3ff',b:'#d4b4ff',c:'#5b21b6'}}[type]||{bg:'#edf4ff',b:'#b8d4fe',c:'#1a4b8c'};return <div style={{padding:'12px 14px',borderRadius:8,fontSize:13,lineHeight:1.6,marginBottom:14,background:s.bg,border:'1px solid '+s.b,color:s.c}}>{children}</div>;}
function SC({n,l,color}){return(<div style={{flex:1,minWidth:80,background:'#fff',border:'1px solid #e5e8ee',borderRadius:8,padding:12,textAlign:'center'}}><div style={{fontSize:22,fontWeight:700,color:color||'#e67e22'}}>{n}</div><div style={{fontSize:11,color:'#8a95a5',marginTop:2}}>{l}</div></div>);}
function Btn({onClick,bg,color,border,children}){return(<button onClick={onClick} style={{padding:'9px 18px',borderRadius:8,border:border||'none',background:bg,color,fontSize:13,fontWeight:600,cursor:'pointer',display:'inline-flex',alignItems:'center',gap:5}}>{children}</button>);}

ReactDOM.createRoot(document.getElementById('root')).render(<App/>);
