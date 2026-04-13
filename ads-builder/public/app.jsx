// ═══════════════════════════════════════════════════════════════════════════
// Syte Campaign Creator v6.1 — Deployment Placeholder
// ═══════════════════════════════════════════════════════════════════════════
// 
// TO COMPLETE SETUP: Replace the contents of this file with the full app
// JavaScript from your corrected source code.
//
// Extract everything between <script type="text/babel"> and </script> from
// your working HTML file and paste it here.
// ═══════════════════════════════════════════════════════════════════════════

const {useState} = React;

function App() {
  const [status, setStatus] = useState('checking');
  const [apiOk, setApiOk] = useState(null);
  const [kwOk, setKwOk] = useState(null);
  const [scanOk, setScanOk] = useState(null);

  React.useEffect(() => {
    // Test claude-proxy
    fetch('/.netlify/functions/claude-proxy', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({model:'claude-sonnet-4-20250514',max_tokens:10,messages:[{role:'user',content:'hi'}]})
    }).then(r => setApiOk(r.ok)).catch(() => setApiOk(false));

    // Test keyword-planner
    fetch('/.netlify/functions/keyword-planner', {
      method: 'POST', 
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({keywords:['test'],locationCode:2710})
    }).then(r => setKwOk(r.ok)).catch(() => setKwOk(false));

    // Test scan-website (just check endpoint responds)
    fetch('/.netlify/functions/scan-website', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({url:'https://example.com'})
    }).then(r => setScanOk(r.status !== 405)).catch(() => setScanOk(false));

    setStatus('done');
  }, []);

  const Check = ({label, ok}) => (
    <div style={{display:'flex',alignItems:'center',gap:10,padding:'10px 16px',borderRadius:8,background:ok===null?'#f8f9fc':ok?'#f0fdf4':'#fef2f2',border:`1px solid ${ok===null?'#e5e8ee':ok?'#bbf7d0':'#fca5a5'}`}}>
      <span style={{fontSize:18}}>{ok===null?'⏳':ok?'✅':'❌'}</span>
      <span style={{fontSize:14,fontWeight:600,color:ok===null?'#6b7280':ok?'#166534':'#991b1b'}}>{label}</span>
      <span style={{fontSize:12,color:'#9aa5b0',marginLeft:'auto'}}>{ok===null?'Checking...':ok?'Connected':'Failed — check env vars'}</span>
    </div>
  );

  return (
    <div style={{maxWidth:700,margin:'0 auto',padding:'40px 24px'}}>
      <div style={{background:'#0f1a2a',color:'white',padding:'28px 32px',borderRadius:12,marginBottom:24,position:'relative',overflow:'hidden'}}>
        <div style={{position:'absolute',right:24,top:24,width:48,height:48,borderRadius:12,background:'linear-gradient(135deg,#e67e22,#f1c40f)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:24,fontWeight:700}}>S</div>
        <div style={{fontSize:11,fontWeight:700,letterSpacing:2,textTransform:'uppercase',color:'#e67e22',marginBottom:8}}>Deployment Test</div>
        <div style={{fontFamily:"'Playfair Display',serif",fontSize:28,fontWeight:700,marginBottom:4}}>Syte Campaign Creator</div>
        <div style={{fontSize:13,color:'rgba(255,255,255,0.5)'}}>v6.1 — Netlify Functions Health Check</div>
      </div>

      <div style={{display:'grid',gap:8,marginBottom:24}}>
        <Check label="Claude API Proxy (claude-proxy)" ok={apiOk}/>
        <Check label="Keyword Planner (DataForSEO)" ok={kwOk}/>
        <Check label="Website Scanner (scan-website)" ok={scanOk}/>
      </div>

      <div style={{background:'#fff',border:'1px solid #e5e8ee',borderRadius:12,padding:24}}>
        <div style={{fontSize:18,fontWeight:700,color:'#1a2a3a',marginBottom:8}}>🚀 Deployment Successful!</div>
        <div style={{fontSize:14,color:'#5a6a7a',lineHeight:1.7,marginBottom:16}}>
          The Netlify infrastructure is live. To complete setup, replace the contents of 
          <code style={{background:'#f0f2f5',padding:'2px 6px',borderRadius:4,fontSize:12}}>public/app.jsx</code> with 
          the full application JavaScript from your corrected source code.
        </div>
        <div style={{fontSize:13,color:'#5a6a7a',lineHeight:1.7}}>
          <strong>Steps:</strong>
          <ol style={{paddingLeft:20,marginTop:8}}>
            <li style={{marginBottom:6}}>Open your corrected HTML file</li>
            <li style={{marginBottom:6}}>Copy everything between <code style={{background:'#f0f2f5',padding:'2px 6px',borderRadius:4,fontSize:11}}>&lt;script type="text/babel"&gt;</code> and <code style={{background:'#f0f2f5',padding:'2px 6px',borderRadius:4,fontSize:11}}>&lt;/script&gt;</code></li>
            <li style={{marginBottom:6}}>Replace the contents of <code style={{background:'#f0f2f5',padding:'2px 6px',borderRadius:4,fontSize:11}}>public/app.jsx</code> with the copied code</li>
            <li>Commit, push, and redeploy</li>
          </ol>
        </div>
      </div>

      <div style={{marginTop:16,padding:'12px 16px',background:'#f5f3ff',border:'1px solid #ddd6fe',borderRadius:8,fontSize:12,color:'#5b21b6'}}>
        <strong>Environment Variables Required:</strong> ANTHROPIC_API_KEY, DATAFORSEO_LOGIN, DATAFORSEO_PASSWORD — 
        set these in the Netlify Dashboard under Site Settings → Environment Variables.
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App/>);
document.getElementById('copy-year').textContent = new Date().getFullYear();
