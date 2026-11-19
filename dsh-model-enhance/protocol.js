// Explicit consumer-selected Typert metadata for this plain-JavaScript plugin.
import { validateRequest } from './core/service.js'

const METHODS = ['status', 'scan', 'preview', 'apply']
const jsonCodec = {
  mode: 'strict', typeSymbol: 'dsh-model-enhance#JsonResult',
  create: () => ({ parse: value => {
    // Remote carrier uses JSON values; strip absent optional members, never run external data.
    if (value === undefined) throw new Error('Expected model-enhance JSON response')
    return JSON.parse(JSON.stringify(value))
  } }),
}
export function createDescriptors() {
  return METHODS.map(method => ({
    id: `dsh-model-enhance:modelEnhance/${method}`,
    service: 'modelEnhance', namespace: 'modelEnhance', method,
    invocation: { kind: 'direct' },
    parameters: method === 'status' ? [] : [{
      name: 'request', wire: 'request', source: 'json',
      codec: { mode: 'strict', typeSymbol: `dsh-model-enhance#${method}Request`,
        create: () => ({ parse: value => validateRequest(method, value) }) },
    }],
    result: jsonCodec,
  }))
}
export function hostContribution() {
  return { package: 'dsh-model-enhance', face: 'host', schemas: [],
    model: { services: [], events: [], objects: [] }, invocations: createDescriptors() }
}
