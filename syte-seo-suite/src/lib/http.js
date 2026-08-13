// Small fetch wrapper that aborts a request after `timeoutMs`.
//
// Every external call in the report pipeline (AI-engine probes, Claude
// generation, GA4, GSC) used a bare fetch with no timeout. A single
// endpoint that accepts the connection but never responds would leave the
// promise pending forever — which surfaces in the UI as the Generate button
// stuck on "Working…" with no error: a frozen report. AbortController turns
// that stall into a normal rejection so callers' existing try/catch can
// surface it instead of hanging.
export async function fetchWithTimeout(url, options = {}, timeoutMs = 60000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (e) {
    if (e.name === 'AbortError') {
      const secs = Math.round(timeoutMs / 1000);
      throw new Error('Request timed out after ' + secs + 's (' + String(url).split('?')[0] + ')');
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}
