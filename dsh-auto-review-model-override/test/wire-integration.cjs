// Real installed DSH + pi-ai + OpenAI SDK, loopback only; never reads profile credentials.
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const { createServer } = require('node:http');
const r = createRequire(process.env.DSH_INSTALL_DIR + '/package.json');
const { Context } = r('@deepseek-ai/cordis');
const Llm = r('@deepseek-ai/dsh-llm');
const PiAi = r('@deepseek-ai/dsh-llm-pi-ai');
const Override = require('../index.js');
const { omitWireEffort } = require('../review-dispatch.js');
const json = '{"risk":"low","decision":"allow"}';
const requests = [];
let failModels = new Set();
const server = createServer(async (req, res) => {
  const bytes = [];
  for await (const chunk of req) bytes.push(chunk);
  const body = JSON.parse(Buffer.concat(bytes).toString('utf8'));
  requests.push({ path: req.url, body });
  if (failModels.has(body.model)) {
    res.writeHead(503, { 'content-type': 'application/json' });
    res.end('{"error":{"message":"fixture unavailable","type":"server_error"}}');
    return;
  }
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  if (req.url.endsWith('/responses')) {
    const item = { id: 'msg_fixture', type: 'message', role: 'assistant', content: [] };
    const events = [
      { type: 'response.created', response: { id: 'resp_fixture' } },
      { type: 'response.output_item.added', output_index: 0, item },
      { type: 'response.content_part.added', output_index: 0, content_index: 0, part: { type: 'output_text', text: '', annotations: [] } },
      { type: 'response.output_text.delta', output_index: 0, content_index: 0, delta: json },
      { type: 'response.output_item.done', output_index: 0, item: { ...item, content: [{ type: 'output_text', text: json, annotations: [] }] } },
      { type: 'response.completed', response: { status: 'completed', usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } },
    ];
    res.end(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''));
  } else {
    res.end([
      { choices: [{ delta: { role: 'assistant', content: json }, index: 0, finish_reason: null }] },
      { choices: [{ delta: {}, index: 0, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } },
    ].map(event => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n');
  }
});
const drain = async stream => { const chunks = []; for await (const chunk of stream) chunks.push(chunk); return chunks; };
const noEffort = body => {
  assert.equal(Object.hasOwn(body, 'reasoning_effort'), false);
  assert.equal(Object.hasOwn(body.reasoning ?? {}, 'effort'), false);
};
async function main() {
  const original = Object.freeze({ reasoning_effort: 'high', reasoning: Object.freeze({ effort: 'none', summary: 'auto' }), temperature: 0 });
  assert.deepEqual(omitWireEffort(original), { reasoning: { summary: 'auto' }, temperature: 0 });
  assert.equal(original.reasoning.effort, 'none');
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const baseURL = `http://127.0.0.1:${server.address().port}/v1`;
  process.env.REVIEW_WIRE_FIXTURE_KEY = 'not-a-real-key';
  for (const api of ['openai-responses', 'openai-completions']) {
    const ctx = new Context();
    const values = { reviewProvider: '', reviewModel: '', retryAttempts: 2, timeoutMs: 10000,
      fallbackTimeoutMs: 10000, totalTimeoutMs: 30000, fallbackProvider: '', fallbackModel: '', onFailure: 'deny' };
    try {
      await ctx.plugin(Llm.default);
      await ctx.plugin(PiAi, { providers: { fixture: { api, baseURL, apiKeyEnv: 'REVIEW_WIRE_FIXTURE_KEY', models: ['session', 'primary', 'backup'].map(id => ({ id,
        reasoningEfforts: { off: null, low: 'low', high: 'high' } })) },
        defaults: { api, baseURL, apiKeyEnv: 'REVIEW_WIRE_FIXTURE_KEY', reasoning: 'high',
          models: [{ id: 'defaulted', reasoningEfforts: { off: null, high: 'high' } }] },
      } });
      const options = Object.freeze({ provider: 'fixture', model: 'session', system: 'REVIEW_POLICY\nfixture',
        purpose: 'auto-review', messages: [Llm.createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'inert review fixture' }] })], temperature: 0 });
      // Reproduce the exact SDK default before installing our hook.
      const baseline = await drain(ctx.llm.stream(options));
      assert.equal(baseline.at(-1).reason.kind, 'stop', JSON.stringify(baseline));
      if (api === 'openai-responses') assert.equal(requests.at(-1).body.reasoning.effort, 'none');
      const config = Object.fromEntries(Object.keys(values).map(key => [key, { get: () => values[key] }]));
      Override.apply(ctx, config);
      let chunks = await drain(ctx.llm.stream(options));
      assert.equal(chunks.at(-1).reason.kind, 'stop', JSON.stringify(chunks));
      noEffort(requests.at(-1).body);
      assert.equal(requests.at(-1).body.model, 'session');
      // Parallel ordinary traffic must keep its explicit effort and source defaults.
      await Promise.all([
        drain(ctx.llm.stream(Object.freeze({ ...options, reasoningEffort: 'high' }))),
        drain(ctx.llm.stream({ ...options, system: 'normal request', purpose: undefined, reasoningEffort: 'high' })),
      ]);
      const pair = requests.slice(-2).map(entry => entry.body);
      assert.equal(pair.filter(body => body.reasoning?.effort === 'high' || body.reasoning_effort === 'high').length, 1);
      assert.equal(pair.filter(body => body.reasoning?.effort === undefined && body.reasoning_effort === undefined).length, 1);
      // Configured provider defaults must not be restored on review requests.
      chunks = await drain(ctx.llm.stream({ ...options, provider: 'defaults', model: 'defaulted' }));
      assert.equal(chunks.at(-1).reason.kind, 'stop', JSON.stringify(chunks));
      noEffort(requests.at(-1).body);
      await drain(ctx.llm.stream({ ...options, provider: 'defaults', model: 'defaulted', system: 'normal' }));
      const normal = requests.at(-1).body;
      assert.equal(api === 'openai-responses' ? normal.reasoning.effort : normal.reasoning_effort, 'high');
      // Real HTTP failures exercise primary retries, backup, and session fallback.
      Object.assign(values, { reviewProvider: 'fixture', reviewModel: 'primary', fallbackProvider: 'fixture', fallbackModel: 'backup' });
      failModels = new Set(['primary', 'backup']);
      const start = requests.length;
      chunks = await drain(ctx.llm.stream({ ...options, reasoningEffort: 'high' }));
      assert.equal(chunks.at(-1).reason.kind, 'stop', JSON.stringify(chunks));
      const attempts = requests.slice(start).map(entry => entry.body);
      assert.deepEqual(attempts.map(body => body.model), ['primary', 'primary', 'backup', 'session']);
      attempts.forEach(noEffort);
      failModels.clear();
      console.log(`${api}: reproduced SDK default; empty route, explicit/default effort, concurrent normal traffic, retries and fallbacks passed`);
    } finally { failModels.clear(); await ctx.fiber.dispose(); }
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  server.closeAllConnections(); server.close(); delete process.env.REVIEW_WIRE_FIXTURE_KEY;
});
