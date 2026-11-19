// Run with the installed Electron binary in ELECTRON_RUN_AS_NODE mode,
// passing the installed dsh runtime directory. No profile or network access.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

if (!process.argv[2]) throw new Error('Pass the installed dsh runtime directory as the first argument')
const runtime = resolve(process.argv[2])
const { evaluatePluginCompatibility, getDshRuntimeVersion } = await import(pathToFileURL(
  join(runtime, 'node_modules', '@deepseek-ai/dsh-app-boot', 'lib', 'index.js'),
).href)
const version = getDshRuntimeVersion()
const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
assert.equal(evaluatePluginCompatibility(manifest), undefined, `plugin must admit installed DSH ${version}`)
for (const supported of ['0.2.2-rc.3', '0.2.2-rc.5']) {
  assert.equal(evaluatePluginCompatibility(manifest, {}, supported), undefined)
}
const oldIssue = evaluatePluginCompatibility({ ...manifest, engines: { dsh: '0.2.2-rc.3' } }, {}, '0.2.2-rc.5')
assert.deepEqual(oldIssue.requirements, { 'engines.dsh': '0.2.2-rc.3' })
assert.equal(oldIssue.exempted, false)
for (const unverified of ['0.2.2-rc.4', '0.2.2-rc.6', '0.2.2', '0.3.0']) {
  const issue = evaluatePluginCompatibility(manifest, {}, unverified)
  assert.ok(issue, `unverified DSH ${unverified} must remain blocked`)
  assert.equal(issue.exempted, false)
}
console.log(`PASS: installed DSH ${version} loader admits this plugin without exemptions; old rc.3 rejection reproduced and unverified versions blocked. No profile, network or UI interaction.`)
