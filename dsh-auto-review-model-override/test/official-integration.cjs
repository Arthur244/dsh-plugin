// Isolated integration probe. Uses installed DSH modules, no network or real approvals.
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
if (!process.env.DSH_INSTALL_DIR) throw new Error('DSH_INSTALL_DIR must identify the installed DSH package');
const workspace = path.resolve(__dirname, '../..');
const r = createRequire(process.env.DSH_INSTALL_DIR + '/package.json');
const { Context } = r('@deepseek-ai/cordis');
const Sessions = r('@deepseek-ai/dsh-session');
const Projections = r('@deepseek-ai/dsh-session-projection');
const Agents = r('@deepseek-ai/dsh-agent');
const Prompt = r('@deepseek-ai/dsh-system-prompt');
const Approval = r('@deepseek-ai/dsh-user-approval');
const Permissions = r('@deepseek-ai/dsh-permission-presets');
const Sandbox = r('@deepseek-ai/dsh-sandbox-policy');
const Auto = r('@deepseek-ai/dsh-experimental-auto-review');
const Delegation = r('@deepseek-ai/dsh-subagent');
const { createMessage, ToolCallId } = r('@deepseek-ai/dsh-llm');
const Override = require(path.resolve(__dirname, '../index.js'));
const Hold = require(path.resolve(__dirname, '../../dsh-autorevivw-hold/index.js'));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const ref = value => ({ get: () => value });
const config = changes => Object.fromEntries(Object.entries({
  reviewProvider: 'review', reviewModel: 'r', retryAttempts: 1,
  timeoutMs: 25, fallbackTimeoutMs: 25, totalTimeoutMs: 250, fallbackProvider: '', fallbackModel: '', onFailure: 'ask', ...changes,
}).map(([key, value]) => [key, ref(value)]));
function* textChunks(text) {
  yield { type: 'block-start', index: 0, blockType: 'text' };
  yield { type: 'text-delta', index: 0, text };
  yield { type: 'block-end', index: 0, block: { type: 'text', text } };
  yield { type: 'finish', reason: { kind: 'stop' } };
}
const deny = () => textChunks('{"risk":"medium","decision":"deny","reason":"fixture refuses"}');
const allow = () => textChunks('{"risk":"low","decision":"allow"}');
const failure = () => [{ type: 'finish', reason: { kind: 'error', failure: { code: 'TRANSPORT', message: 'fixture offline' } } }];
async function fixture(options = {}) {
  const ctx = new Context();
  const routes = [];
  let answerers = 0;
  let answerRelease;
  const answerGate = new Promise(resolve => { answerRelease = resolve; });
  ctx.provide('workingDirectory', { ensure: async () => workspace });
  ctx.provide('shell', { sandboxMode: 'workspace-write' });
  ctx.provide('tools', {});
  ctx.provide('llm', { registration: () => ({ adapter: {} }), stream: o => ctx.waterfall('llm/stream', o, () => {
    routes.push(o.provider + '/' + o.model);
    return options.respond ? options.respond(o, routes.length) : deny();
  }) });
  try {
    for (const [mod, cfg] of [
      [Sessions.default], [Projections.default], [Agents.default], [Prompt.default, {}],
      [Sandbox.default, { mode: 'workspace-write', workspaceRoot: workspace }],
      [Approval.default, { policy: 'ask' }],
      [Permissions.default, { presets: {
        'workspace-write': { sandbox: 'workspace-write', approval: 'ask' },
        'danger-full-access': { sandbox: 'danger-full-access', approval: 'never' },
      }, defaultPreset: 'workspace-write' }], [Auto],
    ]) await ctx.plugin(mod, cfg);
    Override.apply(ctx, config(options.config));
    const parent = ctx.sessions.create(Sessions.SessionId('probe-parent'), { meta: { cwd: workspace } });
    ctx.permissionPresets.set(parent, 'auto');
    const captured = Delegation.captureDelegatedPolicyOverrides({ session: parent, ctx });
    assert.equal(captured.approvalPolicy, 'never');
    assert.equal(captured.sandboxMode, 'danger-full-access');
    if (options.hold) Hold.apply(ctx, { defaultAutoReview: ref(true) });
    const session = ctx.sessions.create(Sessions.SessionId('probe-child'), {
      meta: { cwd: workspace, ...(options.root ? {} : { origin: 'subagent', parentSession: parent.id }) },
    });
    if (!options.root) Delegation.appendDelegatedPolicyOverrides(session, captured);
    await Promise.resolve(); // same yield boundary as child setup's workingDirectory await
    const agent = { id: session.id, session, ctx, options: { provider: 'session', model: 's' } };
    await ctx.serial('agent/created', { agent, source: 'startup', signal: new AbortController().signal });
    if (options.policy) Approval.setApprovalPolicy(session, options.policy);
    assert.equal(ctx.permissionPresets.current(session), 'auto', 'Auto gate must actually be active');
    const schema = { name: 'probe', description: 'inert test tool', parameters: { type: 'object', properties: {} } };
    const callId = ToolCallId('probe-call');
    session.append('request/header', { header: { config: { provider: 'session', model: 's' }, tools: [schema] }, reason: 'initial' });
    session.append('turn/start', { turn: 1 });
    session.append('step/start', { turn: 1, step: 1 });
    session.append('assistant/message', { turn: 1, step: 1, stream: [], message: createMessage({
      role: 'assistant', source: { kind: 'model', provider: 'session', model: 's' },
      content: [{ type: 'tool-call', id: callId, name: 'probe', arguments: '{}' }],
    }) }, { surfaceOp: 'append' });
    session.append('tool/call', { turn: 1, step: 1, callId, name: 'probe', arguments: '{}' });
    ctx.on('approval/request', () => { answerers++; return answerGate; });
    const controller = new AbortController();
    const exec = { name: 'probe', callId, rootCallId: callId, arguments: {}, agent, signal: controller.signal };
    let bodies = 0;
    const run = async () => {
      const decision = await ctx.waterfall('tools/pre-execute', exec, async () => ({ kind: 'allow' }));
      if (decision.kind === 'ask') {
        const outcome = await ctx.approval.request({ agent, toolName: 'probe', callId, reason: decision.reason, signal: controller.signal });
        if (outcome === 'allowed-once') bodies++;
        return { decision: decision.kind, outcome };
      }
      if (decision.kind === 'allow') bodies++;
      return { decision: decision.kind, code: decision.info?.code };
    };
    return { ctx, session, agent, run, controller, routes, answerRelease,
      answerers: () => answerers, bodies: () => bodies,
      policy: () => ctx.approval.overrideOf(session),
      audit: () => session.snapshotEvents().filter(e => e.type.startsWith('approval/')).map(e => ({ type: e.type, ...e.data })),
      close: async () => { controller.abort(); answerRelease('rejected'); await ctx.fiber.dispose(); },
    };
  } catch (error) { answerRelease('rejected'); await ctx.fiber.dispose(); throw error; }
}
async function test(name, options, expected) {
  const f = await fixture(options);
  try {
    const start = performance.now();
    const result = await f.run();
    assert.equal(result.decision, expected);
    assert.ok(f.routes.length > 0, 'must reach actual review stream');
    assert.equal(f.answerers(), 0, 'never child must not call manual answerer');
    assert.equal(f.bodies(), expected === 'allow' ? 1 : 0);
    assert.equal(f.policy(), 'never');
    console.log(JSON.stringify({ name, result, policy: f.policy(), answerers: f.answerers(), bodies: f.bodies(), routes: f.routes, elapsedMs: Math.round(performance.now() - start) }));
  } finally { await f.close(); }
}
(async () => {
  await test('child-valid-denial', {}, 'deny');
  await test('child-all-routes-fail-onFailure-ask', { respond: failure }, 'deny');
  await test('child-all-routes-fail-onFailure-deny', { respond: failure, config: { onFailure: 'deny' } }, 'deny');
  await test('child-invalid-json', { respond: () => textChunks('not JSON') }, 'deny');
  await test('child-primary-fails-session-denies', { respond: o => o.provider === 'review' ? failure() : deny() }, 'deny');
  await test('child-primary-fails-session-allows', { respond: o => o.provider === 'review' ? failure() : allow() }, 'allow');
  await test('child-explicit-fallback-denies', { config: { fallbackProvider: 'backup', fallbackModel: 'b' }, respond: o => o.provider === 'review' ? failure() : deny() }, 'deny');
  await test('child-cooperative-timeouts', { respond: o => (async function* () {
    await new Promise(resolve => o.signal.addEventListener('abort', resolve, { once: true }));
    yield { type: 'finish', reason: { kind: 'aborted', failure: { code: 'ABORTED', message: 'fixture cancelled' } } };
  })() }, 'deny');
  await test('child-fail-open-is-allow-not-manual', { respond: failure, config: { onFailure: 'allow' } }, 'allow');
  {
    const f = await fixture();
    try {
      const outcome = await f.ctx.approval.request({ agent: f.agent, toolName: 'probe', signal: f.controller.signal });
      assert.equal(outcome, 'rejected'); assert.equal(f.answerers(), 0);
      console.log(JSON.stringify({ name: 'direct-approval-service-never', outcome, answerers: f.answerers(), audit: f.audit() }));
    } finally { await f.close(); }
  }
  await test('fixed-hold-child-valid-denial', { hold: true }, 'deny');
  await test('fixed-hold-child-fallback-ask-is-final-denial', { hold: true, respond: failure }, 'deny');
  await test('fixed-hold-child-invalid-json-is-final-denial', { hold: true, respond: () => textChunks('not JSON') }, 'deny');
  {
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    try {
      await test('fixed-hold-child-uncooperative-review-is-bounded-denial', {
        hold: true,
        respond: () => (async function* () { await gate; yield* deny(); })(),
      }, 'deny');
    } finally { release(); await delay(0); }
  }
  {
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    try {
      await test('fixed-hold-child-hanging-cleanup-is-bounded-denial', {
        hold: true,
        respond: () => ({ [Symbol.asyncIterator]() { return {
          next: async () => ({ done: false, value: failure()[0] }),
          return: async () => { await gate; return { done: true }; },
        }; } }),
      }, 'deny');
    } finally { release(); await delay(0); }
  }
  for (const options of [{ policy: 'ask' }, { hold: true, root: true }]) {
    const f = await fixture({ ...options, respond: failure });
    try {
      assert.equal(f.policy(), 'ask');
      const pending = f.run();
      const state = await Promise.race([pending.then(() => 'settled'), delay(90).then(() => 'pending')]);
      assert.equal(state, 'pending'); assert.equal(f.answerers(), 1); assert.equal(f.bodies(), 0);
      f.controller.abort(); const result = await pending;
      assert.equal(result.outcome, 'cancelled');
      console.log(JSON.stringify({ name: options.hold ? 'positive-control-fresh-root-hold-default-asks' : 'positive-control-ask-policy-waits', stateBeforeAbort: state, policy: f.policy(), answerers: f.answerers(), bodies: f.bodies(), result, audit: f.audit() }));
    } finally { await f.close(); }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
