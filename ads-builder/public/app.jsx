const {useState,useMemo,useRef}=React;

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
  const cityMap={2710:'Johannesburg, Cape Town, Durban, Pretoria, Gauteng',1007295:'Johannesburg and surrounds',1007296:'Cape Town and surrounds',1007298:'Durban and surrounds',1007297:'Pretoria and surrounds',2840:'New York, Los Angeles, Chicago, Houston, Phoenix',2826:'London, Manchester, Birmingham, Leeds, Glasgow',2036:'Sydney, Melbourne, Brisbane, Perth, Adelaide',2124:'Toronto, Vancouver, Montreal, Calgary, Ottawa',2276:'Berlin, Hamburg, Munich, Frankfurt, Cologne',2356:'Mumbai, Delhi, Bangalore, Chennai, Hyderabad',2554:'Auckland, Wellington, Christchurch',2250:'Paris, Lyon, Marseille, Toulouse, Bordeaux',2528:'Amsterdam, Rotterdam, The Hague, Utrecht',2784:'Dubai, Abu Dhabi, Sharjah',2702:'Singapore',2404:'Nairobi, Mombasa',2566:'Lagos, Abuja, Port Harcourt'};
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
  parts.push(`VALUE PROP & USP TECHNIQUES — pick a DIFFERENT technique for H2 (Value Prop) vs H3/USP slot:\n  - Outcome flip: lead with the result the customer gets\n  - Specificity boost: exact number, timeframe, or metric\n  - Customer voice: their inner monologue\n  - Contrast frame: compare to the worse alternative`);
  const lp=brief.landingPage||brief.website;
  parts.push(`LANDING PAGE MATCH: D1 must contain the core service keyword${lp?' and align with the landing page ('+lp+')':''} — Google bolds description text that matches the search query.`);
  parts.push(`SPECIFICITY CHECK (required before returning JSON): Review every headline. Replace any that could be written by ANY competitor — "Professional Service", "Quality Work", "Fast Response", "Experienced Team", "Expert Solutions", "Call Us Today" — with a headline containing a concrete number, named feature, specific outcome, or proper noun from THIS business.`);
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
  {v:2710,l:'South Africa',g:'Africa'},{v:1007295,l:'SA · Johannesburg',g:'Africa'},{v:1007296,l:'SA · Cape Town',g:'Africa'},{v:1007298,l:'SA · Durban',g:'Africa'},{v:1007297,l:'SA · Pretoria',g:'Africa'},{v:2404,l:'Kenya',g:'Africa'},{v:2566,l:'Nigeria',g:'Africa'},{v:2716,l:'Zimbabwe',g:'Africa'},{v:2072,l:'Botswana',g:'Africa'},{v:2516,l:'Namibia',g:'Africa'},{v:2288,l:'Ghana',g:'Africa'},{v:2834,l:'Tanzania',g:'Africa'},
  {v:2840,l:'United States',g:'Anglosphere'},{v:2826,l:'United Kingdom',g:'Anglosphere'},{v:2036,l:'Australia',g:'Anglosphere'},{v:2124,l:'Canada',g:'Anglosphere'},{v:2554,l:'New Zealand',g:'Anglosphere'},{v:2372,l:'Ireland',g:'Anglosphere'},
  {v:2276,l:'Germany',g:'Europe'},{v:2250,l:'France',g:'Europe'},{v:2528,l:'Netherlands',g:'Europe'},
  {v:2356,l:'India',g:'Asia & Middle East'},{v:2784,l:'United Arab Emirates',g:'Asia & Middle East'},{v:2702,l:'Singapore',g:'Asia & Middle East'},
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
    if(found.length) issues.push(`Ecommerce language in a lead gen campaign — "${found[0]}" signals product purchase, not an enquiry.`);
  }
  if(businessType==='ecommerce'){
    const lgPhrases=['get a free quote','free quote','book a consult','enquire now','enquire online','no obligation','free consultation','request a callback','book a call','schedule a call','get a quote'];
    const found=lgPhrases.filter(p=>allCopy.some(c=>c.includes(p)));
    if(found.length) issues.push(`Lead gen language in an ecommerce campaign — "${found[0]}" signals a service enquiry, not a purchase.`);
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
          <div style={{fontSize:12,color:'#7a8a9a',marginTop:2}}>Tone, social proof, guarantees, CTAs and pain points</div>
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
                <div><label style={lSt}>Customer Pain Points (comma-separated)</label><input style={iSt} value={(brief.painPoints||[]).join(', ')} onChange={e=>up('painPoints',e.target.value.split(',').map(s=>s.trim()).filter(Boolean))} placeholder="Inconsistent brand across vehicles"/></div>
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
  function addPlace(){if(!placeInput.trim()) return;onChange([...locs,{id:Date.now()+'',type:'named',name:placeInput.trim(),mode:'include'}]);setPlaceInput('');setAdding(null);}
  async function geocode(){if(!radiusQuery.trim()) return;setGeocoding(true);setGeoErr('');setRadiusResults([]);try{const res=await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(radiusQuery)}&format=json&limit=5&addressdetails=1`);if(!res.ok) throw new Error('Request failed');const data=await res.json();if(!data.length) setGeoErr('No results — try a more specific address.');setRadiusResults(data);}catch{setGeoErr('Geocoding failed — check your connection.');}finally{setGeocoding(false);}}
  function confirmRadius(){if(!radiusSelected) return;const label=radiusSelected.display_name.split(',').slice(0,2).join(',').trim();onChange([...locs,{id:Date.now()+'',type:'radius',label,lat:parseFloat(radiusSelected.lat),lng:parseFloat(radiusSelected.lon),radius:parseInt(radiusVal)||30,unit:radiusUnit,mode:'include'}]);setRadiusQuery('');setRadiusResults([]);setRadiusSelected(null);setRadiusVal(30);setRadiusUnit('km');setAdding(null);}
  function remove(id){onChange(locs.filter(l=>l.id!==id));}
  function toggleMode(id){onChange(locs.map(l=>l.id===id?{...l,mode:l.mode==='include'?'exclude':'include'}:l));}
  const iSt={padding:'8px 12px',border:'1px solid #e0e5ec',borderRadius:7,fontSize:13,outline:'none',background:'#fff',width:'100%'};
  return(
    <div style={{marginBottom:14}}>
      <label style={{display:'block',fontWeight:600,fontSize:13,color:'#3a4a5a',marginBottom:8}}>Location Targeting</label>
      {locs.length>0&&(<div style={{display:'grid',gap:6,marginBottom:10}}>{locs.map(loc=>(<div key={loc.id} style={{display:'flex',alignItems:'center',gap:8,padding:'8px 12px',borderRadius:8,background:loc.mode==='exclude'?'#fef2f2':'#f0fdf4',border:`1px solid ${loc.mode==='exclude'?'#fca5a5':'#bbf7d0'}`}}><span style={{fontSize:14}}>{loc.type==='radius'?'🎯':'📍'}</span><span style={{flex:1,fontSize:13,fontWeight:500,color:'#1a2a3a'}}>{loc.type==='radius'?`${loc.radius}${loc.unit} · ${loc.label}`:loc.name}</span><span onClick={()=>toggleMode(loc.id)} style={{fontSize:10,fontWeight:700,padding:'2px 8px',borderRadius:10,cursor:'pointer',background:loc.mode==='include'?'#dcfce7':'#fee2e2',color:loc.mode==='include'?'#166534':'#991b1b',border:`1px solid ${loc.mode==='include'?'#bbf7d0':'#fca5a5'}`}}>{loc.mode==='include'?'✓ Include':'✕ Exclude'}</span><span onClick={()=>remove(loc.id)} style={{fontSize:16,color:'#9aa5b0',cursor:'pointer',lineHeight:1,padding:'0 2px'}}>×</span></div>))}</div>)}
      {!adding&&(<div style={{display:'flex',gap:8}}><button onClick={()=>setAdding('place')} style={{padding:'7px 14px',borderRadius:7,border:'1px dashed #d0d5dd',background:'#f8f9fc',fontSize:12,fontWeight:600,color:'#5a6a7a',cursor:'pointer'}}>+ Add Place</button><button onClick={()=>setAdding('radius')} style={{padding:'7px 14px',borderRadius:7,border:'1px dashed #d0d5dd',background:'#f8f9fc',fontSize:12,fontWeight:600,color:'#5a6a7a',cursor:'pointer'}}>🎯 Add Radius</button></div>)}
      {adding==='place'&&(<div style={{padding:14,background:'#f8f9fc',borderRadius:8,border:'1px solid #e5e8ee',marginTop:8}}><div style={{fontSize:12,fontWeight:700,color:'#3a4a5a',marginBottom:6}}>📍 Add Place</div><div style={{fontSize:11,color:'#7a8a9a',marginBottom:8}}>Country, region, city, suburb or ZIP</div><div style={{display:'flex',gap:8}}><input style={iSt} value={placeInput} onChange={e=>setPlaceInput(e.target.value)} onKeyDown={e=>e.key==='Enter'&&addPlace()} placeholder="e.g. Cape Town, Gauteng, 8001…"/><button onClick={addPlace} disabled={!placeInput.trim()} style={{padding:'8px 16px',borderRadius:7,border:'none',background:placeInput.trim()?'#e67e22':'#e0e5ec',color:placeInput.trim()?'#fff':'#9aa5b0',fontSize:13,fontWeight:700,cursor:placeInput.trim()?'pointer':'not-allowed',whiteSpace:'nowrap'}}>Add</button><button onClick={()=>{setAdding(null);setPlaceInput('');}} style={{padding:'8px 12px',borderRadius:7,border:'1px solid #e0e5ec',background:'#fff',fontSize:13,cursor:'pointer',color:'#5a6a7a'}}>Cancel</button></div></div>)}
      {adding==='radius'&&(<div style={{padding:14,background:'#f8f9fc',borderRadius:8,border:'1px solid #e5e8ee',marginTop:8}}><div style={{fontSize:12,fontWeight:700,color:'#3a4a5a',marginBottom:6}}>🎯 Radius Target</div>{!radiusSelected?(<><div style={{fontSize:11,color:'#7a8a9a',marginBottom:8}}>Search for the centre point — address, landmark, or suburb.</div><div style={{display:'flex',gap:8,marginBottom:8}}><input style={iSt} value={radiusQuery} onChange={e=>setRadiusQuery(e.target.value)} onKeyDown={e=>e.key==='Enter'&&geocode()} placeholder="e.g. Sandton City, Cape Town CBD…"/><button onClick={geocode} disabled={geocoding||!radiusQuery.trim()} style={{padding:'8px 16px',borderRadius:7,border:'none',background:(geocoding||!radiusQuery.trim())?'#e0e5ec':'#1a4b8c',color:(geocoding||!radiusQuery.trim())?'#9aa5b0':'#fff',fontSize:13,fontWeight:700,cursor:(geocoding||!radiusQuery.trim())?'not-allowed':'pointer',whiteSpace:'nowrap'}}>{geocoding?'Searching…':'Find'}</button><button onClick={()=>{setAdding(null);setRadiusQuery('');setRadiusResults([]);}} style={{padding:'8px 12px',borderRadius:7,border:'1px solid #e0e5ec',background:'#fff',fontSize:13,cursor:'pointer',color:'#5a6a7a'}}>Cancel</button></div>{geoErr&&<div style={{fontSize:12,color:'#991b1b',marginBottom:8}}>{geoErr}</div>}{radiusResults.length>0&&(<div style={{border:'1px solid #e5e8ee',borderRadius:7,overflow:'hidden'}}>{radiusResults.map((r,i)=>(<div key={r.place_id} onClick={()=>setRadiusSelected(r)} style={{padding:'8px 12px',fontSize:12,cursor:'pointer',background:'#fff',borderBottom:i<radiusResults.length-1?'1px solid #f0f2f5':'none'}} onMouseEnter={e=>e.currentTarget.style.background='#f5f7ff'} onMouseLeave={e=>e.currentTarget.style.background='#fff'}><div style={{fontWeight:600,color:'#1a2a3a'}}>{r.display_name.split(',').slice(0,3).join(', ')}</div><div style={{fontSize:10,color:'#9aa5b0',marginTop:2}}>{parseFloat(r.lat).toFixed(4)}, {parseFloat(r.lon).toFixed(4)} · {r.type}</div></div>))}</div>)}</>):(<><div style={{padding:'8px 12px',borderRadius:7,background:'#f0fdf4',border:'1px solid #bbf7d0',fontSize:12,marginBottom:12}}><div style={{fontWeight:700,color:'#166534'}}>📍 {radiusSelected.display_name.split(',').slice(0,2).join(',').trim()}</div><div style={{color:'#5a6a7a',fontSize:10,marginTop:2}}>{parseFloat(radiusSelected.lat).toFixed(4)}, {parseFloat(radiusSelected.lon).toFixed(4)}</div></div><div style={{display:'flex',gap:8,alignItems:'flex-end',marginBottom:12}}><div style={{flex:1}}><label style={{display:'block',fontSize:11,fontWeight:700,color:'#5a6a7a',marginBottom:4}}>RADIUS</label><input type="number" min="1" max="500" value={radiusVal} onChange={e=>setRadiusVal(e.target.value)} style={iSt}/></div><div style={{width:90}}><label style={{display:'block',fontSize:11,fontWeight:700,color:'#5a6a7a',marginBottom:4}}>UNIT</label><select value={radiusUnit} onChange={e=>setRadiusUnit(e.target.value)} style={{...iSt,padding:'8px 10px'}}><option value="km">km</option><option value="mi">miles</option></select></div></div><div style={{display:'flex',gap:8}}><button onClick={confirmRadius} style={{padding:'8px 18px',borderRadius:7,border:'none',background:'#e67e22',color:'#fff',fontSize:13,fontWeight:700,cursor:'pointer'}}>✓ Add {radiusVal}{radiusUnit} Radius</button><button onClick={()=>{setRadiusSelected(null);setRadiusResults([]);}} style={{padding:'8px 12px',borderRadius:7,border:'1px solid #e0e5ec',background:'#fff',fontSize:12,cursor:'pointer',color:'#5a6a7a'}}>← Change</button><button onClick={()=>{setAdding(null);setRadiusQuery('');setRadiusResults([]);setRadiusSelected(null);}} style={{padding:'8px 12px',borderRadius:7,border:'1px solid #e0e5ec',background:'#fff',fontSize:12,cursor:'pointer',color:'#5a6a7a'}}>Cancel</button></div></>)}</div>)}
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
      const fix=await callAI(`Rewrite these Google Ads descriptions to be under 90 characters each. Preserve the intent and key message. Count every character including spaces.\n${contextNote?'Context: '+contextNote+'\n':''}Descriptions to fix:\n${offending}\nReturn ONLY valid JSON: {"fixed":["rewritten description 1"]}\nArray must have exactly ${overIdxs.length} item(s).`,800);
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
      const fix=await callAI(`Rewrite these Google Ads headlines to be 30 characters or fewer. Preserve the core message. Every character including spaces counts.\n${contextNote?'Context: '+contextNote+'\n':''}Headlines to fix:\n${offending}\nRules: Max 30 chars per headline. Keep the strongest keyword or benefit.\nReturn ONLY valid JSON: {"fixed":["rewritten headline 1"]}\nArray must have exactly ${overIdxs.length} item(s).`,600);
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

  function validateCampaignResponse(r,type){
    if(!r||typeof r!=='object') throw new Error(`Invalid response structure for ${type}`);
    const needsAdGroups=['branded','targetedSearch','searchRemarketing','demandGen','displayRemarketing'];
    if(needsAdGroups.includes(type)&&!Array.isArray(r.adGroups)) throw new Error(`Missing adGroups array in ${type} response`);
    if(type==='pmax'&&!Array.isArray(r.assetGroups)) throw new Error('Missing assetGroups array in pmax response');
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
    setMsg(`Checking search volumes for ${allKws.length} keywords...`);
    const batchSize=100;const batches=[];
    for(let i=0;i<allKws.length;i+=batchSize) batches.push(allKws.slice(i,i+batchSize));
    const maps=await Promise.all(batches.map(batch=>checkKeywordVolumes(batch,locationCode)));
    const goodMaps=maps.filter(Boolean);
    if(goodMaps.length===0)setMsg('⚠️ Keyword volume check failed — continuing without volume data.');
    const volumeMap=Object.assign({},...goodMaps);
    return adGroups.map(ag=>({...ag,keywords:(ag.keywords||[]).map(kw=>{
      const data=volumeMap[kw.text.toLowerCase()];
      return{...kw,avgMonthlySearches:data?.avgMonthlySearches??null,competition:data?.competition??null,competitionIndex:data?.competitionIndex??null,cpc:data?.cpc??null,tier:data?.tier??null,hasVolume:data?.hasVolume??null,recommended:data?.recommended??null,volumeChecked:!!data};
    })}));
  }

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
  function toggleSvc(i){setSelectedSvcs(prev=>prev.includes(i)?prev.filter(x=>x!==i):[...prev,i]);}

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
      setBrief(p=>({...p,businessName:r.businessName||p.businessName,businessType:r.businessType||p.businessType,description:r.description||p.description,industry:r.industry||p.industry,targetCustomer:r.targetCustomer||p.targetCustomer,usps:Array.isArray(r.usps)?r.usps.join('\n'):p.usps,landingPage:r.suggestedLandingPage||p.landingPage,toneOfVoice:r.toneOfVoice||p.toneOfVoice,toneExamples:Array.isArray(r.toneExamples)?r.toneExamples:p.toneExamples,trustSignals:r.trustSignals&&typeof r.trustSignals==='object'?r.trustSignals:p.trustSignals,primaryCTA:r.primaryCTA||p.primaryCTA,painPoints:Array.isArray(r.painPoints)?r.painPoints:p.painPoints,pricingInfo:r.pricingInfo||p.pricingInfo}));
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
      const r=await callAI(`You are a Google Ads strategist. Extract all business and campaign information from this client meeting transcript.\nTranscript:\n${transcript.substring(0,6000)}\n\nRESPOND WITH ONLY VALID JSON (no markdown):\n{"businessName":"","businessType":"leadGen|ecommerce|hybrid","industry":"","description":"2-3 sentence overview","targetCustomer":"","detectedServices":[{"name":"","description":"","advertisable":true}],"usps":[""],"toneOfVoice":"","toneExamples":[""],"trustSignals":{"rating":"","reviewCount":"","reviewPlatform":"","yearsInBusiness":"","clientCount":"","certifications":[],"guarantees":[]},"primaryCTA":"","painPoints":[""],"pricingInfo":"","suggestedLandingPage":"","campaignAngle":"","excludeNote":"","confidence":"high|medium|low","confidenceNote":""}`,5000);
      setScanResult({...r,source:'transcript'});
      setSelectedSvcs((r.detectedServices||[]).map((s,i)=>s.advertisable?i:null).filter(i=>i!==null));
      setBrief(p=>({...p,businessName:r.businessName||p.businessName,businessType:r.businessType||p.businessType,description:r.description||p.description,industry:r.industry||p.industry,targetCustomer:r.targetCustomer||p.targetCustomer,usps:Array.isArray(r.usps)?r.usps.join('\n'):p.usps,landingPage:r.suggestedLandingPage||p.landingPage,toneOfVoice:r.toneOfVoice||p.toneOfVoice,toneExamples:Array.isArray(r.toneExamples)?r.toneExamples:p.toneExamples,trustSignals:r.trustSignals&&typeof r.trustSignals==='object'?r.trustSignals:p.trustSignals,primaryCTA:r.primaryCTA||p.primaryCTA,painPoints:Array.isArray(r.painPoints)?r.painPoints:p.painPoints,pricingInfo:r.pricingInfo||p.pricingInfo}));
      if(r.campaignAngle) setCampaignAngle(r.campaignAngle);
      if(r.excludeNote) setExcludeNote(r.excludeNote);
      setState('steer');
    }catch(e){setError('Transcript parsing failed: '+e.message);setState('brief');}
    finally{isScanningRef.current=false;}
  }
