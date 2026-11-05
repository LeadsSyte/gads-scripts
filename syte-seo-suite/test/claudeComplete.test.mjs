// claudeComplete streams through the anthropic-proxy so Netlify never sees a
// silent response (the "504 Inactivity Timeout" that killed Cuddledown's AEO
// report on the microsite JSON step). Pins: text is assembled from SSE,
// stream:true is sent, a 504 HTML page becomes a readable error and is
// retried once, and a non-retryable error is not.
globalThis.__SYTE_PROXY_AUTH = 'test';
const { claudeComplete, describeError } = await import('../src/lib/anthropic.js');

let pass = 0, fail = 0;
async function t(name, fn) {
  try { await fn(); console.log('PASS', name); pass++; }
  catch (e) { console.error('FAIL', name, '->', e.message); fail++; }
}
function ok(c, m) { if (!c) throw new Error(m || 'assertion failed'); }

function sse(chunks) {
  const enc = new TextEncoder();
  const body = new ReadableStream({
    start(c) {
      for (const text of chunks) c.enqueue(enc.encode('event: content_block_delta\ndata: ' + JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text } }) + '\n\n'));
      c.enqueue(enc.encode('data: {"type":"message_stop"}\n\n'));
      c.close();
    }
  });
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}
const HTML_504 = '<HTML><HEAD><TITLE>Inactivity Timeout</TITLE></HEAD><BODY><H1>Inactivity Timeout</H1><B>Description: Too much time has passed without sending any data for document.</B></BODY></HTML>';

let calls = [];
function mock(responses) {
  calls = [];
  globalThis.fetch = async (url, init) => { calls.push({ url, body: JSON.parse(init.body) }); return responses.shift()(); };
}
const args = { system: 's', messages: [{ role: 'user', content: 'hi' }], max_tokens: 100 };

await t('assembles streamed text and asks the proxy to stream', async () => {
  mock([() => sse(['{"a":', ' 1}'])]);
  const out = await claudeComplete(args);
  ok(out === '{"a": 1}', 'got ' + out);
  ok(calls[0].url === '/.netlify/functions/anthropic-proxy');
  ok(calls[0].body.stream === true);
});

await t('504 Inactivity Timeout is retried once, then succeeds', async () => {
  mock([() => new Response(HTML_504, { status: 504 }), () => sse(['done'])]);
  const out = await claudeComplete(args);
  ok(out === 'done' && calls.length === 2);
});

await t('repeated 504 gives a readable error, not raw HTML', async () => {
  mock([() => new Response(HTML_504, { status: 504 }), () => new Response(HTML_504, { status: 504 })]);
  let msg = '';
  try { await claudeComplete(args); } catch (e) { msg = e.message; }
  ok(/^Claude API error: 504 /.test(msg), msg);
  ok(!/<HTML|<TITLE/i.test(msg), msg);
});

await t('400 is not retried and shows Anthropic\'s message', async () => {
  mock([() => new Response(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'bad thing' } }), { status: 400 })]);
  let msg = '';
  try { await claudeComplete(args); } catch (e) { msg = e.message; }
  ok(calls.length === 1, 'calls ' + calls.length);
  ok(msg === 'Claude API error: 400 bad thing', msg);
});

await t('describeError strips tags from unknown HTML', async () => {
  ok(describeError(502, '<html><body><h1>Bad gateway</h1></body></html>') === '502 Bad gateway');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
