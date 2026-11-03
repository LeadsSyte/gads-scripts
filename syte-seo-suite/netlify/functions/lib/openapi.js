// OpenAPI 3.1 document for /api/v1, generated from the route table so the
// spec can never drift from the router (test/apiRouter.test.mjs checks that
// every route is described). Served at GET /api/v1/openapi.json.

export function buildOpenApi(routes, serverUrl) {
  const paths = {};
  for (const r of routes) {
    const oaPath = r.path.replace(/:([a-zA-Z_]+)/g, '{$1}');
    const params = [...r.path.matchAll(/:([a-zA-Z_]+)/g)].map(m => ({ name: m[1], in: 'path', required: true, schema: { type: 'string' } }));
    for (const q of r.doc.query || []) params.push({ name: q, in: 'query', required: false, schema: { type: 'string' } });
    if (r.method !== 'GET') params.push({ name: 'Idempotency-Key', in: 'header', required: false, schema: { type: 'string' }, description: 'Replays within 24 h return the original response.' });
    const scope = typeof r.scope === 'function' ? 'fix:plan (plan) or fix:apply (apply, undo)' : r.scope;
    const op = {
      summary: r.doc.summary,
      description: 'Scope: ' + scope + (r.doc.staff ? '. Staff sign-in or the suite header only; API keys are refused.' : '') + '. Rate-limit class: ' + r.cls + '.',
      operationId: (r.method + '_' + r.path.replace(/[^a-zA-Z0-9]+/g, '_')).replace(/_+$/, '').toLowerCase(),
      tags: [r.path.split('/')[1]],
      parameters: params,
      responses: {
        [r.doc.returns?.startsWith('202') ? '202' : r.method === 'POST' && /create|log work|create a client/i.test(r.doc.summary || '') ? '201' : '200']: { description: r.doc.returns || 'OK', content: { 'application/json': { schema: r.doc.returns?.startsWith('202') ? JOB_ACCEPTED : { type: 'object' } } } },
        '400': { description: 'Invalid request' }, '401': { description: 'Missing or invalid credentials' }, '403': { description: 'Missing scope' }, '404': { description: 'Not found' }, '409': { description: 'Conflict (state, or Idempotency-Key reused with a different body)' }, '429': { description: 'Rate limit reached; see Retry-After' }
      }
    };
    if (r.doc.body) op.requestBody = { required: r.method !== 'PATCH' && !!r.doc.body.required?.length, content: { 'application/json': { schema: r.doc.body } } };
    (paths[oaPath] ||= {})[r.method.toLowerCase()] = op;
  }
  return {
    openapi: '3.1.0',
    info: {
      title: 'Syte SEO Suite API', version: '1.0.0',
      description: 'Every action of the suite for the assistant bot. Authenticate with `Authorization: Bearer sk_syte_…`. Work that runs in the background answers 202 with a jobId; poll GET /jobs/{id} until status is done, failed or error. Statuses: queued → running | planning | applying | undoing → done | failed | error.'
    },
    servers: [{ url: serverUrl }],
    security: [{ apiKey: [] }],
    components: {
      securitySchemes: { apiKey: { type: 'http', scheme: 'bearer', description: 'A service API key (sk_syte_…) or a staff sign-in token.' } },
      schemas: { Job: JOB, JobAccepted: JOB_ACCEPTED }
    },
    paths
  };
}

const JOB = {
  type: 'object',
  properties: {
    id: { type: 'string' }, type: { type: 'string', enum: ['aeo_scan', 'tech_scan', 'aeo_fix', 'tech_fix', 'autopilot', 'aeo_report', 'report'] }, client_id: { type: 'string' },
    status: { type: 'string', enum: ['queued', 'running', 'planning', 'applying', 'undoing', 'done', 'error', 'failed'] },
    params: { type: 'object' }, progress: { type: ['object', 'null'] }, result: { type: ['object', 'null'] }, error: { type: ['string', 'null'] },
    created_at: { type: 'string' }, started_at: { type: ['string', 'null'] }, finished_at: { type: ['string', 'null'] }
  }
};
const JOB_ACCEPTED = { type: 'object', properties: { jobId: { type: 'string' }, job: JOB, existing: { type: 'boolean', description: 'true when an identical request was already in flight and this is that job' } } };
