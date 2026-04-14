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

  // Build 12 deterministic keywords per service (no AI, no location suffixes, guaranteed mix)
  function buildKeywordsForService(svc){
    const s=svc.toLowerCase().trim();
    return[
      {text:s,matchType:'Exact'},
      {text:`${s} services`,matchType:'Exact'},
      {text:`professional ${s}`,matchType:'Exact'},
      {text:`${s} company`,matchType:'Exact'},
      {text:`${s} quote`,matchType:'Phrase'},
      {text:`${s} price`,matchType:'Phrase'},
      {text:`${s} cost`,matchType:'Phrase'},
      {text:`best ${s}`,matchType:'Phrase'},
      {text:`${s} near me`,matchType:'Phrase'},
      {text:`commercial ${s}`,matchType:'Exact'},
      {text:`corporate ${s}`,matchType:'Exact'},
      {text:`custom ${s}`,matchType:'Exact'},
    ];
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

  async function generateAdCopy(campKey,index){
    const loadKey=`${campKey}-${index}`;
    setAdCopyLoading(p=>({...p,[loadKey]:true}));
    const isRSA=['branded','targetedSearch','searchRemarketing'].includes(campKey);
    const isPMax=campKey==='pmax';
    const isDemandGen=campKey==='demandGen';
    const isDisplay=campKey==='displayRemarketing';
    const usps=brief.usps.split('\n').map(s=>s.trim()).filter(Boolean);
    const angleMap={aggressive:'Use urgency and scarcity. Push hard CTAs.','trust-first':'Lead with social proof and risk reducers. Build trust before CTA.',standard:''};
    const angleMod=angleMap[copyAngle]||'';
    const saNote=getLangNote(brief.locationCode);
    try{
      let prompt='';
      const getAg=()=>{if(isPMax) return (gen.pmax.assetGroups||[])[index]||{};return (gen[campKey].adGroups||[])[index]||{};};
      const ag=getAg();
      const brandCtx=getBrandVoiceContext(brief);
      const copyQualityRules=getCopyQualityRules(brief);
      if(isRSA){
        const kws=(ag.keywords||[]).slice(0,10).map(k=>k.text).join(', ');
        const isRLSA=campKey==='searchRemarketing';
        const isBranded=campKey==='branded';
        prompt=`You are a senior Google Ads copywriter. Generate RSA copy for this ad group.\n\nBusiness: ${brief.businessName} | Industry: ${brief.industry}\nTarget Customer: ${brief.targetCustomer}\nUSPs: ${usps.join(' | ')||'quality, professional, reliable'}\nAd Group: ${ag.name||''}\nTop keywords: ${kws}\n${getBusinessTypeContext(brief.businessType)}${brandCtx}\nCOPY ANGLE: ${angleMod||'Balanced'}\n${copyQualityRules}\nReturn ONLY valid JSON (7-8 headlines, 2-3 descriptions):\n{"headlines":["h1","h2","h3","h4","h5","h6","h7"],"descriptions":["d1","d2","d3"],"path1":"Path","path2":"GetQuote","pinnedPositions":{"0":"1","d0":"1"}}\nHARD LIMITS: EVERY headline max 30 chars. EVERY description max 90 chars. path1/path2 max 15 chars no spaces. 7-8 headlines, 2-3 descriptions. No duplicates. ${saNote}`;
      } else if(isPMax){
        prompt=`You are a senior Google Ads copywriter. Generate Performance Max asset group copy.\n\nBusiness: ${brief.businessName} | Industry: ${brief.industry}\nAsset Group: ${ag.name||''}\nUSPs: ${usps.join(' | ')||'quality, professional, reliable'}\n${brandCtx}\nCOPY ANGLE: ${angleMod||'Balanced'}\n${copyQualityRules}\nReturn ONLY valid JSON:\n{"headlines":["h1","h2","h3","h4","h5","h6","h7","h8","h9","h10","h11","h12","h13","h14","h15"],"longHeadlines":["lh1","lh2","lh3","lh4","lh5"],"descriptions":["d1","d2","d3","d4","d5"],"callToActions":["Get Quote","Learn More"],"audienceSignals":["Website Visitors","Custom Intent","In-Market"]}\nHARD LIMITS: 15 headlines ≤30 chars, 5 long headlines ≤90 chars, 5 descriptions ≤90 chars. No duplicates. ${saNote}`;
      } else if(isDemandGen){
        prompt=`You are a senior Google Ads copywriter for upper-funnel creative.\n\nBusiness: ${brief.businessName} | Industry: ${brief.industry}\nAudience: ${ag.audienceTheme||''}\nUSPs: ${usps.join(' | ')||'quality, professional, reliable'}\n${brandCtx}\nGOAL: INTERRUPTING browsing — earn attention with desires/frustrations. Soft CTAs only.\n${copyQualityRules}\nReturn ONLY valid JSON:\n{"headlines":["h1","h2","h3"],"descriptions":["d1","d2"],"gmailSubjectLines":["s1","s2"],"videoConceptBrief":"1-2 sentence concept"}\n3 headlines ≤30 chars. 2 descriptions ≤90 chars. 2 Gmail subjects ≤70 chars. ${saNote}`;
      } else if(isDisplay){
        prompt=`You are a senior Google Ads display/remarketing copywriter.\n\nBusiness: ${brief.businessName} | Industry: ${brief.industry}\nAudience: ${ag.audienceList||''}\nUSPs: ${usps.join(' | ')||'quality, professional, reliable'}\n${brandCtx}\nGOAL: Visual brand recall for past visitors. Short, punchy.\n${copyQualityRules}\nReturn ONLY valid JSON:\n{"headlines":["h1","h2","h3"],"longHeadline":"banner headline ≤90 chars","descriptions":["d1","d2"],"imageConcepts":["concept1","concept2","concept3"],"callToAction":"Get Quote"}\n3 headlines ≤30 chars. longHeadline ≤90 chars. 2 descriptions ≤90 chars. callToAction ≤15 chars. ${saNote}`;
      }
      const result=await callAI(prompt,2000);
      let rsaAssets=null;
      if(isRSA){
        let hs=(result.headlines||[]).slice(0,8).map(h=>String(h).trim());while(hs.length<8)hs.push('');
        if(hs.some(h=>h&&h.length>30)) hs=await fixOverLimitHeadlines(hs,ag.name||'');
        let ds=(result.descriptions||[]).slice(0,3).map(d=>String(d).trim());while(ds.length<3)ds.push('');
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
        if(isRSA){const {hs,ds,p1,p2,pins}=rsaAssets;const ags=(prev[campKey].adGroups||[]).map((a,i)=>{if(i!==index) return a;return{...a,lastCopyUpdate:Date.now(),ads:[{...((a.ads||[])[0]||{}),headlines:hs,descriptions:ds,path1:p1,path2:p2,pinnedPositions:pins}]};});return{...prev,[campKey]:{...prev[campKey],adGroups:ags}};}
        else if(isPMax){const ags=(prev.pmax.assetGroups||[]).map((a,i)=>i!==index?a:{...a,...result,lastCopyUpdate:Date.now()});return{...prev,pmax:{...prev.pmax,assetGroups:ags}};}
        else{const ags=(prev[campKey].adGroups||[]).map((a,i)=>i!==index?a:{...a,...result,lastCopyUpdate:Date.now()});return{...prev,[campKey]:{...prev[campKey],adGroups:ags}};}
      });
    }catch(e){console.error('generateAdCopy failed:',e.message);setError('Copy generation failed: '+e.message);}
    finally{setAdCopyLoading(p=>({...p,[loadKey]:false}));}
  }

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
    setState('loading');setError(null);setGen({});try{
    const usps=brief.usps.split('\n').map(s=>s.trim()).filter(Boolean);
    const txCtx=transcript.trim()?`\nClient meeting notes:\n${transcript.substring(0,2500)}`:'';
    const brandCtx=getBrandVoiceContext(brief);
    const copyQualityRules=getCopyQualityRules(brief);
    const result={};
    const steps=selectedCampaignTypes;
    let stepIdx=0;

    // ── 1. BRANDED ──
    if(steps.includes('branded')){
      setLoadingMsg(`Generating Branded Search... (${++stepIdx}/${steps.length})`);setLoadingStep(stepIdx);
      try{
        const industryNegs=getIndustryNegs(brief.industry);
        const r=await callAI(`Generate a Google Ads BRANDED SEARCH campaign.\nBusiness: ${brief.businessName} | Website: ${brief.website} | Industry: ${brief.industry}\nCurrency: ${curr} | Min CPC: ${minCpc}${txCtx}\n\nGoal: Defend the brand name, intercept branded searches.\n${getBusinessTypeContext(brief.businessType)}${brandCtx}\nRSA COPY — 7 HEADLINE SLOTS:\nH1: Brand + "Official Site". PIN position 1.\nH2: USP — strongest differentiator.\nH3: Value Booster — outcome/transformation.\nH4: Social Proof — star rating, years, clients.\nH5: Risk Removal — "Free Quote · No Obligation".\nH6: USP variant (different angle from H2).\nH7: CTA — direct action.\n3 descriptions (expand headlines, never repeat).\n${getLangNote(brief.locationCode)}\n${copyQualityRules}\nSITELINK EXTENSIONS: 4 sitelinks (text max 25 chars, descriptions max 35 chars).\nCALLOUT EXTENSIONS: 6-8 phrases max 25 chars each.\n\nReturn ONLY valid JSON:\n{"adGroups":[{"name":"Brand - Core","defaultCpc":${minCpc},"keywords":[{"text":"keyword","matchType":"Exact"}],"ads":[{"headlines":["h1","h2","h3","h4","h5","h6","h7"],"descriptions":["d1","d2","d3"],"path1":"Brand","path2":"Official"}]}],"industryNegatives":["term"],"sitelinks":[{"text":"Title","description1":"line1","description2":"line2","finalUrl":"${brief.website}"}],"callouts":["Free Quote","Trusted"]}\nRules: 8-12 brand keywords. EVERY headline max 30 chars. EVERY description max 90 chars. EXACTLY 7 headlines. EXACTLY 3 descriptions.${industryNegs.length?' Industry negatives: '+industryNegs.join(', '):''}`,8000);
        validateCampaignResponse(r,'branded');
        normaliseAdGroups(r,minCpc);
        await fixAdGroupHeadlines(r.adGroups||[],brief.businessName);
        await fixAdGroupDescriptions(r.adGroups||[],brief.businessName);
        result.branded={adGroups:r.adGroups||[],negatives:[...new Set([...STD_NEGS,...(r.industryNegatives||[])])],sitelinks:(r.sitelinks||[]).map(sl=>({text:(sl.text||'').substring(0,25),description1:(sl.description1||'').substring(0,35),description2:(sl.description2||'').substring(0,35),finalUrl:sl.finalUrl||brief.website||''})),callouts:(r.callouts||[]).map(c=>String(c).substring(0,25)).filter(Boolean)};
        setGen(prev=>({...prev,branded:result.branded}));
      }catch(e){console.error('Branded failed:',e.message);}
    }

    // ── 2. TARGETED SEARCH ──
    if(steps.includes('targetedSearch')){
      setLoadingMsg(`Generating Targeted Search... (${++stepIdx}/${steps.length})`);setLoadingStep(stepIdx);
      const allAdGroups=[];let sharedExtensions=null;
      for(let si=0;si<finalServices.length;si++){
        const svc=finalServices[si];
        setLoadingMsg(`Targeted Search: building "${svc}" (${si+1}/${finalServices.length})...`);
        try{
          const isFirst=si===0;
          const industryNegs2=getIndustryNegs(brief.industry);
          const prompt=`Generate ONE Google Ads ad group for: "${svc}"\nBusiness: ${brief.businessName} | Website: ${brief.website} | Industry: ${brief.industry}\nTarget Customer: ${brief.targetCustomer}\nUSPs: ${usps.join(' | ')||'quality, professional, reliable'}\nCampaign angle: ${campaignAngle||'Direct response'}\nCurrency: ${curr} | Min CPC: ${minCpc}\n${excludeNote?'DO NOT include: '+excludeNote:''}${txCtx}\n${getBusinessTypeContext(brief.businessType)}${brandCtx}\n\nKEYWORD STRATEGY — GENERATE EXACTLY 12 KEYWORDS (not 3, not 5, not 7 — MUST BE 12):\n${getMarketNote(brief.locationCode)}\n\nBUILD EXACTLY THESE 12 KEYWORDS (copy the pattern):\n1. "${svc}" — Exact\n2. "${svc} services" — Exact\n3. "professional ${svc}" — Exact\n4. "${svc} company" — Exact\n5. "${svc} company" alt synonym — Exact\n6. "${svc} quote" — Phrase\n7. "${svc} price" — Phrase\n8. "${svc} cost" — Phrase\n9. "best ${svc}" — Phrase\n10. "${svc} near me" — Phrase\n11. "commercial ${svc}" — Exact\n12. "corporate ${svc}" — Exact\n\nABSOLUTE RULES (output will be auto-rejected if violated):\n- DO NOT append a city/location to any keyword. NEVER include words like "johannesburg", "cape town", "durban", "sa", "south africa" in ANY keyword.\n- DO NOT generate keywords longer than 4 words.\n- The keyword "${svc}" by itself MUST be the first keyword.\n- EXACTLY 12 keywords — count them before returning.\n\nRSA COPY — 7-8 HEADLINES:\nH1: Service name, PIN position 1. H2: Value Prop. H3: USP with numbers.\nH4: Social Proof. H5: Risk Removal. H6: USP variant. H7: CTA. H8: Pain Recognition (optional).\n3 descriptions. ${getLangNote(brief.locationCode)}\n${copyQualityRules}\n${isFirst?'SITELINKS: 4 (text max 25, desc max 35). CALLOUTS: 6-8 (max 25). STRUCTURED SNIPPET: 4-6 services.':''}\n\nReturn ONLY valid JSON:\n{"adGroups":[{"name":"${svc}","defaultCpc":${minCpc},"keywords":[{"text":"${svc}","matchType":"Exact"},{"text":"${svc} services","matchType":"Exact"},{"text":"professional ${svc}","matchType":"Exact"},{"text":"${svc} quote","matchType":"Phrase"},{"text":"${svc} price","matchType":"Phrase"},{"text":"best ${svc}","matchType":"Phrase"},{"text":"commercial ${svc}","matchType":"Exact"}],"ads":[{"headlines":["h1","h2","h3","h4","h5","h6","h7"],"descriptions":["d1","d2","d3"],"path1":"Path","path2":"GetQuote"}]}]${isFirst?',"industryNegatives":["term"],"sitelinks":[{"text":"Title","description1":"line1","description2":"line2","finalUrl":"'+brief.website+'"}],"callouts":["phrase"],"structuredSnippet":{"header":"Services","values":["svc1","svc2"]}':''}}\nHARD LIMITS: headlines max 30 chars, descriptions max 90 chars. 7-8 headlines, 3 descriptions.${industryNegs2.length?' Industry negatives: '+industryNegs2.join(', '):''}`;
          const r=await callAI(prompt,6000);
          validateCampaignResponse(r,'targetedSearch');
          if(r.adGroups&&r.adGroups.length>0){
            normaliseAdGroups(r,minCpc);
            const negSet=new Set(STD_NEGS.map(n=>n.toLowerCase()));
            r.adGroups.forEach(ag=>{ag.keywords=buildKeywordsForService(svc);});
            allAdGroups.push(...r.adGroups);
          }
          if(isFirst&&r.sitelinks) sharedExtensions=r;
        }catch(e){console.error(`"${svc}" failed:`,e.message);}
      }
      if(allAdGroups.length>0){
        const seenKws=new Set();
        allAdGroups.forEach(ag=>{ag.keywords=(ag.keywords||[]).filter(kw=>{const key=kw.text.toLowerCase()+'|'+(kw.matchType||'Exact');if(seenKws.has(key)) return false;seenKws.add(key);return true;});});
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
        await fixAdGroupHeadlines(filtered,brief.businessName);
        await fixAdGroupDescriptions(filtered,brief.businessName);
        result.targetedSearch={adGroups:filtered,negatives:[...new Set([...STD_NEGS,...(sharedExtensions?.industryNegatives||[])])],sitelinks:(sharedExtensions?.sitelinks||[]).map(sl=>({text:(sl.text||'').substring(0,25),description1:(sl.description1||'').substring(0,35),description2:(sl.description2||'').substring(0,35),finalUrl:sl.finalUrl||brief.website||''})),callouts:(sharedExtensions?.callouts||[]).map(c=>String(c).substring(0,25)),structuredSnippet:sharedExtensions?.structuredSnippet||{header:'Services',values:[]}};
        setGen(prev=>({...prev,targetedSearch:result.targetedSearch}));
      } else {setError('Targeted Search generated no ad groups.');}
    }

    // ── 3. PERFORMANCE MAX ──
    if(steps.includes('pmax')){
      setLoadingMsg(`Generating Performance Max... (${++stepIdx}/${steps.length})`);setLoadingStep(stepIdx);
      try{
        const r=await callAI(`Generate a Google Ads PERFORMANCE MAX campaign (no product feed).\nBusiness: ${brief.businessName} | Industry: ${brief.industry}\nServices: ${finalServices.join(', ')} | Target Customer: ${brief.targetCustomer}\nUSPs: ${usps.join(' | ')}${txCtx}\n${getBusinessTypeContext(brief.businessType)}${brandCtx}\nCreate 2-4 asset groups. Per group: 15 headlines ≤30 chars, 5 long headlines ≤90 chars, 5 descriptions ≤90 chars.\n${getLangNote(brief.locationCode)}${copyQualityRules}\nReturn ONLY valid JSON:\n{"assetGroups":[{"name":"Group","headlines":["h1",...,"h15"],"longHeadlines":["lh1",...,"lh5"],"descriptions":["d1",...,"d5"],"callToActions":["Get Quote","Learn More"],"audienceSignals":["Website Visitors","Custom Intent","In-Market"]}]}`,10000);
        validateCampaignResponse(r,'pmax');
        await fixAdGroupHeadlines(r.assetGroups||[],brief.businessName);
        await fixAdGroupDescriptions(r.assetGroups||[],brief.businessName);
        result.pmax={assetGroups:r.assetGroups||[]};
        setGen(prev=>({...prev,pmax:result.pmax}));
      }catch(e){console.error('PMax failed:',e.message);}
    }

    // ── 4. DEMAND GEN ──
    if(steps.includes('demandGen')){
      setLoadingMsg(`Generating Demand Gen... (${++stepIdx}/${steps.length})`);setLoadingStep(stepIdx);
      try{
        const r=await callAI(`Generate a Google Ads DEMAND GEN campaign (YouTube, Discover, Gmail).\nBusiness: ${brief.businessName} | Industry: ${brief.industry}\nServices: ${finalServices.join(', ')} | Target Customer: ${brief.targetCustomer}\nUSPs: ${usps.join(' | ')}${txCtx}\n${getBusinessTypeContext(brief.businessType)}${brandCtx}\nGOAL: Upper funnel — build desire BEFORE active search. Soft CTAs only.\nCreate 2-3 ad groups by audience temperature.\nPer group: 3 headlines ≤30 chars, 2 descriptions ≤90 chars, 2 Gmail subject lines ≤70 chars, video concept.\n${getLangNote(brief.locationCode)}${copyQualityRules}\nReturn ONLY valid JSON:\n{"adGroups":[{"audienceTheme":"Theme","audienceTargeting":["audience"],"headlines":["h1","h2","h3"],"descriptions":["d1","d2"],"videoConceptBrief":"concept","gmailSubjectLines":["s1","s2"]}]}`,8000);
        validateCampaignResponse(r,'demandGen');
        await fixAdGroupHeadlines(r.adGroups||[],brief.businessName);
        await fixAdGroupDescriptions(r.adGroups||[],brief.businessName);
        result.demandGen={adGroups:r.adGroups||[]};
        setGen(prev=>({...prev,demandGen:result.demandGen}));
      }catch(e){console.error('DemandGen failed:',e.message);}
    }

    // ── 5. SEARCH REMARKETING ──
    if(steps.includes('searchRemarketing')){
      setLoadingMsg(`Generating Search Remarketing (RLSA)... (${++stepIdx}/${steps.length})`);setLoadingStep(stepIdx);
      try{
        const r=await callAI(`Generate a Google Ads SEARCH REMARKETING (RLSA) campaign.\nBusiness: ${brief.businessName} | Services: ${finalServices.join(', ')} | Currency: ${curr} | Min CPC: ${minCpc}${txCtx}\n${getBusinessTypeContext(brief.businessType)}${brandCtx}\nGOAL: Re-engage past visitors who didn't convert. Use urgency and trust.\nCreate 2-3 audience segments (7-day high-intent, 30-day all visitors, 90-day older visitors).\nRSA: 7-8 headlines ≤30 chars, 3 descriptions ≤90 chars. Keywords: Broad match, 8-12 keywords.\n${getLangNote(brief.locationCode)}${copyQualityRules}\nReturn ONLY valid JSON:\n{"adGroups":[{"name":"All Website Visitors","audienceList":"All Website Visitors - 30 days","bidAdjustment":"+30%","defaultCpc":${minCpc},"keywords":[{"text":"keyword","matchType":"Broad"}],"ads":[{"headlines":["h1",...,"h7"],"descriptions":["d1","d2","d3"],"path1":"Return","path2":"GetQuote"}]}]}`,10000);
        validateCampaignResponse(r,'searchRemarketing');
        normaliseRlsa(r,minCpc);
        await fixAdGroupHeadlines(r.adGroups||[],brief.businessName);
        await fixAdGroupDescriptions(r.adGroups||[],brief.businessName);
        result.searchRemarketing={adGroups:r.adGroups||[]};
        setGen(prev=>({...prev,searchRemarketing:result.searchRemarketing}));
      }catch(e){console.error('RLSA failed:',e.message);}
    }

    // ── 6. DISPLAY REMARKETING ──
    if(steps.includes('displayRemarketing')){
      setLoadingMsg(`Generating Display Remarketing... (${++stepIdx}/${steps.length})`);setLoadingStep(stepIdx);
      try{
        const r=await callAI(`Generate a Google Ads DISPLAY REMARKETING campaign (GDN banners).\nBusiness: ${brief.businessName} | Industry: ${brief.industry}\nTarget Customer: ${brief.targetCustomer} | USPs: ${usps.join(' | ')}${txCtx}\n${getBusinessTypeContext(brief.businessType)}${brandCtx}\nGOAL: Visual brand recall. Short, punchy. Create 2-3 ad groups by audience temperature.\nPer group: 3 headlines ≤30 chars, 1 long headline ≤90 chars, 2 descriptions ≤90 chars, CTA ≤15 chars, 2-3 image concepts.\n${getLangNote(brief.locationCode)}${copyQualityRules}\nReturn ONLY valid JSON:\n{"adGroups":[{"name":"High-Intent — 30 Days","audienceList":"Service Page Visitors","audienceDuration":"30 days","targetCPM":20,"headlines":["h1","h2","h3"],"descriptions":["d1","d2"],"longHeadline":"headline","imageConcepts":["concept1","concept2"],"callToAction":"Get a Quote"}]}`,8000);
        validateCampaignResponse(r,'displayRemarketing');
        await fixAdGroupHeadlines(r.adGroups||[],brief.businessName);
        await fixAdGroupDescriptions(r.adGroups||[],brief.businessName);
        result.displayRemarketing={adGroups:r.adGroups||[]};
        setGen(prev=>({...prev,displayRemarketing:result.displayRemarketing}));
      }catch(e){console.error('Display failed:',e.message);}
    }

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
    function addAG(rows,cname,ag,defMatch){const cpc=Number(ag.defaultCpc||10).toFixed(2);const a=er();a['Campaign']=cname;a['Ad group']=ag.name;a['Ad group status']='Enabled';a['Default max. CPC']=cpc;if(ag.audienceList){a['Audience']=ag.audienceList;a['Bid adjustment']=ag.bidAdjustment||'+0%';}rows.push(a);(ag.keywords||[]).forEach(kw=>{const mt=kw.matchType||defMatch||'Exact';const r=er();r['Campaign']=cname;r['Ad group']=ag.name;r['Keyword']=kw.text;r['Match type']=mt==='Phrase'?'Phrase':mt==='Broad'?'Broad':'Exact';r['Keyword status']='Enabled';r['Max CPC']=cpc;rows.push(r);});(ag.ads||[]).forEach(ad=>{const r=er();r['Campaign']=cname;r['Ad group']=ag.name;r['Ad status']='Enabled';r['Final URL']=fu;r['Path 1']=ad.path1||'';r['Path 2']=ad.path2||'';const hl=[...(ad.headlines||[])];while(hl.length<15)hl.push('');const ds=[...(ad.descriptions||[])];while(ds.length<4)ds.push('');for(let i=0;i<15;i++)r[`Headline ${i+1}`]=hl[i]||'';for(let i=0;i<4;i++)r[`Description ${i+1}`]=ds[i]||'';rows.push(r);});}
    function addNegs(rows,cname,negs){(negs||[]).forEach(neg=>{const r=er();r['Campaign']=cname;r['Keyword']=neg;r['Match type']='Negative phrase';rows.push(r);});}
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
    const g=gen;const biz=brief.businessName||'Client';const fu=brief.landingPage||brief.website||'';const curr=brief.currencySymbol;
    const today=new Date().toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric'});
    const totalEffBudget=selectedCampaignTypes.reduce((s,k)=>s+getEffectiveBudget(k),0);
    const html=`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>Google Ads Strategy — ${biz}</title><link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Playfair+Display:wght@700&display=swap" rel="stylesheet"/><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:'DM Sans',sans-serif;background:#f4f5f7;color:#1a2a3a;line-height:1.75;font-size:14px}.page{max-width:900px;margin:0 auto;background:#fff;box-shadow:0 0 60px rgba(0,0,0,0.08)}@media print{body{background:#fff}.page{box-shadow:none;max-width:100%}.no-print{display:none!important}}</style></head><body><div class="page"><div style="background:#0f1a2a;color:white;padding:68px 60px 52px;position:relative;overflow:hidden"><div style="font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#e67e22;margin-bottom:16px">Prepared by Syte Digital</div><div style="font-family:'Playfair Display',serif;font-size:40px;font-weight:700;line-height:1.15;margin-bottom:8px">Google Ads Strategy</div><div style="font-family:'Playfair Display',serif;font-size:40px;font-weight:700;color:#e67e22;margin-bottom:10px">${biz}</div><div style="font-size:15px;color:rgba(255,255,255,0.5);margin-bottom:44px;font-style:italic">Campaign Structure, Ad Copy &amp; Budget Recommendations</div><div style="display:grid;grid-template-columns:repeat(3,1fr);gap:22px;border-top:1px solid rgba(255,255,255,0.1);padding-top:26px">${[['Date',today],['Daily Budget',curr+brief.dailyBudget+'/day'],['Campaigns',selectedCampaignTypes.length+' types'],['Market',(brief.locations||[]).filter(l=>l.mode==='include').map(l=>l.name||l.label).join(', ')||'—'],['Website',fu||'—'],['Status','For Review']].map(([l,v])=>'<div><div style="font-size:10px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:rgba(255,255,255,0.35);margin-bottom:4px">'+l+'</div><div style="font-size:13px;font-weight:600;color:rgba(255,255,255,0.9)">'+v+'</div></div>').join('')}</div></div><div style="padding:52px 60px"><p style="font-size:14px;color:#5a6a7a;line-height:1.8;margin-bottom:20px">This document outlines the proposed Google Ads strategy for <strong>${biz}</strong>. All campaigns are configured in <strong>Paused</strong> status.</p><table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:20px">${[['Business',biz],['Industry',brief.industry||'—'],['Website',fu||'—'],['Target Customer',brief.targetCustomer||'—'],['Business Type',brief.businessType==='ecommerce'?'Ecommerce':brief.businessType==='hybrid'?'Hybrid':'Lead Generation'],['Budget',curr+brief.dailyBudget+'/day across '+selectedCampaignTypes.length+' campaigns']].map(([k,v],i)=>'<tr style="background:'+(i%2?'#fff':'#f8f9fc')+'"><td style="padding:10px 14px;font-weight:600;color:#6b7280;width:180px;border-bottom:1px solid #f0f2f5">'+k+'</td><td style="padding:10px 14px;border-bottom:1px solid #f0f2f5">'+v+'</td></tr>').join('')}</table>${brief.usps?'<div style="font-size:12px;font-weight:700;text-transform:uppercase;color:#9aa5b0;margin-bottom:10px">Key Value Propositions</div><ul style="list-style:none;padding:0">'+brief.usps.split('\\n').filter(Boolean).map(u=>'<li style="padding:7px 0 7px 18px;position:relative;font-size:13px;border-bottom:1px solid #f5f6f8"><span style="position:absolute;left:0;top:15px;width:6px;height:6px;border-radius:50%;background:#e67e22;display:inline-block"></span>'+u+'</li>').join('')+'</ul>':''}</div><div style="background:#0f1a2a;padding:32px 60px;display:flex;justify-content:space-between;align-items:center"><div><div style="color:white;font-size:15px;font-weight:700">Syte Digital</div><div style="color:rgba(255,255,255,0.4);font-size:12px;margin-top:3px">Google Ads Strategy · ${today}</div></div><div style="font-size:11px;color:rgba(255,255,255,0.3);text-align:right">Confidential</div></div></div><button class="no-print" onclick="window.print()" style="position:fixed;bottom:28px;right:28px;background:#0f1a2a;color:white;border:none;padding:13px 22px;border-radius:10px;font-size:13px;font-weight:700;cursor:pointer;box-shadow:0 4px 20px rgba(0,0,0,0.3)">🖨️ Print / Save as PDF</button></body></html>`;
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
    URL.revokeObjectURL(url);
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

  // ══════ SCANNING ══════
  if(state==='scanning'){
    return(<div><Hdr step={1}/><div style={{maxWidth:700,margin:'0 auto',padding:'80px 24px',textAlign:'center'}}><div style={{width:56,height:56,border:'4px solid #e5e8ee',borderTopColor:'#e67e22',borderRadius:'50%',animation:'spin 0.8s linear infinite',margin:'0 auto 20px'}}/><div style={{fontSize:17,fontWeight:700,color:'#1a2a3a',marginBottom:8}}>{brief.website?`Scanning ${brief.website}`:'Analysing transcript...'}</div><div style={{fontSize:13,color:'#7a8a9a'}}>{brief.website?'AI is visiting the site — 20–40 seconds...':'Extracting services, USPs and campaign context...'}</div></div></div>);
  }

  // ══════ STEER ══════
  if(state==='steer'&&scanResult){
    const sr=scanResult;const allSvcs=sr.detectedServices||[];
    const selectedSvcCount=selectedSvcs.length+(customSvcs.split('\n').filter(s=>s.trim()).length);
    return(<div><Hdr step={2}/><div style={{maxWidth:860,margin:'0 auto',padding:24}}>
      <Err/>
      <div style={{background:'#fff',border:'1px solid #e5e8ee',borderRadius:12,padding:24,marginBottom:20}}>
        <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',gap:16,flexWrap:'wrap',marginBottom:16}}>
          <div>
            <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:4}}>
              <div style={{fontSize:11,fontWeight:700,padding:'3px 10px',borderRadius:12,background:sr.confidence==='high'?'#dcfce7':sr.confidence==='medium'?'#fef9c3':'#fee2e2',color:sr.confidence==='high'?'#166534':sr.confidence==='medium'?'#854d0e':'#991b1b'}}>{sr.confidence==='high'?'✓ HIGH':sr.confidence==='medium'?'⚠ MEDIUM':'⚠ LOW'} CONFIDENCE</div>
            </div>
            <div style={{fontFamily:"'Playfair Display',serif",fontSize:22,fontWeight:700}}>{sr.businessName}</div>
            <div style={{fontSize:13,color:'#5a6a7a',marginTop:4,maxWidth:540}}>{sr.description}</div>
          </div>
          <button onClick={()=>{setState('brief');setScanResult(null);}} style={{padding:'7px 14px',borderRadius:8,border:'1px solid #e0e5ec',background:'#f8f9fc',color:'#5a6a7a',fontSize:12,fontWeight:600,cursor:'pointer'}}>← Edit Brief</button>
        </div>
        {stagingWarning&&<div style={{padding:'10px 14px',borderRadius:8,background:'#fef2f2',border:'1px solid #fca5a5',color:'#991b1b',fontSize:13}}>🚧 <b>Staging URL detected.</b> Review services carefully.</div>}
      </div>
      <BrandSignalsPanel brief={brief} up={up} upTs={upTs} expandedSections={expandedSections} toggleSection={toggleSection}/>
      <div style={{background:'#fff',border:'1px solid #e5e8ee',borderRadius:12,padding:24,marginBottom:20}}>
        <div style={{fontFamily:"'Playfair Display',serif",fontSize:20,fontWeight:700,marginBottom:4}}>🏷️ Business Type</div>
        <div style={{fontSize:13,color:'#7a8a9a',marginBottom:14}}>Determines campaign goals, CTAs, and copy strategy.</div>
        <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:10}}>
          {[{v:'leadGen',icon:'🎯',label:'Lead Generation',desc:'Enquiries, quotes, bookings, calls'},{v:'ecommerce',icon:'🛍️',label:'Ecommerce',desc:'Online product sales with cart/checkout'},{v:'hybrid',icon:'🔀',label:'Hybrid',desc:'Both services AND online products'}].map(opt=>{const sel=brief.businessType===opt.v;return(<div key={opt.v} onClick={()=>up('businessType',opt.v)} style={{border:`2px solid ${sel?'#e67e22':'#e0e5ec'}`,borderRadius:10,padding:'14px 16px',cursor:'pointer',background:sel?'#fff3e8':'#fff'}}><div style={{fontSize:22,marginBottom:6}}>{opt.icon}</div><div style={{fontWeight:700,fontSize:14,color:sel?'#b45309':'#1a2a3a',marginBottom:3}}>{opt.label}</div><div style={{fontSize:12,color:'#6b7280',lineHeight:1.4}}>{opt.desc}</div></div>);})}
        </div>
      </div>
      <div style={{background:'#fff',border:'1px solid #e5e8ee',borderRadius:12,padding:24,marginBottom:20}}>
        <div style={{fontFamily:"'Playfair Display',serif",fontSize:20,fontWeight:700,marginBottom:4}}>🗂️ Campaign Mix</div>
        <div style={{fontSize:13,color:'#7a8a9a',marginBottom:12}}>Select which campaigns to generate.</div>
        <div style={{display:'grid',gap:8,marginBottom:16}}>
          {CAMPAIGN_TYPES.map(ct=>{const sel=selectedCampaignTypes.includes(ct.key);return(<div key={ct.key} className={`ctype-card${sel?' selected':''}${ct.always?' always-on':''}`} onClick={()=>toggleCampaignType(ct.key)}><div style={{display:'flex',alignItems:'flex-start',gap:12}}><div style={{width:18,height:18,borderRadius:4,border:`2px solid ${sel?ct.color:'#d0d5dd'}`,background:sel?ct.color:'#fff',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0,marginTop:2,color:'#fff',fontSize:11,fontWeight:700}}>{sel?'✓':''}</div><div style={{flex:1}}><div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}><span style={{fontWeight:700,fontSize:14}}>{ct.icon} {ct.label}</span><span className={`budget-tag ${ct.budgetTag}`}>{ct.budgetLabel}</span>{ct.always&&<span style={{fontSize:10,color:'#9aa5b0',fontWeight:600}}>Always included</span>}</div><div style={{fontSize:12,color:'#5a6a7a',marginTop:3}}>{ct.desc}</div><div style={{fontSize:11,color:'#9aa5b0',marginTop:2,fontStyle:'italic'}}>{ct.budgetNote}</div></div></div></div>);})}
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
        <div style={{fontSize:13,color:'#7a8a9a',marginBottom:12}}>Each selected service = one ad group in Targeted Search.</div>
        <div style={{display:'grid',gap:8,marginBottom:16}}>
          {allSvcs.map((svc,i)=>(<div key={i} className={`svc-chip${selectedSvcs.includes(i)?' selected':''}`} onClick={()=>toggleSvc(i)}><div className="check">{selectedSvcs.includes(i)?'✓':''}</div><div style={{flex:1}}><div style={{fontWeight:600,fontSize:13}}>{svc.name}</div>{svc.description&&<div style={{fontSize:11,color:'#8a95a5',marginTop:1}}>{svc.description}</div>}</div>{!svc.advertisable&&<span style={{fontSize:10,padding:'2px 8px',borderRadius:10,background:'#f0f2f5',color:'#8a95a5',fontWeight:600}}>non-ad</span>}</div>))}
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
      </div>
      <div style={{textAlign:'center',padding:'8px 0 32px'}}>
        <button onClick={generate} disabled={selectedSvcCount===0||!brief.businessName} style={{padding:'14px 44px',borderRadius:10,border:'none',background:(selectedSvcCount===0||!brief.businessName)?'#e0e5ec':'linear-gradient(135deg, #e67e22, #f39c12)',color:(selectedSvcCount===0||!brief.businessName)?'#9aa5b0':'white',fontSize:16,fontWeight:700,cursor:(selectedSvcCount===0||!brief.businessName)?'not-allowed':'pointer',boxShadow:(selectedSvcCount===0||!brief.businessName)?'none':'0 4px 16px rgba(230,126,34,0.35)'}}>✨ Generate All Campaigns</button>
      </div>
    </div></div>);
  }

  // ══════ LOADING ══════
  if(state==='loading'){
    return(<div><Hdr step={3}/><div style={{maxWidth:700,margin:'0 auto',padding:'80px 24px',textAlign:'center'}}><div style={{width:56,height:56,border:'4px solid #e5e8ee',borderTopColor:'#e67e22',borderRadius:'50%',animation:'spin 0.8s linear infinite',margin:'0 auto 20px'}}/><div style={{fontSize:17,fontWeight:700,color:'#1a2a3a',marginBottom:8}}>{loadingMsg}</div><div style={{display:'flex',gap:8,justifyContent:'center',marginTop:20,flexWrap:'wrap'}}>{selectedCampaignTypes.map((key,i)=>{const ct=CAMPAIGN_TYPES.find(c=>c.key===key);const done=i<loadingStep-1;const active=i===loadingStep-1;return(<div key={key} style={{padding:'6px 14px',borderRadius:20,fontSize:12,fontWeight:600,background:done?'#dcfce7':active?'#fff3e8':'#f0f2f5',color:done?'#166534':active?'#b45309':'#8a95a5',border:`1px solid ${done?'#bbf7d0':active?'#fcd34d':'#e0e5ec'}`}}>{done?'✓ ':active?'⟳ ':''}{ct?.icon} {ct?.label}</div>);})}</div></div></div>);
  }

  // ══════ RESULTS ══════
  if(state==='results'&&gen){
    const g=gen;const allCsvs=buildAllCSVs();
    const totalKw=Object.values(g).reduce((s,v)=>v&&v.adGroups?s+kwStats(v.adGroups).total:s,0);
    return(<div><Hdr step={4}/><div style={{maxWidth:980,margin:'0 auto',padding:24}}>
      <Err/>
      <div style={{display:'flex',gap:12,marginBottom:20,flexWrap:'wrap',alignItems:'center'}}>
        <Btn onClick={()=>setState('steer')} bg="#f5f3ff" color="#7c3aed" border="1px solid #d4b4ff">← Back</Btn>
        <Btn onClick={generate} bg="#f5f3ff" color="#7c3aed" border="1px solid #d4b4ff">🔄 Regenerate All</Btn>
        <div style={{display:'flex',gap:10,marginLeft:'auto'}}>
          <button onClick={exportStrategyDoc} style={{padding:'12px 22px',borderRadius:10,border:'none',background:'linear-gradient(135deg, #1a4b8c, #2563eb)',color:'white',fontSize:14,fontWeight:700,cursor:'pointer',boxShadow:'0 4px 14px rgba(26,75,140,0.3)'}}>📄 Strategy Doc</button>
          <button onClick={downloadAllCSVs} style={{padding:'12px 22px',borderRadius:10,border:'none',background:'linear-gradient(135deg, #059669, #10b981)',color:'white',fontSize:14,fontWeight:700,cursor:'pointer',boxShadow:'0 4px 14px rgba(5,150,105,0.35)'}}>⬇️ {allCsvs.length} CSVs</button>
        </div>
      </div>
      <div style={{display:'flex',gap:10,marginBottom:24,flexWrap:'wrap'}}>
        <SC n={selectedCampaignTypes.length} l="Campaigns" color="#6d28d9"/><SC n={allCsvs.length} l="CSV Files" color="#0891b2"/><SC n={totalKw} l="Keywords"/><SC n={(g.targetedSearch?.adGroups||[]).length} l="Targeted AGs" color="#b45309"/>
      </div>
      <div style={{background:'#fff',border:'1px solid #e5e8ee',borderRadius:12,padding:20,marginBottom:24}}>
        <div style={{fontFamily:"'Playfair Display',serif",fontSize:18,fontWeight:700,marginBottom:12}}>📋 Files ({allCsvs.length})</div>
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(260px,1fr))',gap:8}}>
          {allCsvs.map(({name,cols,rows},i)=>(<div key={i} style={{padding:'10px 14px',borderRadius:8,background:'#f8f9fc',border:'1px solid #e5e8ee',fontSize:12,display:'flex',alignItems:'center',justifyContent:'space-between',gap:10}}><div><div style={{fontWeight:700,color:'#1a2a3a'}}>{name}.csv</div><div style={{color:'#6b7280',fontSize:11,marginTop:2}}>{rows.length} rows</div></div><button onClick={()=>downloadSingleCSV(name,cols,rows)} style={{padding:'6px 12px',borderRadius:6,border:'1px solid #059669',background:'#fff',color:'#059669',fontSize:11,fontWeight:700,cursor:'pointer',whiteSpace:'nowrap',flexShrink:0}}>⬇️</button></div>))}
        </div>
      </div>
      {g.branded&&(<CampSection title={`⭐ ${campName('branded')}`} color="#1a4b8c" bg="#edf4ff" expanded={expandedSections.branded} onToggle={()=>toggleSection('branded')}><IB type="info">Branded · Target Impression Share · ~{brief.currencySymbol}{getEffectiveBudget('branded')}/day</IB>{g.branded.adGroups.map((ag,i)=><AgCard key={i} ag={ag} agi={`b_${i}`} brief={brief} gen={g} setGen={setGen} expAgs={expAgs} setExpAgs={setExpAgs} campKey="branded" copyAngle={copyAngle} setCopyAngle={setCopyAngle} expCopy={expCopy} setExpCopy={setExpCopy} adCopyLoading={adCopyLoading} generateAdCopy={generateAdCopy}/>)}</CampSection>)}
      {g.targetedSearch&&(<CampSection title={`🎯 ${campName('targetedSearch')}`} color="#b45309" bg="#fff3e8" expanded={expandedSections.targetedSearch} onToggle={()=>toggleSection('targetedSearch')}>{g.targetedSearch.adGroups.map((ag,i)=><AgCard key={i} ag={ag} agi={`ts_${i}`} brief={brief} gen={g} setGen={setGen} expAgs={expAgs} setExpAgs={setExpAgs} campKey="targetedSearch" copyAngle={copyAngle} setCopyAngle={setCopyAngle} expCopy={expCopy} setExpCopy={setExpCopy} adCopyLoading={adCopyLoading} generateAdCopy={generateAdCopy}/>)}</CampSection>)}
      {g.pmax&&(<CampSection title={`🚀 ${campName('pmax')}`} color="#6d28d9" bg="#f5f3ff" expanded={expandedSections.pmax} onToggle={()=>toggleSection('pmax')}><IB type="warning">Upload image assets and logo before enabling.</IB>{(g.pmax.assetGroups||[]).map((ag,i)=>(<div key={i} style={{background:'#fff',border:'1px solid #e5e8ee',borderRadius:10,padding:16,marginBottom:12}}><div style={{fontWeight:700,fontSize:14,color:'#6d28d9',marginBottom:8}}>{ag.name}</div><div style={{display:'flex',flexWrap:'wrap',gap:4,marginBottom:10}}>{(ag.headlines||[]).filter(Boolean).map((h,j)=><span key={j} style={{padding:'3px 8px',borderRadius:5,fontSize:11,background:'#f5f3ff',color:'#4c1d95',border:'1px solid #ddd6fe',fontFamily:'monospace'}}>{h}</span>)}</div>{(ag.descriptions||[]).filter(Boolean).map((d,j)=><div key={j} style={{padding:'4px 8px',borderRadius:5,fontSize:12,background:'#f8f9fc',marginBottom:3}}>{d}</div>)}</div>))}</CampSection>)}
      {g.demandGen&&(<CampSection title={`📺 ${campName('demandGen')}`} color="#0e7490" bg="#ecfeff" expanded={expandedSections.demandGen} onToggle={()=>toggleSection('demandGen')}>{(g.demandGen.adGroups||[]).map((ag,i)=>(<div key={i} style={{background:'#fff',border:'1px solid #cffafe',borderRadius:10,padding:16,marginBottom:12}}><div style={{fontWeight:700,fontSize:14,color:'#0e7490',marginBottom:8}}>{ag.audienceTheme}</div><div style={{display:'flex',flexWrap:'wrap',gap:5,marginBottom:8}}>{(ag.audienceTargeting||[]).map((a,j)=><span key={j} style={{padding:'3px 10px',borderRadius:12,fontSize:11,background:'#cffafe',color:'#0e7490',border:'1px solid #67e8f9'}}>{a}</span>)}</div>{ag.videoConceptBrief&&<div style={{padding:'8px 12px',borderRadius:6,background:'#f0fdf4',border:'1px solid #bbf7d0',fontSize:12,color:'#166534'}}>🎬 {ag.videoConceptBrief}</div>}</div>))}</CampSection>)}
      {g.searchRemarketing&&(<CampSection title={`🔁 ${campName('searchRemarketing')}`} color="#be123c" bg="#fff1f2" expanded={expandedSections.searchRemarketing} onToggle={()=>toggleSection('searchRemarketing')}><IB type="warning">Requires 1,000+ users in remarketing audiences.</IB>{(g.searchRemarketing.adGroups||[]).map((ag,i)=><AgCard key={i} ag={ag} agi={`rlsa_${i}`} brief={brief} gen={g} setGen={setGen} expAgs={expAgs} setExpAgs={setExpAgs} campKey="searchRemarketing" showAudience={true} copyAngle={copyAngle} setCopyAngle={setCopyAngle} expCopy={expCopy} setExpCopy={setExpCopy} adCopyLoading={adCopyLoading} generateAdCopy={generateAdCopy}/>)}</CampSection>)}
      {g.displayRemarketing&&(<CampSection title={`🖼️ ${campName('displayRemarketing')}`} color="#047857" bg="#ecfdf5" expanded={expandedSections.displayRemarketing} onToggle={()=>toggleSection('displayRemarketing')}>{(g.displayRemarketing.adGroups||[]).map((ag,i)=>(<div key={i} style={{background:'#fff',border:'1px solid #d1fae5',borderRadius:10,padding:16,marginBottom:12}}><div style={{fontWeight:700,fontSize:14,color:'#047857'}}>{ag.name}</div><div style={{fontSize:12,color:'#5a6a7a',marginTop:2,marginBottom:8}}>Audience: {ag.audienceList} · {ag.audienceDuration}</div><div style={{display:'flex',flexWrap:'wrap',gap:4}}>{(ag.headlines||[]).map((h,j)=><span key={j} style={{padding:'3px 8px',background:'#f0fdf4',borderRadius:5,fontSize:11}}>{h}</span>)}</div></div>))}</CampSection>)}
      <div style={{display:'flex',gap:12,justifyContent:'center',padding:'24px 0 8px',flexWrap:'wrap'}}>
        <button onClick={exportStrategyDoc} style={{padding:'14px 32px',borderRadius:10,border:'none',background:'linear-gradient(135deg, #1a4b8c, #2563eb)',color:'white',fontSize:15,fontWeight:700,cursor:'pointer',boxShadow:'0 6px 20px rgba(26,75,140,0.3)'}}>📄 Export Strategy Doc</button>
        <button onClick={downloadAllCSVs} style={{padding:'14px 32px',borderRadius:10,border:'none',background:'linear-gradient(135deg, #059669, #10b981)',color:'white',fontSize:15,fontWeight:700,cursor:'pointer',boxShadow:'0 6px 20px rgba(5,150,105,0.35)'}}>⬇️ Download {allCsvs.length} CSVs</button>
      </div>
    </div></div>);
  }

  // ══════ BRIEF ══════
  return(<div><Hdr step={0}/><div style={{maxWidth:800,margin:'0 auto',padding:24}}>
    <Err/>
    <div style={{background:'#fff',border:'1px solid #e5e8ee',borderRadius:12,padding:28,marginBottom:20}}>
      <div style={{fontFamily:"'Playfair Display',serif",fontSize:22,fontWeight:700,marginBottom:4}}>🧭 Campaign Direction</div>
      <div style={{fontSize:13,color:'#7a8a9a',marginBottom:14}}>How does this business make money?</div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:10}}>
        {[{v:'leadGen',icon:'🎯',label:'Lead Generation',desc:'Enquiries, quotes, bookings, calls'},{v:'ecommerce',icon:'🛍️',label:'Ecommerce',desc:'Online product sales with cart/checkout'},{v:'hybrid',icon:'🔀',label:'Hybrid',desc:'Both services AND online products'}].map(opt=>{const sel=brief.businessType===opt.v;return(<div key={opt.v} onClick={()=>up('businessType',opt.v)} style={{border:`2px solid ${sel?'#e67e22':'#e0e5ec'}`,borderRadius:10,padding:'14px 16px',cursor:'pointer',background:sel?'#fff3e8':'#fff'}}><div style={{fontSize:22,marginBottom:6}}>{opt.icon}</div><div style={{fontWeight:700,fontSize:13,color:sel?'#b45309':'#1a2a3a',marginBottom:3}}>{opt.label}</div><div style={{fontSize:11,color:'#7a8a9a',lineHeight:1.4}}>{opt.desc}</div></div>);})}
      </div>
    </div>
    <div style={{background:'#fff',border:'1px solid #e5e8ee',borderRadius:12,padding:28,marginBottom:20}}>
      <div style={{fontFamily:"'Playfair Display',serif",fontSize:22,fontWeight:700,marginBottom:4}}>🌐 Website & Business</div>
      <IB type="ai">✨ Enter URL and scan — AI detects services. Keywords validated via Google Ads API.</IB>
      <Fld label="Website URL *" value={brief.website} onChange={v=>up('website',v)} ph="https://www.example.co.za"/>
      <div style={{marginBottom:20}}>
        <button onClick={scanWebsite} disabled={!brief.website} style={{padding:'11px 28px',borderRadius:9,border:'none',background:!brief.website?'#e0e5ec':'linear-gradient(135deg, #e67e22, #f39c12)',color:!brief.website?'#9aa5b0':'white',fontSize:14,fontWeight:700,cursor:!brief.website?'not-allowed':'pointer'}}>🔍 Scan Website</button>
        <span style={{fontSize:12,color:'#9aa5b0',marginLeft:12}}>AI reads the site · ~20 seconds</span>
      </div>
      <div style={{borderTop:'1px solid #f0f2f5',paddingTop:20}}>
        <div style={{fontSize:13,color:'#7a8a9a',marginBottom:16}}>Or fill in manually:</div>
        <Fld label="Business Name *" value={brief.businessName} onChange={v=>up('businessName',v)}/>
        <TA label="Business Description" value={brief.description} onChange={v=>up('description',v)} ph="What do they do?"/>
        <Fld label="Industry" value={brief.industry} onChange={v=>up('industry',v)}/>
        <TA label="Target Customer" value={brief.targetCustomer} onChange={v=>up('targetCustomer',v)}/>
        <TA label="USPs / Key Benefits (one per line)" value={brief.usps} onChange={v=>up('usps',v)}/>
      </div>
    </div>
    <div style={{background:'#fff',border:'1px solid #e5e8ee',borderRadius:12,padding:28,marginBottom:20}}>
      <div style={{fontFamily:"'Playfair Display',serif",fontSize:22,fontWeight:700,marginBottom:4}}>🎙️ Meeting Transcript</div>
      <IB type="ai">✨ Paste a transcript to auto-extract services, USPs and campaign angles.</IB>
      <div style={{marginBottom:14}}>
        <label style={{display:'block',fontWeight:600,fontSize:13,color:'#3a4a5a',marginBottom:5}}>Transcript (optional)</label>
        <textarea value={transcript} onChange={e=>setTranscript(e.target.value)} placeholder="Paste transcript here..." style={{width:'100%',padding:'10px 14px',border:'2px solid #e0e5ec',borderRadius:8,fontSize:13,outline:'none',minHeight:120,resize:'vertical',background:'#fff',color:'#1a2a3a',lineHeight:1.6}}/>
      </div>
      {transcript.trim()&&(<button onClick={parseTranscript} style={{padding:'11px 28px',borderRadius:9,border:'none',background:'linear-gradient(135deg,#7c3aed,#a78bfa)',color:'white',fontSize:14,fontWeight:700,cursor:'pointer',boxShadow:'0 4px 12px rgba(124,58,237,0.3)'}}>🎙️ Extract from Transcript</button>)}
    </div>
    <div style={{background:'#fff',border:'1px solid #e5e8ee',borderRadius:12,padding:28,marginBottom:20}}>
      <div style={{fontFamily:"'Playfair Display',serif",fontSize:22,fontWeight:700,marginBottom:16}}>⚙️ Campaign Settings</div>
      <div style={{display:'flex',gap:16}}><Fld label="Total Daily Budget" value={brief.dailyBudget} onChange={v=>up('dailyBudget',parseFloat(v)||0)} type="number"/><Sel label="Currency" value={brief.currencySymbol} onChange={v=>up('currencySymbol',v)} options={[{v:'R',l:'ZAR (R)'},{v:'$',l:'USD ($)'},{v:'£',l:'GBP (£)'},{v:'€',l:'EUR (€)'}]}/></div>
      <div style={{display:'flex',gap:16}}><Sel label="Bid Strategy" value={brief.bidStrategy} onChange={v=>up('bidStrategy',v)} options={[{v:'Maximize conversions',l:'Max Conversions'},{v:'Maximize clicks',l:'Max Clicks'},{v:'Target CPA',l:'Target CPA'},{v:'Manual CPC',l:'Manual CPC'}]}/><Sel label="Language" value={brief.language} onChange={v=>up('language',v)} options={[{v:'en',l:'English'},{v:'af',l:'Afrikaans'},{v:'fr',l:'French'},{v:'de',l:'German'}]}/></div>
      <LocationTargeting locations={brief.locations} onChange={v=>up('locations',v)}/>
      <Sel label="Keyword Volume Location" value={brief.locationCode} onChange={v=>up('locationCode',parseInt(v))} options={LOCATION_OPTIONS}/>
    </div>
  </div></div>);
}

// ── Shared Components ─────────────────────────────────────────────────────────

function CampSection({title,color,bg,expanded,onToggle,children}){
  return(<div className="camp-section"><div className="camp-section-hdr" style={{background:bg}} onClick={onToggle}><div style={{fontFamily:"'Playfair Display',serif",fontSize:18,fontWeight:700,color}}>{title}</div><div style={{fontSize:16,color,fontWeight:700}}>{expanded?'▾':'▸'}</div></div>{expanded&&<div className="camp-section-body">{children}</div>}</div>);
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
    setGen({...gen,[campKey]:{...gen[campKey],adGroups:gen[campKey].adGroups.map((a,i)=>i===agIdx?{...a,keywords:a.keywords.filter(k=>!k.volumeChecked||k.hasVolume)}:a)}});
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

  return(<div style={{background:'#f8f9fc',border:'1px solid #e5e8ee',borderRadius:10,padding:16,marginBottom:12}}>
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:8,flexWrap:'wrap',gap:8}}>
      <div>
        <div style={{fontWeight:700,fontSize:14}}>{ag.name}</div>
        <div style={{fontSize:12,color:'#8a95a5'}}>{tot} kw{ex>0?` · ${ex} exact`:''}{ph>0?` · ${ph} phrase`:''}{br>0?` · ${br} broad`:''}{ag.defaultCpc?` · CPC: ${brief.currencySymbol}${(parseFloat(ag.defaultCpc)||10).toFixed(2)}`:''}</div>
        {showAudience&&ag.audienceList&&<div style={{fontSize:12,color:'#be123c',marginTop:2}}>🎯 {ag.audienceList} {ag.bidAdjustment&&`(${ag.bidAdjustment})`}</div>}
        {hasVolumeData&&(<div style={{display:'flex',gap:8,marginTop:4,flexWrap:'wrap',alignItems:'center'}}>
          <span style={{fontSize:11,color:'#166534',background:'#dcfce7',border:'1px solid #bbf7d0',padding:'2px 8px',borderRadius:10}}>✓ {checked.length-noVol.length} have volume</span>
          {noVol.length>0&&<span style={{fontSize:11,color:'#991b1b',background:'#fef2f2',border:'1px solid #fca5a5',padding:'2px 8px',borderRadius:10}}>⚠️ {noVol.length} zero</span>}
          {noVol.length>0&&<button onClick={removeNoVolume} style={{fontSize:11,color:'#991b1b',background:'#fff',border:'1px solid #fca5a5',padding:'2px 10px',borderRadius:10,cursor:'pointer',fontWeight:600}}>Remove zero-volume</button>}
        </div>)}
      </div>
    </div>
    <div style={{display:'flex',flexWrap:'wrap',gap:5,marginBottom:8}}>
      {(ag.keywords||[]).map((kw,ki)=>(<span key={ki} className={kw.matchType==='Phrase'?'match-phrase':kw.matchType==='Broad'?'':'match-exact'} style={{display:'inline-flex',alignItems:'center',gap:4,padding:'3px 10px',borderRadius:20,fontSize:11,fontFamily:'monospace',background:kw.matchType==='Broad'?'#f3f4f6':'',color:kw.matchType==='Broad'?'#374151':'',border:kw.matchType==='Broad'?'1px solid #e5e7eb':'',opacity:kw.volumeChecked&&!kw.hasVolume?0.7:1}}>
        {kw.matchType==='Exact'?`[${kw.text}]`:kw.matchType==='Phrase'?`"${kw.text}"`:kw.text}
        <VolBadge kw={kw}/>
        {kw.cpc&&kw.hasVolume&&<span style={{fontSize:9,color:'#6b7280',marginLeft:2}}>R{kw.cpc}</span>}
        <span style={{cursor:'pointer',color:'#aaa',fontSize:13}} onClick={()=>{const agIdx=gen[campKey].adGroups.indexOf(ag);setGen({...gen,[campKey]:{...gen[campKey],adGroups:gen[campKey].adGroups.map((a,i)=>i===agIdx?{...a,keywords:a.keywords.filter((_,j)=>j!==ki)}:a)}});}}>×</span>
      </span>))}
    </div>
    {(()=>{
      const agIdx=(gen[campKey].adGroups||[]).indexOf(ag);
      const loadKey=`${campKey}-${agIdx}`;
      const isLoading=!!adCopyLoading[loadKey];
      const copyOpen=!!expCopy[agi];
      return(<div style={{marginTop:8}}>
        <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
          <span style={{fontSize:12,color:'#e67e22',cursor:'pointer',fontWeight:600}} onClick={()=>setExpCopy(p=>({...p,[agi]:!p[agi]}))}>{copyOpen?'▾ Hide ad copy':'▸ Show ad copy'}</span>
          <button disabled={isLoading} onClick={()=>generateAdCopy(campKey,agIdx)} style={{padding:'4px 12px',borderRadius:6,border:'1px solid #e67e22',background:isLoading?'#f0f2f5':'#fff8f3',color:isLoading?'#9aa5b0':'#e67e22',fontSize:12,fontWeight:600,cursor:isLoading?'not-allowed':'pointer',marginLeft:'auto'}}>{isLoading?'Generating...':'✍️ Regenerate Copy'}</button>
        </div>
        {copyOpen&&(()=>{
          const ad=(ag.ads||[])[0]||{};
          const headlines=ad.headlines||Array(8).fill('');
          const descriptions=ad.descriptions||Array(3).fill('');
          return(<div style={{marginTop:10,background:'#fff',border:'1px solid #e5e8ee',borderRadius:8,padding:14}}>
            <div style={{fontSize:11,fontWeight:700,color:'#5a6a7a',marginBottom:8}}>HEADLINES</div>
            {headlines.map((h,i)=>h&&(<div key={i} style={{display:'flex',gap:8,alignItems:'center',marginBottom:4}}><span style={{fontSize:10,color:'#9aa5b0',fontWeight:700,width:24}}>H{i+1}</span><span style={{fontSize:12,fontFamily:'monospace',flex:1}}>{h}</span><span style={{fontSize:10,color:h.length>30?'#dc2626':'#9aa5b0'}}>{h.length}/30</span></div>))}
            <div style={{fontSize:11,fontWeight:700,color:'#5a6a7a',marginBottom:8,marginTop:12}}>DESCRIPTIONS</div>
            {descriptions.map((d,i)=>d&&(<div key={i} style={{display:'flex',gap:8,alignItems:'flex-start',marginBottom:4}}><span style={{fontSize:10,color:'#9aa5b0',fontWeight:700,width:24,paddingTop:2}}>D{i+1}</span><span style={{fontSize:12,flex:1}}>{d}</span><span style={{fontSize:10,color:d.length>90?'#dc2626':'#9aa5b0'}}>{d.length}/90</span></div>))}
            {ad.path1&&<div style={{fontSize:11,color:'#6b7280',marginTop:8}}>Path: /{ad.path1}{ad.path2?'/'+ad.path2:''}</div>}
          </div>);
        })()}
      </div>);
    })()}
  </div>);
}

function Hdr({step}){
  const steps=['Brief','Steer','Generate','Results'];
  return(<div style={{background:'#0f1a2a',color:'white',padding:'14px 28px',display:'flex',alignItems:'center',gap:14,position:'sticky',top:0,zIndex:50,boxShadow:'0 2px 12px rgba(0,0,0,0.3)'}}>
    <div style={{width:34,height:34,borderRadius:8,background:'linear-gradient(135deg, #e67e22, #f1c40f)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:17,fontWeight:700}}>S</div>
    <div><div style={{fontWeight:700,fontSize:15}}>Syte Campaign Creator</div><div style={{fontSize:11,opacity:0.5}}>Multi-Campaign · Google Ads API · v6.3 · Build 2026-04-14 CSV match-type fix</div></div>
    {step!==undefined&&(<div style={{marginLeft:'auto',display:'flex',gap:6,alignItems:'center'}}>{steps.map((s,i)=>(<div key={i} style={{display:'flex',alignItems:'center',gap:4}}><div style={{width:24,height:24,borderRadius:'50%',background:i<step?'#059669':i===step?'#e67e22':'rgba(255,255,255,0.15)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:10,fontWeight:700,color:'white'}}>{i<step?'✓':i+1}</div>{i<3&&<div style={{width:16,height:2,background:i<step?'#059669':'rgba(255,255,255,0.15)',borderRadius:1}}/>}</div>))}</div>)}
    <div style={{fontSize:11,background:'linear-gradient(135deg, #7c3aed, #a78bfa)',padding:'4px 10px',borderRadius:10,fontWeight:700,marginLeft:8}}>v6.3 ✨</div>
  </div>);
}

function Fld({label,value,onChange,ph,type='text'}){return(<div style={{marginBottom:14,flex:1}}><label style={{display:'block',fontWeight:600,fontSize:13,color:'#3a4a5a',marginBottom:5}}>{label}</label><input type={type} value={value} placeholder={ph||''} onChange={e=>onChange(e.target.value)} style={{width:'100%',padding:'10px 14px',border:'2px solid #e0e5ec',borderRadius:8,fontSize:13,outline:'none',background:'#fff',color:'#1a2a3a'}}/></div>);}
function TA({label,value,onChange,ph}){return(<div style={{marginBottom:14}}><label style={{display:'block',fontWeight:600,fontSize:13,color:'#3a4a5a',marginBottom:5}}>{label}</label><textarea value={value} placeholder={ph||''} onChange={e=>onChange(e.target.value)} style={{width:'100%',padding:'10px 14px',border:'2px solid #e0e5ec',borderRadius:8,fontSize:13,outline:'none',minHeight:72,resize:'vertical',background:'#fff',color:'#1a2a3a'}}/></div>);}
function Sel({label,value,onChange,options}){
  const hasGroups=options.some(o=>o.g);
  const groups=hasGroups?[...new Set(options.map(o=>o.g||''))]:[];
  return(<div style={{marginBottom:14,flex:1}}><label style={{display:'block',fontWeight:600,fontSize:13,color:'#3a4a5a',marginBottom:5}}>{label}</label><select value={value} onChange={e=>onChange(e.target.value)} style={{width:'100%',padding:'10px 14px',border:'2px solid #e0e5ec',borderRadius:8,fontSize:13,outline:'none',background:'#fff'}}>
    {hasGroups?groups.map(g=>g?<optgroup key={g} label={g}>{options.filter(o=>o.g===g).map(o=><option key={o.v} value={o.v}>{o.l}</option>)}</optgroup>:options.filter(o=>!o.g).map(o=><option key={o.v} value={o.v}>{o.l}</option>)):options.map(o=><option key={o.v} value={o.v}>{o.l}</option>)}
  </select></div>);
}
function IB({type,children}){const s={info:{bg:'#edf4ff',b:'#b8d4fe',c:'#1a4b8c'},warning:{bg:'#fff8e1',b:'#ffe082',c:'#7a5e00'},ai:{bg:'#f5f3ff',b:'#d4b4ff',c:'#5b21b6'}}[type]||{bg:'#edf4ff',b:'#b8d4fe',c:'#1a4b8c'};return <div style={{padding:'12px 14px',borderRadius:8,fontSize:13,lineHeight:1.6,marginBottom:14,background:s.bg,border:'1px solid '+s.b,color:s.c}}>{children}</div>;}
function SC({n,l,color}){return(<div style={{flex:1,minWidth:80,background:'#fff',border:'1px solid #e5e8ee',borderRadius:8,padding:12,textAlign:'center'}}><div style={{fontSize:22,fontWeight:700,color:color||'#e67e22'}}>{n}</div><div style={{fontSize:11,color:'#8a95a5',marginTop:2}}>{l}</div></div>);}
function Btn({onClick,bg,color,border,children}){return(<button onClick={onClick} style={{padding:'9px 18px',borderRadius:8,border:border||'none',background:bg,color,fontSize:13,fontWeight:600,cursor:'pointer',display:'inline-flex',alignItems:'center',gap:5}}>{children}</button>);}

ReactDOM.createRoot(document.getElementById('root')).render(<App/>);
document.getElementById('copy-year').textContent=new Date().getFullYear();
