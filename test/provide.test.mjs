import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../lib/index.js'

test('provides bkmsPluginCenter: catalog, status and retry for the app center; installs stay inside plugin-center', async () => {
  const provided = {}
  const home = mkdtempSync(join(tmpdir(), 'pc-'))
  const ctx = { get: name => name === 'profileContext' ? { home, dir: home } : undefined, provide: (name, value) => { provided[name] = value }, inject: () => {} }
  apply(ctx, {})
  const service = provided.bkmsPluginCenter
  assert.equal(service.version, 1)
  assert.equal(typeof service.catalog, 'function')
  // Without the host plugin manager there is nothing to install with; status says so instead of throwing.
  assert.equal(service.status().available, false)
  assert.equal(service.install, undefined)
  assert.throws(() => service.retry('@bkms/app-contract'), /插件管理服务/)
})
