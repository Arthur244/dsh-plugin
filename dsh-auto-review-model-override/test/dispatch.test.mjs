import assert from 'node:assert/strict'
import test from 'node:test'
import { omitWireEffort, reviewDispatch } from '../review-dispatch.js'

test('wire cleanup copies frozen payload, preserving summary and unrelated fields', () => {
  const payload = Object.freeze({ reasoning_effort: 'high', reasoning: Object.freeze({ effort: 'none', summary: 'auto' }), temperature: 0 })
  assert.deepEqual(omitWireEffort(payload), { reasoning: { summary: 'auto' }, temperature: 0 })
  assert.equal(payload.reasoning.effort, 'none')
  assert.deepEqual(omitWireEffort({ reasoning: { effort: 'none' } }), {})
})

test('unrecognized pi-ai shape fails before dispatch, never falls through', () => {
  class PiAiAdapter {}
  assert.throws(() => reviewDispatch({ registration: () => ({ adapter: new PiAiAdapter() }) }, { provider: 'p' },
    () => assert.fail('must not send an unfiltered review')), { code: 'REVIEW_EFFORT_FILTER_UNSUPPORTED' })
  assert.throws(() => reviewDispatch({}, {}, () => assert.fail('must fail closed')), { code: 'REVIEW_EFFORT_FILTER_UNSUPPORTED' })
})

test('non pi-ai adapters keep their standard dispatch', () => {
  assert.equal(reviewDispatch({ registration: () => ({ adapter: {} }) }, { provider: 'p' }, () => 'next'), 'next')
})

test('request-local facade composes existing payload hooks and binds SDK private fields', async () => {
  let received
  const originalProfile = Object.freeze({ reasoning: 'high', other: 7 })
  class Models {
    #secret = 42
    getModel() { return this.#secret }
    streamSimple(model, context, options) {
      assert.equal(this.#secret, 42)
      received = options
      return options.onPayload(Object.freeze({ reasoning: Object.freeze({ effort: 'none' }), model: 'm' }), model)
    }
  }
  const snapshot = { profiles: new Map([['p', originalProfile]]), models: new Models() }
  class PiAiAdapter {
    current() { return snapshot }
    streamWithSnapshot() {}
  }
  const adapter = new PiAiAdapter()
  const registration = Object.freeze({ adapter, extra: true })
  const runtime = {
    registration: () => registration,
    adapterStream(options) {
      const fork = this.registration(options.provider)
      assert.equal(fork.extra, true)
      assert.notEqual(fork.adapter, adapter)
      const view = fork.adapter.current()
      assert.equal(view.models.getModel(), 42)
      assert.deepEqual(view.profiles.get('p'), { other: 7 })
      return view.models.streamSimple({}, {}, { reasoning: 'high', onPayload: async payload => ({ ...payload,
        reasoning_effort: 'high', reasoning: { ...payload.reasoning, summary: 'auto' }, temperature: 0 }) })
    },
  }
  assert.deepEqual(await reviewDispatch(runtime, { provider: 'p' }, () => assert.fail('no fallthrough')),
    { reasoning: { summary: 'auto' }, model: 'm', temperature: 0 })
  assert.equal(Object.hasOwn(received, 'reasoning'), false)
  assert.equal(runtime.registration(), registration)
  assert.equal(adapter.current(), snapshot)
  assert.equal(snapshot.profiles.get('p'), originalProfile)
  assert.equal(originalProfile.reasoning, 'high')
  assert.equal(snapshot.models.getModel(), 42)
})
