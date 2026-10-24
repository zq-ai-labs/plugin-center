import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../lib/index.js'

test('provides bkmsPluginCenter: catalog, install and status for the app center', async () => {
  const provided = {}
  const home = mkdtempSync(join(tmpdir(), 'pc-'))
  const ctx = { get: name => name === 'profileContext' ? { home, dir: home } : undefined, provide: (name, value) => { provided[name] = value }, inject: () => {} }
  apply(ctx, {})
  const service = provided.bkmsPluginCenter
  assert.equal(service.version, 1)
  assert.equal(typeof service.catalog, 'function')
  // Without the host plugin manager there is nothing to install with; status says so instead of throwing.
  assert.equal(service.status().available, false)
  assert.throws(() => service.install('https://example.com/p/x'), /插件管理服务/)
})
