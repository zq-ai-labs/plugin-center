import { test } from 'node:test'; import assert from 'node:assert/strict'; import { mkdtempSync, rmSync, readFileSync } from 'node:fs'; import { tmpdir } from 'node:os'; import { join } from 'node:path';
import { createCenter } from '../../../../cloud/dsh-plugin-center/server.mjs'; import { pluginArchive } from '../../../../cloud/dsh-plugin-center/test/archive-fixture.mjs';
import { prepareArtifact, centerAddress, parseDistribution, readCatalog } from '../src/service.mjs';
test('目录读取、发布包完整性校验与本地缓存，准备阶段不执行安装', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'bkms-new-center-')); const server = createCenter({ dataDir: join(dir, 'center') }); await new Promise(r => server.listen(0, '127.0.0.1', r)); const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const upload = await (await fetch(base + '/api/packages', { method: 'POST', body: pluginArchive().bytes })).json();
    await fetch(base + '/api/plugins/' + upload.plugin.id, { method: 'PUT', body: JSON.stringify({ published: true }) });
    const { plugins } = await readCatalog(base); const artifact = plugins[0].artifact;
    const sizes = [];
    const prepared = await prepareArtifact(artifact, '@bkms/test-plugin', join(dir, 'cache'), received => sizes.push(received));
    assert.equal(prepared.name, '@bkms/test-plugin'); assert.equal(prepared.version, '1.0.0'); assert.deepEqual(readFileSync(prepared.spec.slice(5)), pluginArchive().bytes);
    assert.equal(sizes.at(-1), artifact.size, '下载进度回调报告完整大小');
    await assert.rejects(() => prepareArtifact(artifact, '@bkms/other', join(dir, 'cache2')), /清单与发布记录不符/);
    await assert.rejects(() => prepareArtifact({ ...artifact, sha256: 'b'.repeat(64) }, '@bkms/test-plugin', join(dir, 'cache3')), /校验失败/);
    await assert.rejects(() => prepareArtifact(undefined, '@bkms/test-plugin', join(dir, 'cache')), /固定版本包/);
    assert.throws(() => centerAddress('file:///tmp/catalog')); assert.equal(centerAddress('http://h:1/'), 'http://h:1/plugins.json');
    assert.equal(parseDistribution({ schemaVersion: 2, revision: 1, rules: [] }).revision, 1);
    assert.throws(() => parseDistribution({ schemaVersion: 1, revision: 1, rules: [] }), /不受支持/);
  } finally { await new Promise(r => server.close(r)); rmSync(dir, { recursive: true, force: true }); }
});
