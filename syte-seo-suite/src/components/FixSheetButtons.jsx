import React, { useState } from 'react';
import { signedFnUrl } from '../modules/cms/previewLink.js';

// "Fix sheet" for the selected client: the Technical SEO + AEO work the suite
// can't apply itself (netlify/functions/fix-sheet.js). Open = a printable page
// to send a developer (the link works without a suite login); Copy for Grok =
// the same brief as plain step-by-step text, on the clipboard.
export default function FixSheetButtons({ client, accent }) {
  const [msg, setMsg] = useState('');
  if (!client) return null;
  const btn = { fontSize: 12 };

  async function open() {
    // Open inside the click so the popup isn't blocked, then point it at the link.
    const tab = window.open('about:blank', '_blank');
    const url = await signedFnUrl('fix-sheet', 's', client.id);
    if (tab && url) tab.location.href = url;
    else if (tab) tab.close();
  }

  async function copyText() {
    setMsg('');
    try {
      const url = (await signedFnUrl('fix-sheet', 's', client.id)) + '&format=text';
      const res = await fetch(url);
      if (!res.ok) throw new Error('The fix sheet could not be built (' + res.status + ').');
      await navigator.clipboard.writeText(await res.text());
      setMsg('Copied — paste it into the Grok Bot (or an email).');
    } catch (e) { setMsg(e.message); }
  }

  async function copyLink() {
    setMsg('');
    try {
      const url = (await signedFnUrl('fix-sheet', 's', client.id));
      await navigator.clipboard.writeText(new URL(url, location.origin).href);
      setMsg('Link copied — it opens without a suite login.');
    } catch (e) { setMsg(e.message); }
  }

  return (
    <div className="row" style={{ gap: 8, marginTop: 10, flexWrap: 'wrap', alignItems: 'center' }}>
      <span className="muted" style={{ fontSize: 12 }}>Work the suite can't apply itself:</span>
      <button className="ghost" style={btn} onClick={open} title="A printable brief for a developer">Open fix sheet</button>
      <button className="ghost" style={btn} onClick={copyLink}>Copy link</button>
      <button className="ghost" style={{ ...btn, borderColor: accent, color: accent }} onClick={copyText}
        title="Step-by-step text to paste into a Grok Bot">Copy for Grok</button>
      {msg && <span className="muted" style={{ fontSize: 12 }}>{msg}</span>}
    </div>
  );
}
