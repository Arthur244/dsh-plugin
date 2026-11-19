import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { BundledCatalog } from './core/bundled-catalog.js'
import { ModelEnhanceController } from './core/service.js'
import { hostContribution } from './protocol.js'

export const name = 'dsh-model-enhance'
export const inject = ['llm', 'settings', 'typert']

export function apply(ctx) {
  const catalogSource = new BundledCatalog()
  const controller = new ModelEnhanceController({ llm: ctx.llm, settings: ctx.settings, catalogSource })
  const ready = catalogSource.load()
  ctx.effect(() => () => controller.dispose())
  class ModelEnhanceService extends TypertRemoteService {
    constructor() { super(ctx, 'modelEnhance') }
    async status() { await ready; return controller.status() }
    async scan(request) { await ready; return controller.scan(request) }
    async preview(request) { await ready; return controller.preview(request) }
    async apply(request) { await ready; return controller.apply(request) }
  }
  new ModelEnhanceService()
  ctx.typert.register(hostContribution())
}
