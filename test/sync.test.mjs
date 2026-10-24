import { test } from 'node:test'; import assert from 'node:assert/strict'; import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync, symlinkSync } from 'node:fs'; import { tmpdir } from 'node:os'; import { join } from 'node:path';
import { createCenter } from '../../../../cloud/dsh-plugin-center/server.mjs'; import { pluginArchive } from '../../../../cloud/dsh-plugin-center/test/archive-fixture.mjs'; import { readPluginArchive } from '../../../../cloud/dsh-plugin-center/archive.mjs';
import { createSync, compareVersions, effectOf, planRule, staleLinkProblem, failureOf } from '../src/sync.mjs';

test('版本比较、生效动作与单条规则计划', () => {
  assert.equal(compareVersions('1.10.0', '1.9.9'), 1); assert.equal(compareVersions('1.0.0-rc.1', '1.0.0'), -1); assert.equal(compareVersions('1.0.0-rc.10', '1.0.0-rc.9'), 1); assert.equal(compareVersions('1.0.0', '1.0.0'), 0); assert.equal(compareVersions('latest', '1.0.0'), null);
  assert.equal(effectOf({ packageName: 'a', restart: { mode: 'none' } }, 'restart-required'), 'restart', '官方要求重启不可覆盖');
  assert.equal(effectOf({ packageName: 'a', restart: { mode: 'auto' } }, 'applied'), 'reload');
  assert.equal(effectOf({ packageName: 'a', restart: { mode: 'required' } }, 'applied'), 'restart');
  assert.equal(effectOf({ packageName: '@bkms/plugin-center', restart: { mode: 'none' } }, 'applied'), 'restart');
  const rule = { packageName: 'a', version: '2.0.0', installMode: 'manual', autoUpgrade: true };
  assert.equal(planRule(rule, undefined).action, 'none');
  assert.equal(planRule({ ...rule, installMode: 'automatic' }, undefined, { managed: true }).state, 'user-removed');
  assert.equal(planRule({ ...rule, installMode: 'required' }, undefined, { managed: true }).action, 'install');
  assert.equal(planRule(rule, { installed: true, version: '1.0.0' }).action, 'upgrade');
  assert.equal(planRule(rule, { installed: true, version: '3.0.0' }).action, 'none', '不降级');
  assert.equal(planRule({ ...rule, autoUpgrade: false }, { installed: true, version: '1.0.0' }).state, 'outdated');
  assert.equal(planRule(rule, { installed: false, version: '1.0.0' }).state, 'builtin');
});

test('残留目录链接保护与失败原因精简', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bkms-link-'));
  try {
    const profile = join(dir, 'profile'), source = join(dir, 'source');
    mkdirSync(join(profile, 'node_modules'), { recursive: true }); mkdirSync(source);
    writeFileSync(join(profile, 'package.json'), JSON.stringify({ dependencies: {} }));
    assert.equal(staleLinkProblem(profile, 'bkms-workbench'), '', '不存在时无问题');
    symlinkSync(source, join(profile, 'node_modules', 'bkms-workbench'), 'junction');
    assert.match(staleLinkProblem(profile, 'bkms-workbench'), /残留链接/);
    writeFileSync(join(profile, 'package.json'), JSON.stringify({ dependencies: { 'bkms-workbench': 'link:../source' } }));
    assert.equal(staleLinkProblem(profile, 'bkms-workbench'), '', '已声明的开发链接不拦截');
    const output = '✓ Lockfile passes\nProgress: resolved 1\n[ERR_PNPM_EPERM] [importPackage X] EPERM: operation not permitted, symlink A -> B\nProgress: resolved 105';
    assert.equal(failureOf({ error: { code: 'operation-error', diagnostic: output }, packageResult: { output } }), 'operation-error：[ERR_PNPM_EPERM] [importPackage X] EPERM: operation not permitted, symlink A -> B');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('按第二版规则自动安装、升级、确认、失败暂停与 bkms-market 冲突保护', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'bkms-sync-')); const server = createCenter({ dataDir: join(dir, 'center') }); await new Promise(r => server.listen(0, '127.0.0.1', r)); const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (path, method = 'GET', body) => { const r = await fetch(base + path, { method, body: body === undefined ? undefined : Buffer.isBuffer(body) ? body : JSON.stringify(body) }); return r.json(); };
  const upload = async (name, version, mode = 'auto') => (await call(`/api/packages?restartMode=${mode}`, 'POST', pluginArchive(version, { name }).bytes)).plugin;
  const rule = async (plugin, body) => { await call(`/api/plugins/${plugin.id}/distribution`, 'PUT', { schemaVersion: 2, forceRemove: false, sync: { startup: true, periodic: true, intervalMinutes: 5, notification: false }, execution: 'idle', ...body }); await call(`/api/plugins/${plugin.id}/distribution/publish`, 'POST'); };
  // 假的官方 pluginManager：从 tgz 读取包名和版本写入 bundles。
  const bundles = []; const calls = []; const failing = new Set(); let application = 'applied';
  const manager = {
    async listBundles() { return structuredClone(bundles); },
    async installBundle(spec, options) {
      calls.push({ spec, options });
      const { manifest } = readPluginArchive(readFileSync(spec.slice(5)));
      if (failing.has(manifest.name)) return { application: 'failed', error: { code: 'install-failed', diagnostic: '模拟失败' } };
      const index = bundles.findIndex(b => b.name === manifest.name), existed = index >= 0;
      const next = { name: manifest.name, version: manifest.version, installed: true, enabled: options.enabled !== false };
      if (existed) bundles[index] = next; else bundles.push(next);
      return { application: existed ? 'restart-required' : application, bundle: manifest.name };
    },
  };
  const profileDir = join(dir, 'profile'); mkdirSync(profileDir, { recursive: true });
  const sync = createSync({ manager: () => manager, home: join(dir, 'home'), stateDir: join(profileDir, '.bkms-plugin-center'), profileDir, preset: { center: base } });
  try {
    assert.equal(sync.getConfig().source, 'profile'); assert.equal(sync.getConfig().address, base + '/plugins.json');
    const a = await upload('@bkms/a', '1.0.0', 'reload'); await upload('@bkms/a', '1.1.0', 'reload');
    await rule(a, { installMode: 'automatic', autoUpgrade: true, version: '1.1.0' });
    const pageLoaded = Date.now() - 1;
    let status = await sync.checkNow();
    assert.equal(calls.length, 1); assert.match(calls[0].spec, /^file:.*\.tgz$/); assert.equal(calls[0].options.enabled, true);
    assert.deepEqual(bundles.map(b => [b.name, b.version]), [['@bkms/a', '1.1.0']]);
    assert.equal(status.notices[0].kind, 'reload'); assert.equal(status.notices[0].items[0].version, '1.1.0');
    assert.equal(sync.status(Date.now() + 1).notices.length, 0, '页面重新加载后刷新提示失效');
    assert.equal(sync.status(pageLoaded).notices.length, 1);
    status = await sync.checkNow(); assert.equal(calls.length, 1, '已是目标版本不重复安装'); assert.equal(status.plugins[0].state, 'current');

    bundles.length = 0; status = await sync.checkNow();
    assert.equal(calls.length, 1, '自动维护尊重用户卸载'); assert.equal(status.plugins.find(p => p.packageName === '@bkms/a').state, 'user-removed');

    // 手工安装的旧版本（任意来源）在 autoUpgrade 时升级，并保持原停用状态；官方要求重启。
    bundles.push({ name: '@bkms/b', version: '1.0.0', installed: true, enabled: false });
    const b = await upload('@bkms/b', '2.0.0', 'none'); await rule(b, { installMode: 'manual', autoUpgrade: true, version: '2.0.0' });
    status = await sync.checkNow();
    assert.equal(bundles.find(x => x.name === '@bkms/b').version, '2.0.0'); assert.equal(calls.at(-1).options.enabled, false);
    assert.ok(status.notices.some(n => n.kind === 'restart' && n.items[0].packageName === '@bkms/b'));

    // 旧规则的 execution=confirm 不再等待确认，直接安装；进度带 requestId 且完成后可读。
    const c = await upload('@bkms/c', '1.0.0'); await rule(c, { installMode: 'required', autoUpgrade: true, version: '1.0.0', execution: 'confirm' });
    status = await sync.checkNow();
    assert.ok(bundles.some(x => x.name === '@bkms/c')); assert.equal(status.pending, undefined);
    assert.ok(calls.at(-1).options.requestId); assert.equal(status.progress['@bkms/c'].phase, 'done'); assert.equal(status.progress['@bkms/c'].received, status.progress['@bkms/c'].total);

    // 手动安装：BKMS 插件页按目录条目直接安装，立即返回，进度可见；同版本拒绝。
    const m = await upload('@bkms/manual', '3.0.0', 'none'); await call(`/api/plugins/${m.id}`, 'PUT', { published: true });
    let release; const gate = new Promise(r => { release = r; }); const original = manager.installBundle;
    manager.installBundle = async (spec, options) => { sync.installLog({ requestId: options.requestId, text: '\u001b[32mProgress: resolved 3, added 1\u001b[0m\n' }); await gate; return original(spec, options); };
    status = await sync.install(`${base}/plugins/${m.id}`);
    assert.ok(['queued', 'downloading', 'installing'].includes(status.progress['@bkms/manual'].phase));
    await new Promise(r => setTimeout(r, 100));
    status = sync.status(); assert.equal(status.progress['@bkms/manual'].phase, 'installing'); assert.equal(status.progress['@bkms/manual'].detail, 'Progress: resolved 3, added 1');
    release(); await new Promise(r => setTimeout(r, 100)); manager.installBundle = original;
    status = sync.status(); assert.equal(status.progress['@bkms/manual'].phase, 'done'); assert.ok(bundles.some(x => x.name === '@bkms/manual' && x.enabled));
    assert.equal(status.notices.some(n => n.items.some(i => i.packageName === '@bkms/manual')), false, '生效方式为无需处理时不提醒');
    await assert.rejects(() => sync.install(`${base}/plugins/${m.id}`), /已安装此版本/);

    // 连续失败三次暂停，新规则版本解除暂停。
    const d = await upload('@bkms/d', '1.0.0'); await rule(d, { installMode: 'automatic', autoUpgrade: false, version: '1.0.0' }); failing.add('@bkms/d');
    for (let i = 0; i < 3; i++) status = await sync.checkNow();
    let row = status.plugins.find(p => p.packageName === '@bkms/d'); assert.equal(row.state, 'paused'); assert.equal(row.failures, 3); assert.match(row.lastError, /模拟失败/);
    const attempts = calls.length; status = await sync.checkNow(); assert.equal(calls.length, attempts, '暂停后不再尝试');
    failing.delete('@bkms/d'); status = await sync.retry('@bkms/d'); assert.ok(bundles.some(x => x.name === '@bkms/d'), '用户重试后恢复');
    assert.ok(status.history.some(h => h.packageName === '@bkms/d' && !h.ok));

    // bkms-market 自动同步仍开启时不执行。
    const e = await upload('@bkms/e', '1.0.0'); await rule(e, { installMode: 'automatic', autoUpgrade: false, version: '1.0.0' });
    bundles.push({ name: 'bkms-market', version: '0.4.0', installed: true, enabled: true });
    mkdirSync(join(profileDir, '.bkms-market')); writeFileSync(join(profileDir, '.bkms-market', 'managed.json'), JSON.stringify({ enabled: true }));
    status = await sync.checkNow(); assert.match(status.conflict, /bkms-market/); assert.ok(!bundles.some(x => x.name === '@bkms/e'));
    writeFileSync(join(profileDir, '.bkms-market', 'managed.json'), JSON.stringify({ enabled: false }));
    status = await sync.checkNow(); assert.equal(status.conflict, ''); assert.ok(bundles.some(x => x.name === '@bkms/e'));

    // 设置页保存的地址优先于 Profile 预置，状态写入 Profile。
    assert.equal(sync.setConfig({ address: 'http://example.test:9/', autoSync: false }).source, 'saved');
    assert.equal(sync.getConfig().address, 'http://example.test:9/plugins.json'); assert.equal(sync.getConfig().autoSync, false);
    assert.throws(() => sync.setConfig({ address: 'file:///tmp' }));
    assert.equal(sync.setConfig({ address: '' }).source, 'profile');
    assert.ok(existsSync(join(profileDir, '.bkms-plugin-center', 'sync-state.json')));
  } finally { sync.stop(); await new Promise(r => server.close(r)); rmSync(dir, { recursive: true, force: true }); }
});
