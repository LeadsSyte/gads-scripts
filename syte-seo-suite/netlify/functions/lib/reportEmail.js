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

import { sendMail } from './sendMail.js';
import { AUTO_FIX_TYPES } from './techFix.js';
import { fixKey } from './aeoFix.js';
import { aeoOptKey, canAutoAdd } from './aeoFixRun.js';

export const REPORT_CONFIG_ID = 'autopilot-config';

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
  if (!to?.length) throw new Error('No report recipient set');
  await sendMail({ to, subject, html });
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
      push = ' · <span style="color:#15803d">' + (a.push.approved ? 'going live within 15 minutes' : 'draft on the site') + '</span>' + (a.push.admin_url ? ' (<a href="' + esc(a.push.admin_url) + '">open</a>)' : '');
      if (a.push.held) detail += '<li style="color:#b45309">' + esc(a.push.held) + '</li>';
      if (a.push.warnings?.length) detail += a.push.warnings.slice(0, 3).map(w => '<li style="color:#b45309">' + esc(w) + '</li>').join('');
    }
    if (a?.push?.status === 'failed') { push = ' · <span style="color:#b91c1c">push failed</span>'; detail += '<li>' + esc(a.push.error) + '</li>'; }
    const preview = a && (a.status === 'ready' || a.status === 'blocked') ? previewFor(a) : '';
    if (preview) push += ' · <a href="' + esc(preview) + '">preview in the site\'s design</a>';
    return `<tr><td style="padding:6px 8px;vertical-align:top;white-space:nowrap;color:${color};font-weight:bold">${esc(status)}</td>`
      + `<td style="padding:6px 8px">${esc(opp.topic_title)}${push}${detail ? '<ul style="margin:4px 0 0 16px;padding:0;font-size:13px">' + detail + '</ul>' : ''}</td></tr>`;
  };

  const notes = [state?.error, state?.scan_note, state?.research_note, state?.push_note].filter(Boolean);
  const going = pushed.filter(r => r.a.push.approved);
  const drafts = pushed.filter(r => !r.a.push.approved);
  const unpushed = rows.filter(r => r.a?.status === 'ready' && !r.a.push);
  const held = count('blocked');
  const todo = [
    drafts.length ? `<strong>Approve ${plural(drafts.length, 'draft')}.</strong> Read ${drafts.length === 1 ? 'it' : 'them'} with the preview links below, then open the suite → CMS → Push History → <em>Approve</em>. Approved drafts go live within 15 minutes.` : '',
    unpushed.length ? `<strong>${plural(unpushed.length, 'article is', 'articles are')} written but not on the site.</strong> Open the suite → Content → Auto Write to push ${unpushed.length === 1 ? 'it' : 'them'}.` : '',
    pushFailed.length ? `<strong>${plural(pushFailed.length, 'article')} could not be put on the site.</strong> The reason is below.` : '',
    count('failed') ? `<strong>${plural(count('failed'), 'article')} could not be written.</strong> The reason is below.` : '',
    held ? `${plural(held, 'article was', 'articles were')} held back by the checker and not used. No action needed unless you want ${held === 1 ? 'it' : 'them'} rewritten.` : ''
  ].filter(Boolean);
  const html = WRAP(`
    <p style="font-size:15px"><strong>${esc(client.name)}</strong> — this month's articles (${esc(state?.month || '')})${failedRun ? ' <strong style="color:#b91c1c">stopped with an error</strong>' : ''}.</p>
    ${notes.map(n => '<p style="color:' + (n === state?.error ? '#b91c1c' : '#555') + '">' + esc(n) + '</p>').join('')}
    ${todoBox(todo)}
    ${going.length ? '<p style="font-size:14px;color:#15803d">' + plural(going.length, 'article') + ' passed every check and ' + (going.length === 1 ? 'is' : 'are') + ' going live. You will get a second email once ' + (going.length === 1 ? 'it is' : 'they are') + ' live and checked.</p>' : ''}
    ${rows.length ? '<table style="border-collapse:collapse;width:100%;font-size:14px">' + rows.map(line).join('') + '</table>' : ''}
    <p style="margin-top:18px">${BTN(siteUrl, 'Open the suite')}</p>`);
  return { subject, html };
}

// ── Technical SEO and AEO run emails ─────────────────────────────────────
// Written for someone who was not watching: what was done on the site, then
// the short list of things that need a person. `fixes` is what happened to
// each fix on the site (techStore.loadTechFixes / aeoStore.loadAeoFixes).

const plural = (n, one, many) => n + ' ' + (n === 1 ? one : (many || one + 's'));
const SECTION = (title, count, color = '#111') => `<h3 style="font-size:15px;margin:24px 0 6px;color:${color}">${esc(title)} (${count})</h3>`;
const PAGE = url => url ? ` — <a href="${esc(url)}">${esc(String(url).replace(/^https?:\/\/(www\.)?/, ''))}</a>` : '';
const LIVE = live => live?.status === 'verified'
  ? '<span style="color:#15803d">Checked: showing on the live page.</span>'
  : '<span style="color:#b45309">Saved on the site, but not showing on the live page yet (usually the page cache).</span>';

function todoBox(items) {
  const body = items.length
    ? '<ol style="margin:6px 0 0 18px;padding:0">' + items.map(i => '<li style="margin-bottom:4px">' + i + '</li>').join('') + '</ol>'
    : '<div style="margin-top:4px">Nothing. This is just to let you know.</div>';
  return `<div style="background:${items.length ? '#fff8e1' : '#f0fdf4'};border:1px solid ${items.length ? '#f0d58c' : '#bbf7d0'};border-radius:8px;padding:12px 16px;margin:14px 0;font-size:14px">
    <strong>What you need to do</strong>${body}</div>`;
}

export function techBuckets(state, fixes = new Map()) {
  const b = { done: [], waiting: [], failed: [], manual: [], unsure: [], removed: [], undone: [] };
  for (const e of state?.tasks || []) {
    const f = fixes.get(e.task?.id) || null;
    const v = e.check?.verdict;
    const x = { e, f };
    if (v === 'false_alarm') b.removed.push(x);
    else if (v !== 'confirmed') b.unsure.push(x);
    else if (f?.status === 'applied') b.done.push(x);
    else if (f?.status === 'undone') b.undone.push(x);
    else if (f?.status === 'not_needed') b.removed.push(x);
    else if (f?.status === 'failed') b.failed.push(x);
    else if (f?.status === 'manual' || !AUTO_FIX_TYPES.includes(e.task?.fix_type)) b.manual.push(x);
    else b.waiting.push(x);
  }
  return b;
}

function runSubject(client, what, b, failedRun, nothing) {
  if (failedRun) return 'FAILED — ' + client.name + ': ' + what + ' run stopped with an error';
  const parts = [
    b.done.length ? b.done.length + ' made on the site' : '',
    b.waiting.length ? b.waiting.length + ' waiting for your OK' : '',
    b.failed.length ? b.failed.length + ' could not be made' : '',
    b.unsure.length ? b.unsure.length + ' to look at' : '',
    b.manual.length ? b.manual.length + ' for a developer' : ''
  ].filter(Boolean);
  const action = b.waiting.length || b.failed.length || b.unsure.length;
  return (action ? 'Action needed — ' : '') + client.name + ': ' + what + ' — ' + (parts.length ? parts.join(', ') : nothing);
}

// opts: { fixes: Map taskId → status, fixSheetUrl }
export function buildTechSummaryEmail(client, state, siteUrl, { fixes = new Map(), fixSheetUrl = '' } = {}) {
  const b = techBuckets(state, fixes);
  const failedRun = state?.status === 'failed';
  const subject = runSubject(client, 'technical SEO', b, failedRun, 'nothing to fix this month');
  const pending = b.done.filter(x => x.f.live?.status !== 'verified');

  const todo = [
    b.waiting.length ? `<strong>Approve ${plural(b.waiting.length, 'fix', 'fixes')}.</strong> Open the suite → Technical SEO → New Scan → <em>Apply all</em>. You can preview each one first.` : '',
    b.failed.length ? `<strong>${plural(b.failed.length, 'fix', 'fixes')} could not be made.</strong> The reason is next to each one below.` : '',
    b.unsure.length ? `<strong>Look at ${plural(b.unsure.length, 'fix', 'fixes')}</strong> the checker was not sure about. Nothing was changed for these.` : '',
    b.manual.length ? `<strong>Pass ${plural(b.manual.length, 'fix', 'fixes')} to a developer or a Grok Bot.</strong> The suite can't make ${b.manual.length === 1 ? 'this one' : 'these'} itself.` + (fixSheetUrl ? ` <a href="${esc(fixSheetUrl)}">Open the fix sheet</a>.` : '') : '',
    pending.length ? `${plural(pending.length, 'change is', 'changes are')} saved but not showing yet. Clear the site's cache, or look again tomorrow.` : ''
  ].filter(Boolean);

  const change = r => `<div style="font-size:13px;margin-top:3px"><span style="color:#555">${esc(r.label)}</span><br/>`
    + `<span style="color:#777">Was:</span> ${r.from ? esc(r.from) : '<em>empty</em>'}<br/><span style="color:#777">Now:</span> <strong>${esc(r.to)}</strong></div>`;
  const item = (x, body) => `<li style="margin-bottom:12px"><strong>${esc(x.e.task.title)}</strong>${PAGE(x.e.task.page_url)}${body}</li>`;
  const reason = (x, color) => `<div style="font-size:13px;color:${color};margin-top:3px">${esc(x.f?.reason || x.f?.error || x.e.check?.reason || '')}</div>`;
  const list = (xs, body) => '<ul style="font-size:14px;padding-left:18px">' + xs.map(x => item(x, body(x))).join('') + '</ul>';
  const crawl = state?.crawl;

  const html = WRAP(`
    <p style="font-size:15px"><strong>${esc(client.name)}</strong> — this month's technical SEO check${crawl ? ' (' + crawl.pages + ' pages)' : ''}${failedRun ? ' <strong style="color:#b91c1c">stopped with an error</strong>' : ''}.</p>
    ${state?.error ? '<p style="color:#b91c1c">' + esc(state.error) + '</p>' : ''}
    ${state?.auto?.status === 'failed' || state?.auto?.status === 'skipped' ? '<p style="color:#b91c1c">' + esc(state.auto.reason || '') + '</p>' : ''}
    ${todoBox(todo)}
    ${b.done.length ? SECTION('Done on the site', b.done.length, '#15803d')
      + list(b.done, x => (x.f.results || []).filter(r => r.ok).map(change).join('') + '<div style="font-size:13px;margin-top:3px">' + LIVE(x.f.live) + '</div>')
      + '<p style="font-size:13px;color:#555">Not happy with one? Open the suite → Technical SEO → New Scan and click <em>Undo</em> next to it. It goes back to what it was.</p>' : ''}
    ${b.waiting.length ? SECTION('Waiting for your OK', b.waiting.length, '#b45309') + list(b.waiting, x => reason({ e: x.e }, '#555')) : ''}
    ${b.failed.length ? SECTION('Could not be made', b.failed.length, '#b91c1c') + list(b.failed, x => reason(x, '#b91c1c')) : ''}
    ${b.unsure.length ? SECTION('The checker was not sure', b.unsure.length, '#b45309') + list(b.unsure, x => reason({ e: x.e }, '#b45309')) : ''}
    ${b.manual.length ? SECTION('For a developer or a Grok Bot', b.manual.length) + list(b.manual, x => reason(x, '#555')) : ''}
    ${b.removed.length ? `<p style="font-size:13px;color:#777;margin-top:20px">${plural(b.removed.length, 'suggestion was', 'suggestions were')} dropped by the checker because the page is already fine.</p>` : ''}
    ${state?.repeats_skipped ? '<p style="font-size:13px;color:#777">' + plural(state.repeats_skipped, 'issue was', 'issues were') + ' skipped because the fix was already done in an earlier month.</p>' : ''}
    <p style="margin-top:18px">${BTN(siteUrl, 'Open the suite')}</p>`);
  return { subject, html };
}

export function aeoBuckets(state, fixes = new Map()) {
  const b = { done: [], waiting: [], failed: [], manual: [], unsure: [], removed: [], undone: [] };
  for (const r of state?.rows || []) {
    for (const o of r.optimizations || []) {
      const f = fixes.get(fixKey(r.url, aeoOptKey(o))) || null;
      const v = o.check?.verdict;
      const x = { url: r.url, o, f };
      if (v === 'false_alarm') b.removed.push(x);
      else if (v !== 'confirmed') b.unsure.push(x);
      else if (f?.status === 'applied') b.done.push(x);
      else if (f?.status === 'removed') b.undone.push(x);
      else if (f?.status === 'failed') b.failed.push(x);
      else if (f?.status === 'manual' || !canAutoAdd(o)) b.manual.push(x);
      else b.waiting.push(x);
    }
  }
  return b;
}

// opts: { fixes: Map key → status, fixSheetUrl }
export function buildAeoSummaryEmail(client, state, siteUrl, { fixes = new Map(), fixSheetUrl = '' } = {}) {
  const b = aeoBuckets(state, fixes);
  const failedRun = state?.status === 'failed';
  const subject = runSubject(client, 'AEO', b, failedRun, 'nothing to add this month');
  const pending = b.done.filter(x => x.f.live?.status !== 'verified');

  const todo = [
    b.done.length ? `<strong>Read the ${plural(b.done.length, 'new section')} on the live ${b.done.length === 1 ? 'page' : 'pages'}.</strong> This is new wording visitors can see.` : '',
    b.waiting.length ? `<strong>Approve ${plural(b.waiting.length, 'addition')}.</strong> Open the suite → AEO Engine → Run Optimizations → <em>Add all</em>. You can preview each one in the page first.` : '',
    b.failed.length ? `<strong>${plural(b.failed.length, 'addition')} could not be made.</strong> The reason is next to each one below.` : '',
    b.unsure.length ? `<strong>Look at ${plural(b.unsure.length, 'suggestion')}</strong> the checker was not sure about. Nothing was changed for these.` : '',
    b.manual.length ? `<strong>Pass ${plural(b.manual.length, 'addition')} to a developer or a Grok Bot.</strong> The suite can't add ${b.manual.length === 1 ? 'this one' : 'these'} itself (usually a page built in a page builder).` + (fixSheetUrl ? ` <a href="${esc(fixSheetUrl)}">Open the fix sheet</a>.` : '') : '',
    pending.length ? `${plural(pending.length, 'addition is', 'additions are')} saved but not showing yet. Clear the site's cache, or look again tomorrow.` : ''
  ].filter(Boolean);

  const item = (x, body) => `<li style="margin-bottom:12px"><strong>${esc(x.o.name || x.o.type)}</strong>${PAGE(x.url)}${body}</li>`;
  const reason = (x, color) => `<div style="font-size:13px;color:${color};margin-top:3px">${esc(x.f?.reason || x.f?.error || x.o.check?.reason || '')}</div>`;
  const list = (xs, body) => '<ul style="font-size:14px;padding-left:18px">' + xs.map(x => item(x, body(x))).join('') + '</ul>';

  const html = WRAP(`
    <p style="font-size:15px"><strong>${esc(client.name)}</strong> — this month's AEO work${state?.rows?.length ? ' (' + state.rows.length + ' pages)' : ''}${failedRun ? ' <strong style="color:#b91c1c">stopped with an error</strong>' : ''}.</p>
    <p style="font-size:13px;color:#555">AEO adds short, direct answers to a page so AI tools like ChatGPT and Google's AI answers can quote it.</p>
    ${state?.error ? '<p style="color:#b91c1c">' + esc(state.error) + '</p>' : ''}
    ${state?.auto?.status === 'failed' || state?.auto?.status === 'skipped' ? '<p style="color:#b91c1c">' + esc(state.auto.reason || '') + '</p>' : ''}
    ${todoBox(todo)}
    ${b.done.length ? SECTION('Added to the site', b.done.length, '#15803d')
      + list(b.done, x => `<div style="font-size:13px;margin-top:3px">Added at the ${x.f.plan?.position === 'top' ? 'top' : 'end'} of the page. ${LIVE(x.f.live)}</div>`)
      + '<p style="font-size:13px;color:#555">Not happy with one? Open the suite → AEO Engine → Run Optimizations and click <em>Undo</em> next to it. The page goes back to exactly what it was.</p>' : ''}
    ${b.waiting.length ? SECTION('Waiting for your OK', b.waiting.length, '#b45309') + list(b.waiting, x => (x.f?.preview_url ? `<div style="font-size:13px;margin-top:3px"><a href="${esc(x.f.preview_url)}">See it in the page</a></div>` : '') + reason({ o: x.o }, '#555')) : ''}
    ${b.failed.length ? SECTION('Could not be added', b.failed.length, '#b91c1c') + list(b.failed, x => reason(x, '#b91c1c')) : ''}
    ${b.unsure.length ? SECTION('The checker was not sure', b.unsure.length, '#b45309') + list(b.unsure, x => reason({ o: x.o }, '#b45309')) : ''}
    ${b.manual.length ? SECTION('For a developer or a Grok Bot', b.manual.length) + list(b.manual, x => reason(x, '#555')) : ''}
    ${b.removed.length ? `<p style="font-size:13px;color:#777;margin-top:20px">${plural(b.removed.length, 'suggestion was', 'suggestions were')} dropped by the checker because the page already says it.</p>` : ''}
    ${state?.repeats_skipped ? '<p style="font-size:13px;color:#777">' + plural(state.repeats_skipped, 'suggestion was', 'suggestions were') + ' skipped because they repeat work already delivered.</p>' : ''}
    <p style="margin-top:18px">${BTN(siteUrl, 'Open the suite')}</p>`);
  return { subject, html };
}

// "Report ready to review" for the account manager. The client is never
// emailed by the suite — this goes to the report address only.
export function buildReportReadyEmail(client, state, siteUrl, viewUrl) {
  const month = state?.month || '';
  const check = state?.check;
  const issues = check?.issues || [];
  const done = state?.status === 'done';
  const subject = (!done ? 'Report NOT built: ' : check?.verdict === 'accurate' ? 'Report ready to review: ' : 'Report ready — check the flagged figures: ')
    + (client?.name || '') + ' (' + month + ')';
  const html = WRAP(done ? `
    <p>The <strong>${esc(client?.name)}</strong> SEO report for <strong>${esc(month)}</strong> is ready for you to review and send.</p>
    <p>QA score (email tone and format): <strong>${esc(state.qa_score ?? '—')}/10</strong><br/>
    Accuracy check (every figure against the Google data): <strong style="color:${check?.verdict === 'accurate' ? '#15803d' : '#b91c1c'}">${check?.verdict === 'accurate' ? 'all figures match' : 'issues found'}</strong></p>
    ${issues.length ? '<ul>' + issues.map(i => `<li style="color:${i.severity === 'error' ? '#b91c1c' : '#b45309'}">${esc(i.issue)}</li>`).join('') + '</ul>' : ''}
    ${viewUrl ? `<p>${BTN(viewUrl, 'Open the report')}</p>` : ''}
    <p style="color:#555"><strong>Draft email to the client</strong> — Subject: ${esc(state.email_subject)}</p>
    <div style="border:1px solid #ddd;border-radius:8px;padding:14px;background:#fafafa;white-space:pre-wrap;font-size:14px">${esc(state.email_body)}</div>
    <p style="margin-top:18px">${BTN(siteUrl, 'Open the suite to edit and send')}</p>
    <p style="color:#777;font-size:12px">Nothing has been sent to the client. Review, edit if needed, then send it from Reports → Monthly Report.</p>`
    : `<p>The <strong>${esc(client?.name)}</strong> report for ${esc(month)} could not be built.</p>
    <p style="color:#b91c1c">${esc(state?.error || 'Unknown error')}</p>
    <p>${BTN(siteUrl, 'Open the suite')}</p>`);
  return { subject, html };
}

// Digest from one publisher pass. results: [{ client, title, liveUrl, error }]
export function buildPublishedEmail(results, siteUrl) {
  const ok = results.filter(r => !r.error);
  const bad = results.filter(r => r.error);
  const flagged = ok.filter(r => r.check && !r.check.ok);
  const subject = (bad.length ? 'Publish FAILED for ' + bad.length + (ok.length ? ', ' + ok.length + ' went live' : '') : ok.length + ' post' + (ok.length > 1 ? 's' : '') + ' went live')
    + (flagged.length ? ' (' + flagged.length + ' to look at)' : '')
    + ': ' + [...new Set(results.map(r => r.client))].join(', ');
  const looked = r => !r.check ? ''
    : r.check.ok ? '<br/><span style="font-size:13px;color:#15803d">Checked: the live page looks right.</span>'
    : '<ul style="margin:4px 0 0 16px;padding:0;font-size:13px;color:#b45309">' + r.check.problems.slice(0, 5).map(p => '<li>' + esc(p) + '</li>').join('') + '</ul>';
  const item = r => r.error
    ? `<li style="margin-bottom:8px"><strong>${esc(r.client)}</strong> — ${esc(r.title)}<br/><span style="color:#b91c1c">${esc(r.error)}</span></li>`
    : `<li style="margin-bottom:8px"><strong>${esc(r.client)}</strong> — ${r.liveUrl ? '<a href="' + esc(r.liveUrl) + '">' + esc(r.title) + '</a>' : esc(r.title)}${r.auto ? ' <span style="font-size:12px;color:#777">(published automatically)</span>' : ''}${looked(r)}</li>`;
  const todo = [
    flagged.length ? `<strong>Look at ${plural(flagged.length, 'live page')}.</strong> The check after publishing found something. ${flagged.length === 1 ? 'It is' : 'They are'} still live — fix or unpublish in the site's admin.` : '',
    bad.length ? `<strong>${plural(bad.length, 'post')} could not be published.</strong> ${bad.length === 1 ? 'It is' : 'They are'} still a draft. Fix the cause below, then click Approve again in CMS → Push History.` : ''
  ].filter(Boolean);
  const html = WRAP(`
    ${todoBox(todo)}
    ${ok.length ? '<p><strong>Now live:</strong></p><ul style="padding-left:18px">' + ok.map(item).join('') + '</ul>' : ''}
    ${bad.length ? '<p style="color:#b91c1c"><strong>Could not publish</strong> (still drafts, marked "publish failed" in Push History):</p><ul style="padding-left:18px">' + bad.map(item).join('') + '</ul>' : ''}
    <p style="margin-top:18px">${BTN(siteUrl, 'Open the suite')}</p>`);
  return { subject, html };
}
