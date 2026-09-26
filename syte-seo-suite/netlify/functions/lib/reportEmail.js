// Internal operations emails for the automated pipeline (Mike's ask: Chris
// hears about every run, every publish and every failure without watching
// the suite):
//   - Autopilot run summary: what was written, held back (and why), pushed
//   - "Went live" digest from the publisher, including publish failures
//
// These go to the team only, never to a client, and only when a report
// address is set (syte_suite_settings 'autopilot-config' → report_email,
// editable in the Autopilot panel). No address means no email. Client-facing
// draft emails stay opt-in per client in notify-draft.js.

export const REPORT_CONFIG_ID = 'autopilot-config';
const FROM = 'Syte SEO Suite <noreply@syte.co.za>';

export function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function parseRecipients(value) {
  return String(value || '').split(/[,;\s]+/).map(s => s.trim()).filter(s => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s));
}

export async function reportRecipients(supabase) {
  const { data } = await supabase.from('syte_suite_settings').select('data').eq('id', REPORT_CONFIG_ID).maybeSingle();
  return parseRecipients(data?.data?.report_email);
}

export async function sendReport({ to, subject, html }) {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error('RESEND_API_KEY is not set in the Netlify environment');
  if (!to?.length) throw new Error('No report recipient set');
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
    body: JSON.stringify({ from: FROM, to, subject, html }),
    signal: AbortSignal.timeout(20000)
  });
  if (!res.ok) throw new Error('Resend ' + res.status + ': ' + (await res.text()).slice(0, 200));
}

const WRAP = body => `<div style="font-family:Arial,sans-serif;max-width:680px;margin:0 auto;color:#222">${body}</div>`;
const BTN = (href, label) => `<a href="${esc(href)}" style="display:inline-block;background:#111;color:#fff;padding:9px 18px;border-radius:6px;text-decoration:none;font-weight:bold">${esc(label)}</a>`;

// Summary of one Autopilot run for one client. previewFor(article) returns
// an in-theme preview link for it ('' for none).
export function buildRunSummaryEmail(client, state, siteUrl, previewFor = () => '') {
  const plan = state?.plan || [];
  const rows = plan.map((opp, i) => ({ opp, a: state.articles?.[i] || null }));
  const count = s => rows.filter(r => r.a?.status === s).length;
  const pushed = rows.filter(r => r.a?.push?.status === 'pushed');
  const pushFailed = rows.filter(r => r.a?.push?.status === 'failed');
  const failedRun = state?.status === 'failed';
  const needsAttention = failedRun || count('blocked') || count('failed') || pushFailed.length;

  const subject = (failedRun ? 'Autopilot FAILED: ' : needsAttention ? 'Autopilot — needs a look: ' : 'Autopilot done: ')
    + client.name + ' (' + (state?.month || '') + ')'
    + (plan.length ? ' — ' + count('ready') + '/' + plan.length + ' ready' + (pushed.length ? ', ' + pushed.length + ' drafted' : '') : '');

  const line = ({ opp, a }) => {
    let status = 'not written', color = '#777', detail = '';
    if (a?.status === 'ready') { status = 'Ready'; color = '#15803d'; }
    if (a?.status === 'blocked') {
      status = 'Held back'; color = '#b91c1c';
      const issues = [
        ...(a.check?.problems || []).filter(p => p.severity === 'error').map(p => p.issue),
        ...(a.relevance?.verdict === 'mismatch' ? (a.relevance.detail?.length ? a.relevance.detail : ['Off topic for this client']) : [])
      ];
      detail = issues.slice(0, 4).map(i => '<li>' + esc(i) + '</li>').join('');
    }
    if (a?.status === 'failed') { status = 'Failed'; color = '#b91c1c'; detail = '<li>' + esc(a.error) + '</li>'; }
    if (a?.status === 'skipped') { status = 'Already written'; }
    let push = '';
    if (a?.push?.status === 'pushed') {
      push = ' · <span style="color:#15803d">draft on the site</span>' + (a.push.admin_url ? ' (<a href="' + esc(a.push.admin_url) + '">open</a>)' : '');
      if (a.push.warnings?.length) detail += a.push.warnings.slice(0, 3).map(w => '<li style="color:#b45309">' + esc(w) + '</li>').join('');
    }
    if (a?.push?.status === 'failed') { push = ' · <span style="color:#b91c1c">push failed</span>'; detail += '<li>' + esc(a.push.error) + '</li>'; }
    const preview = a && (a.status === 'ready' || a.status === 'blocked') ? previewFor(a) : '';
    if (preview) push += ' · <a href="' + esc(preview) + '">preview in the site\'s design</a>';
    return `<tr><td style="padding:6px 8px;vertical-align:top;white-space:nowrap;color:${color};font-weight:bold">${esc(status)}</td>`
      + `<td style="padding:6px 8px">${esc(opp.topic_title)}${push}${detail ? '<ul style="margin:4px 0 0 16px;padding:0;font-size:13px">' + detail + '</ul>' : ''}</td></tr>`;
  };

  const notes = [state?.error, state?.scan_note, state?.research_note, state?.push_note].filter(Boolean);
  const html = WRAP(`
    <p><strong>${esc(client.name)}</strong> — Autopilot run for ${esc(state?.month || '')}${failedRun ? ' <strong style="color:#b91c1c">stopped with an error</strong>' : ''}.</p>
    ${notes.map(n => '<p style="color:' + (n === state?.error ? '#b91c1c' : '#555') + '">' + esc(n) + '</p>').join('')}
    ${rows.length ? '<table style="border-collapse:collapse;width:100%;font-size:14px">' + rows.map(line).join('') + '</table>' : ''}
    <p style="margin-top:18px">${BTN(siteUrl, 'Open the suite')}</p>
    <p style="color:#777;font-size:12px">Held-back articles were rejected by the topic check or the independent reviewer and were not pushed.
    ${pushed.length ? 'Drafts wait for approval in CMS → Push History; approved drafts go live within 15 minutes.' : 'Written articles are in Content → Auto Write.'}</p>`);
  return { subject, html };
}

// Summary of one Tech Autopilot scan: what goes on the board, what the
// independent check threw out as a false alarm, and what needs a person.
export function buildTechSummaryEmail(client, state, siteUrl) {
  const entries = state?.tasks || [];
  const by = v => entries.filter(e => e.check?.verdict === v);
  const confirmed = by('confirmed'), falseAlarms = by('false_alarm'), wrong = by('fix_wrong'), human = by('needs_human');
  const failedRun = state?.status === 'failed';
  const subject = (failedRun ? 'Tech scan FAILED: ' : (wrong.length || human.length) ? 'Tech scan — needs a look: ' : 'Tech scan done: ')
    + client.name + (entries.length ? ' — ' + confirmed.length + ' confirmed fix' + (confirmed.length === 1 ? '' : 'es') : '')
    + (falseAlarms.length ? ', ' + falseAlarms.length + ' false alarm' + (falseAlarms.length === 1 ? '' : 's') + ' removed' : '');
  const list = (items, color) => items.length
    ? '<ul style="font-size:14px">' + items.map(e => `<li style="margin-bottom:6px"><strong>${esc(e.task.title)}</strong>`
      + (e.task.page_url ? ` — <a href="${esc(e.task.page_url)}">${esc(e.task.page_url)}</a>` : '')
      + `<br/><span style="color:${color}">${esc(e.check?.reason || '')}</span></li>`).join('') + '</ul>'
    : '';
  const crawl = state?.crawl;
  const html = WRAP(`
    <p><strong>${esc(client.name)}</strong> — Technical SEO scan${crawl ? ' of ' + crawl.pages + ' pages' : ''}${failedRun ? ' <strong style="color:#b91c1c">stopped with an error</strong>' : ''}.</p>
    ${state?.error ? '<p style="color:#b91c1c">' + esc(state.error) + '</p>' : ''}
    ${confirmed.length ? '<p><strong>Confirmed fixes</strong> — now on the Technical SEO task board:</p>' + list(confirmed, '#15803d') : ''}
    ${wrong.length ? '<p><strong style="color:#b91c1c">Fix looks wrong</strong> — on the board, flagged; check before briefing:</p>' + list(wrong, '#b91c1c') : ''}
    ${human.length ? '<p><strong style="color:#b45309">Needs a human look</strong>:</p>' + list(human, '#b45309') : ''}
    ${falseAlarms.length ? '<p><strong>False alarms removed</strong> — the scanner flagged these, the independent check found they are fine:</p>' + list(falseAlarms, '#555') : ''}
    ${state?.repeats_skipped ? '<p style="color:#777">' + state.repeats_skipped + ' issue(s) skipped because the fix was already done in an earlier month.</p>' : ''}
    <p style="margin-top:18px">${BTN(siteUrl, 'Open the suite')}</p>`);
  return { subject, html };
}

// Digest from one publisher pass. results: [{ client, title, liveUrl, error }]
export function buildPublishedEmail(results, siteUrl) {
  const ok = results.filter(r => !r.error);
  const bad = results.filter(r => r.error);
  const subject = (bad.length ? 'Publish FAILED for ' + bad.length + (ok.length ? ', ' + ok.length + ' went live' : '') : ok.length + ' post' + (ok.length > 1 ? 's' : '') + ' went live')
    + ': ' + [...new Set(results.map(r => r.client))].join(', ');
  const item = r => r.error
    ? `<li style="margin-bottom:6px"><strong>${esc(r.client)}</strong> — ${esc(r.title)}<br/><span style="color:#b91c1c">${esc(r.error)}</span></li>`
    : `<li style="margin-bottom:6px"><strong>${esc(r.client)}</strong> — ${r.liveUrl ? '<a href="' + esc(r.liveUrl) + '">' + esc(r.title) + '</a>' : esc(r.title)}</li>`;
  const html = WRAP(`
    ${ok.length ? '<p>Now live:</p><ul>' + ok.map(item).join('') + '</ul>' : ''}
    ${bad.length ? '<p style="color:#b91c1c"><strong>Could not publish</strong> (still drafts, marked "publish failed" in Push History):</p><ul>' + bad.map(item).join('') + '</ul>' : ''}
    <p style="margin-top:18px">${BTN(siteUrl, 'Open the suite')}</p>
    <p style="color:#777;font-size:12px">Give the live pages a quick look — this is the moment a layout problem would show.</p>`);
  return { subject, html };
}
