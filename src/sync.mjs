/**
 * 自动同步：按中心发布的第二版分发规则（distribution-v2.json）在 DSH 后端定时安装、升级插件。
 *
 * - 只处理规则中的插件：automatic / required 缺失时安装并启用；autoUpgrade 时目标版本更高就升级，不降级。
 * - automatic 安装过、之后被用户卸载的插件不再补装；required 缺失时总是补装。
 * - 规则一律直接在后台安装（execution 字段不再等待确认）；只在需要刷新界面或重启时提示。
 * - 每个插件的安装进度（排队 → 下载 → 安装 → 应用 → 完成/失败）可在状态中读取；手动安装与自动安装串行执行。
 * - 单个插件连续失败 maxFailures 次后暂停，直到规则版本变化或用户点击重试；每次失败后间隔 delaySeconds。
 * - 安装由官方 pluginManager 执行；生效动作按目标版本的 restart 设置与官方结果得出（none / reload / restart）。
 * - 插件中心自身最后升级，完成后总是提示重启。forceRemove 与变更通知本版本不执行。
 * - 离线种子（seed）：随客户端安装包提供的 distribution-v2.json 与 packages/*.tgz。启动时把种子包按 SHA256 放进缓存，
 *   中心读不到时依次使用上次读到的中心规则、种子规则继续安装，因此断网首次启动也能装好；同版本不再下载。
 */
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { centerAddress, defaultCenter, parseDistribution, prepareArtifact, readCatalog } from './service.mjs';

export const SELF = '@bkms/plugin-center';
const protectedName = name => ['bkms-market', 'dshmarket', 'dsh-market'].includes(name) || name.startsWith('@deepseek-ai/');
const packageName = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;
const HISTORY = 30;

/** 比较语义版本；预发布版本低于同号正式版本。无法解析时返回 null。 */
export function compareVersions(a, b) {
  const parse = v => /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+.*)?$/.exec(String(v ?? '').trim());
  const x = parse(a), y = parse(b);
  if (!x || !y) return null;
  for (let i = 1; i <= 3; i++) if (Number(x[i]) !== Number(y[i])) return Number(x[i]) > Number(y[i]) ? 1 : -1;
  if (x[4] === y[4]) return 0;
  if (!x[4]) return 1;
  if (!y[4]) return -1;
  const p = x[4].split('.'), q = y[4].split('.');
  for (let i = 0; i < Math.max(p.length, q.length); i++) {
    if (p[i] === undefined) return -1;
    if (q[i] === undefined) return 1;
    if (p[i] === q[i]) continue;
    const m = /^\d+$/.test(p[i]), n = /^\d+$/.test(q[i]);
    if (m && n) return Number(p[i]) > Number(q[i]) ? 1 : -1;
    if (m !== n) return m ? -1 : 1;
    return p[i] > q[i] ? 1 : -1;
  }
  return 0;
}

/** 生效动作：官方要求重启时总是重启；auto 在官方已热加载时刷新界面；插件中心自身总是重启。 */
export function effectOf(rule, application) {
  if (application === 'restart-required' || rule.packageName === SELF) return 'restart';
  const mode = rule.restart?.mode === 'required' ? 'restart' : rule.restart?.mode;
  if (mode === 'none' || mode === 'reload' || mode === 'restart') return mode;
  return 'reload';
}

/** 计算一条规则对本机的动作，不执行任何修改。 */
export function planRule(rule, bundle, record) {
  if (rule.forceRemove) return { action: 'none', state: 'unsupported', message: '明确卸载暂未在客户端执行' };
  const installed = bundle?.installed === true;
  if (bundle && !installed) return { action: 'none', state: 'builtin', message: '由 DSH 安装包提供，不自动修改' };
  if (!installed) {
    if (rule.installMode === 'manual') return { action: 'none', state: 'manual', message: '手工管理，未安装' };
    if (rule.installMode === 'automatic' && record?.managed) return { action: 'none', state: 'user-removed', message: '用户已卸载，自动维护不再补装' };
    return { action: 'install', state: 'install' };
  }
  const order = compareVersions(rule.version, bundle.version);
  if (order === null) return { action: 'none', state: 'unknown-version', message: `无法比较版本 ${bundle.version ?? '未知'} 与 ${rule.version}` };
  if (order > 0 && rule.autoUpgrade) return { action: 'upgrade', state: 'upgrade' };
  if (order > 0) return { action: 'none', state: 'outdated', message: '规则未开启自动升级' };
  return { action: 'none', state: 'current' };
}

function validRule(rule) {
  return rule && typeof rule === 'object' && typeof rule.packageName === 'string' && packageName.test(rule.packageName)
    && typeof rule.version === 'string' && rule.artifact && typeof rule.artifact === 'object'
    && rule.artifact.version === rule.version && ['manual', 'automatic', 'required'].includes(rule.installMode);
}

function readJson(file, fallback) {
  try { return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : fallback; } catch { return fallback; }
}
function writeJson(file, value) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file + '.tmp', JSON.stringify(value, null, 2));
  renameSync(file + '.tmp', file);
}
const messageOf = error => error instanceof Error ? error.message : String(error);
/** 官方结果中的可读失败原因：优先取 pnpm 的错误行，完整输出不重复堆叠。 */
export function failureOf(result) {
  if (result?.pendingBuilds?.length) return `需要批准安装脚本：${result.pendingBuilds.join(', ')}，请在 DSH 官方“插件”页手工安装一次并批准`;
  const text = [result?.error?.diagnostic, result?.packageResult?.output].filter(Boolean).join('\n');
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const key = lines.find(line => /ERR_PNPM_|^Error\b|EPERM|EACCES|ENOENT|ETIMEDOUT/.test(line)) ?? lines.at(-1);
  const reason = [result?.error?.code, key].filter(Boolean).join('：') || '安装失败';
  return reason.length > 400 ? reason.slice(0, 400) + '…' : reason;
}

/**
 * Profile 中同名目录是指向 Profile 外的链接、且未作为依赖声明时（常见于之前用本地目录开发安装后遗留），
 * pnpm 会顺着链接写入源码目录并失败。返回提示文字；无问题时返回空字符串。
 */
export function staleLinkProblem(profileDir, name) {
  if (!profileDir) return '';
  const path = join(profileDir, 'node_modules', ...name.split('/'));
  let stat;
  try { stat = lstatSync(path); } catch { return ''; }
  if (!stat.isSymbolicLink()) return '';
  let target = '';
  try { target = realpathSync(path); } catch { target = '（链接目标不存在）'; }
  const inside = target && !relative(profileDir, target).startsWith('..') && !isAbsolute(relative(profileDir, target));
  if (inside) return '';
  const declared = readJson(join(profileDir, 'package.json'), {})?.dependencies?.[name];
  if (declared) return '';
  return `Profile 的 node_modules/${name} 是指向 ${target} 的残留链接（通常是之前用本地目录安装遗留），自动安装会写入该目录，已停止。请只删除这个链接（不要删除源码目录）后点击重试。`;
}

/**
 * @param {object} options
 * @param {() => any} options.manager 官方 pluginManager（listBundles / installBundle）
 * @param {string} options.home 保存中心地址与包缓存的目录（DSH_HOME）
 * @param {string} options.stateDir 保存同步状态的目录（Profile 内）
 * @param {string} [options.profileDir] Profile 目录，用于检测 bkms-market 自动同步
 * @param {{center?: string, autoSync?: boolean}} [options.preset] Profile 预置配置，设置页保存的值优先
 * @param {typeof fetch} [options.fetcher] 测试可替换的请求函数
 * @param {() => number} [options.now] 测试可替换的时钟
 * @param {{set: Function, clear: Function}} [options.timers] 测试可替换的计时器
 * @param {number} [options.startupDelayMs] 启动后首次检查的延迟
 * @param {(level: 'info' | 'warn', message: string) => void} [options.log] 日志输出
 * @param {string} [options.seed] 离线种子目录（distribution-v2.json 与 packages/*.tgz），随客户端安装包提供
 */
export function createSync({ manager, home, stateDir, profileDir, preset = {}, fetcher = (...args) => fetch(...args), now = () => Date.now(), timers = { set: setTimeout, clear: clearTimeout }, startupDelayMs = 10000, log = () => {}, seed }) {
  const root = join(home, 'bkms-plugin-center');
  const configFile = join(root, 'config.json');
  const cacheDir = join(root, 'packages');
  const stateFile = join(stateDir, 'sync-state.json');
  // 上次成功读到的中心规则：中心暂时读不到时继续按它维护插件。
  const policyFile = join(stateDir, 'policy.json');
  let state = { revision: null, lastCheck: null, lastError: '', plugins: {}, history: [], ...readJson(stateFile, {}) };
  let policy = null, etag = null, policyCenter = null, policySource = null;
  let seedPolicy = null, seedError = '', seeded = false;
  let running = null, timer, nextCheckAt = null, disposed = false, backoff = 0, conflict = '';
  let rows = [];
  // 安装进度：packageName → { phase, received, total, detail, source, at, error }；requestId → packageName。
  const progress = new Map(), requests = new Map();
  let queue = Promise.resolve();
  const exclusive = fn => { const next = queue.then(fn, fn); queue = next.catch(() => {}); return next; };
  const setProgress = (name, patch) => progress.set(name, { ...progress.get(name), ...patch, at: now() });
  const notices = [];
  let noticeSeq = 0;

  function config() {
    const saved = readJson(configFile, {});
    const savedAddress = typeof saved.address === 'string' && saved.address ? saved.address : null;
    let address = defaultCenter, source = 'default';
    try {
      if (savedAddress) { address = centerAddress(savedAddress); source = 'saved'; }
      else if (preset.center) { address = centerAddress(preset.center); source = 'profile'; }
    } catch { /* 无效地址回退默认值。 */ }
    const autoSync = typeof saved.autoSync === 'boolean' ? saved.autoSync : preset.autoSync !== false;
    return { address, source, autoSync };
  }
  const save = () => writeJson(stateFile, state);
  const record = name => (state.plugins[name] ??= { failures: 0, lastError: '', lastAttempt: null, managed: false, pausedRevision: null });
  function remember(entry) { state.history = [{ at: new Date(now()).toISOString(), ...entry }, ...state.history].slice(0, HISTORY); }

  async function fetchPolicy(address) {
    const url = new URL('distribution-v2.json', address).href;
    if (policyCenter !== address) { policy = null; etag = null; }
    const response = await fetcher(url, { signal: AbortSignal.timeout(15000), headers: etag && policy ? { 'if-none-match': etag } : {} });
    if (response.status === 304 && policy) return policy;
    if (!response.ok) throw new Error(`策略读取失败（HTTP ${response.status}），请检查中心地址或服务版本`);
    let body;
    try { body = await response.json(); } catch { throw new Error('中心返回的策略不是有效 JSON'); }
    policy = parseDistribution(body);
    etag = response.headers.get('etag');
    policyCenter = address;
    try { writeJson(policyFile, { center: address, policy }); } catch { /* 规则缓存只为离线时使用 */ }
    return policy;
  }

  /**
   * 读入离线种子：规则留作中心读不到时使用；种子包按 SHA256 复制进缓存，prepareArtifact 命中缓存就不再下载。
   * 只执行一次；种子缺失或损坏时记录原因，不影响按中心规则同步。
   */
  function loadSeed() {
    if (seeded || !seed) return;
    seeded = true;
    try {
      const rulesFile = join(seed, 'distribution-v2.json');
      if (existsSync(rulesFile)) seedPolicy = parseDistribution(JSON.parse(readFileSync(rulesFile, 'utf8')));
      const packagesDir = join(seed, 'packages');
      if (existsSync(packagesDir)) {
        mkdirSync(cacheDir, { recursive: true });
        for (const file of readdirSync(packagesDir).filter(name => name.endsWith('.tgz'))) {
          const bytes = readFileSync(join(packagesDir, file));
          const target = join(cacheDir, createHash('sha256').update(bytes).digest('hex') + '.tgz');
          if (!existsSync(target)) copyFileSync(join(packagesDir, file), target);
        }
      }
    } catch (error) {
      seedError = `离线种子不可用：${messageOf(error)}`;
      log('warn', seedError);
    }
  }

  /** 中心读不到时的规则：先用上次读到的中心规则，再用离线种子。 */
  function fallbackPolicy(address) {
    if (policy && policyCenter === address) return { policy, source: 'cache' };
    const cached = readJson(policyFile, null);
    if (cached?.policy && cached.center === address) {
      try { return { policy: parseDistribution(cached.policy), source: 'cache' }; } catch { /* 损坏时退到种子 */ }
    }
    return seedPolicy ? { policy: seedPolicy, source: 'seed' } : null;
  }

  /** bkms-market 的旧自动同步仍开启时，两边会同时修改同一个 Profile，暂停执行。 */
  function legacyConflict(bundles) {
    const market = bundles.find(b => b.name === 'bkms-market');
    if (!market?.enabled || !profileDir) return '';
    const managed = readJson(join(profileDir, '.bkms-market', 'managed.json'), null);
    return managed?.enabled ? 'bkms-market 的自动同步仍开启，请在 bkms-market 中暂停自动同步或停用 bkms-market，避免两处同时修改插件' : '';
  }

  function addNotice(kind, item) {
    const last = notices.at(-1);
    // 同一批次的同类动作合并为一条提示。
    if (last && last.kind === kind && last.batch === noticeSeq) { last.items.push(item); last.at = now(); return; }
    notices.push({ id: `${kind}-${now()}-${notices.length}`, kind, at: now(), batch: noticeSeq, items: [item] });
    if (notices.length > 20) notices.shift();
  }

  async function execute(rule, plan, bundle, source = 'auto') {
    const name = rule.packageName, entry = record(name);
    entry.lastAttempt = new Date(now()).toISOString();
    const requestId = randomUUID();
    setProgress(name, { phase: 'downloading', received: 0, total: rule.artifact?.size ?? 0, detail: '', source, action: plan.action, version: rule.version, error: '' });
    try {
      const problem = staleLinkProblem(profileDir, name);
      if (problem) throw new Error(problem);
      const prepared = await prepareArtifact(rule.artifact, name, cacheDir, (received, total) => setProgress(name, { received, total }));
      setProgress(name, { phase: 'installing', detail: '' });
      requests.set(requestId, name);
      const result = await manager().installBundle(prepared.spec, { requestId, enabled: plan.action === 'install' ? true : bundle?.enabled !== false });
      if (!result || result.application === 'failed' || result.application === 'cancelled') throw new Error(failureOf(result));
      const after = (await manager().listBundles()).find(b => b.name === rule.packageName);
      if (after?.version !== rule.version) throw new Error(`安装后版本为 ${after?.version ?? '未知'}，与目标 ${rule.version} 不符`);
      const effect = effectOf(rule, result.application);
      Object.assign(entry, { failures: 0, lastError: '', managed: entry.managed || plan.action === 'install', pausedRevision: null, version: rule.version });
      remember({ packageName: rule.packageName, name: rule.name, action: plan.action, from: bundle?.version ?? null, to: rule.version, ok: true, effect, source });
      setProgress(name, { phase: 'done', effect, detail: '' });
      const row = rows.find(r => r.packageName === name);
      if (row) Object.assign(row, { installed: rule.version, state: 'done', failures: 0, lastError: '' });
      if (effect !== 'none') addNotice(effect, { packageName: rule.packageName, name: rule.name || rule.packageName, version: rule.version, note: rule.restart?.note ?? '' });
      log('info', `${plan.action} ${rule.packageName}@${rule.version} → ${effect}`);
    } catch (error) {
      const message = messageOf(error);
      entry.failures += 1; entry.lastError = message;
      if (entry.failures >= (rule.retry?.maxFailures ?? 3)) entry.pausedRevision = state.revision;
      remember({ packageName: rule.packageName, name: rule.name, action: plan.action, from: bundle?.version ?? null, to: rule.version, ok: false, error: message, source });
      setProgress(name, { phase: 'failed', error: message, detail: '' });
      log('warn', `${plan.action} ${rule.packageName}@${rule.version} failed: ${message}`);
    } finally { requests.delete(requestId); }
    save();
  }

  /**
   * 执行一轮检查。trigger：startup 只处理启用启动检查的规则，periodic 只处理启用定时检查的规则，manual 处理全部。
   */
  async function check(trigger) {
    const { address } = config();
    noticeSeq += 1;
    loadSeed();
    let current, centerError = '';
    try {
      current = await fetchPolicy(address);
      policySource = 'center';
      backoff = 0;
    } catch (error) {
      centerError = messageOf(error);
      backoff += 1;
      // 中心读不到时不停下：按上次的中心规则或离线种子继续维护，保证断网首次启动也能装好。
      const fallback = fallbackPolicy(address);
      if (!fallback) { state.lastError = centerError; state.lastCheck = new Date(now()).toISOString(); save(); return; }
      current = fallback.policy;
      policySource = fallback.source;
      log('warn', `center unavailable (${centerError}); using ${fallback.source} rules`);
    }
    const bundles = await manager().listBundles();
    conflict = legacyConflict(bundles);
    if (state.revision !== current.revision) {
      // 新规则版本解除暂停。
      for (const entry of Object.values(state.plugins)) if (entry.pausedRevision !== null) { entry.pausedRevision = null; entry.failures = 0; }
      state.revision = current.revision;
    }
    const nextRows = [], work = [];
    for (const rule of current.rules) {
      if (!validRule(rule) || protectedName(rule.packageName)) continue;
      const bundle = bundles.find(b => b.name === rule.packageName);
      const entry = state.plugins[rule.packageName];
      const plan = planRule(rule, bundle, entry);
      const row = { packageName: rule.packageName, name: rule.name || rule.packageName, target: rule.version, installed: bundle?.installed ? bundle.version ?? null : null, enabled: !!bundle?.enabled, installMode: rule.installMode, autoUpgrade: !!rule.autoUpgrade, restart: rule.restart?.mode ?? 'auto', state: plan.state, message: plan.message ?? '', failures: entry?.failures ?? 0, lastError: entry?.lastError ?? '' };
      nextRows.push(row);
      if (plan.action === 'none') continue;
      const sync = rule.sync ?? { startup: true, periodic: true };
      if (trigger === 'startup' && !sync.startup) { row.state = 'scheduled'; continue; }
      if (trigger === 'periodic' && !sync.periodic) { row.state = 'scheduled'; continue; }
      if (entry?.pausedRevision !== null && entry?.pausedRevision !== undefined) { row.state = 'paused'; row.message = `连续失败 ${entry.failures} 次，已暂停`; continue; }
      const delay = (rule.retry?.delaySeconds ?? 300) * 1000;
      if (entry?.failures && entry.lastAttempt && now() - Date.parse(entry.lastAttempt) < delay && trigger !== 'manual') { row.state = 'waiting-retry'; continue; }
      if (conflict) { row.state = 'conflict'; row.message = conflict; continue; }
      row.state = 'queued';
      setProgress(rule.packageName, { phase: 'queued', received: 0, total: rule.artifact?.size ?? 0, detail: '', source: 'auto', action: plan.action, version: rule.version, error: '' });
      work.push({ rule, plan, bundle, row });
    }
    // 插件中心自身最后执行：其升级需要重启，不影响本轮其他插件。
    work.sort((a, b) => Number(a.rule.packageName === SELF) - Number(b.rule.packageName === SELF));
    rows = nextRows;
    for (const item of work) {
      if (disposed) break;
      item.row.state = 'running';
      await exclusive(() => execute(item.rule, item.plan, item.bundle));
      const entry = state.plugins[item.rule.packageName];
      item.row.state = entry.failures ? (entry.pausedRevision !== null ? 'paused' : 'failed') : 'done';
      item.row.failures = entry.failures; item.row.lastError = entry.lastError;
      if (!entry.failures) item.row.installed = item.rule.version;
    }
    state.lastError = centerError ? `${centerError}（已按${policySource === 'seed' ? '离线种子' : '上次的中心规则'}继续）` : '';
    state.lastCheck = new Date(now()).toISOString(); save();
  }

  function run(trigger) {
    if (running) return running;
    running = check(trigger).catch(error => { state.lastError = messageOf(error); save(); }).finally(() => { running = null; });
    return running;
  }

  function intervalMs() {
    const minutes = (policy?.rules ?? []).filter(r => r?.sync?.periodic !== false && Number.isInteger(r?.sync?.intervalMinutes)).map(r => r.sync.intervalMinutes);
    const base = (minutes.length ? Math.max(1, Math.min(...minutes)) : 5) * 60000;
    // 连续读取失败时退避，最长一小时。
    return Math.min(base * 2 ** Math.min(backoff, 4), 3600000) + Math.floor(Math.random() * 15000);
  }
  function schedule(delay, trigger) {
    if (timer) timers.clear(timer);
    timer = undefined; nextCheckAt = null;
    if (disposed || !config().autoSync) return;
    nextCheckAt = now() + delay;
    timer = timers.set(async () => {
      timer = undefined;
      await run(trigger);
      schedule(intervalMs(), 'periodic');
    }, delay);
    timer?.unref?.();
  }

  return {
    start() { disposed = false; schedule(startupDelayMs, 'startup'); },
    stop() { disposed = true; if (timer) timers.clear(timer); timer = undefined; nextCheckAt = null; },
    /** 用户手动检查：处理全部规则，忽略重试间隔。 */
    async checkNow() { await run('manual'); schedule(intervalMs(), 'periodic'); return this.status(); },
    /**
     * 用户在 BKMS 插件页点击安装 / 更新：按中心目录的发布包直接在后台安装，立即返回，进度从 status 读取。
     * @param {string} identity 目录条目的 url
     */
    async install(identity) {
      const { plugins } = await readCatalog(config().address);
      const entry = plugins.find(p => p.url === identity);
      const artifact = entry?.artifact;
      if (!artifact || !entry.packageName) throw new Error('该插件尚未上传并发布 .tgz 包');
      if (protectedName(entry.packageName)) throw new Error('市场和 DSH 基础包不能在这里安装');
      const active = progress.get(entry.packageName);
      if (active && !['done', 'failed'].includes(active.phase)) return this.status();
      const bundle = (await manager().listBundles()).find(b => b.name === entry.packageName);
      if (bundle?.installed && compareVersions(artifact.version, bundle.version) === 0) throw new Error('已安装此版本');
      const rule = { packageName: entry.packageName, name: entry.name, version: artifact.version, artifact, restart: artifact.restart, installMode: 'manual' };
      const plan = { action: bundle?.installed ? 'upgrade' : 'install' };
      Object.assign(record(entry.packageName), { failures: 0, pausedRevision: null, lastError: '' });
      noticeSeq += 1;
      setProgress(entry.packageName, { phase: 'queued', received: 0, total: artifact.size, detail: '', source: 'manual', action: plan.action, version: artifact.version, error: '' });
      void exclusive(() => execute(rule, plan, bundle, 'manual'));
      return this.status();
    },
    /** 官方安装器的日志事件：在卡片上显示 pnpm 的最新一行输出。 */
    installLog(chunk) {
      const name = requests.get(chunk?.requestId);
      if (!name) return;
      const line = String(chunk.text ?? '').replace(/\u001b\[[0-9;]*[A-Za-z]/g, '').split(/\r?\n|\r/).map(l => l.trim()).filter(Boolean).at(-1);
      if (line) setProgress(name, { detail: line.length > 160 ? line.slice(0, 160) + '…' : line });
    },
    /** 官方安装器的阶段事件：pnpm 完成后进入 applying（写入 Profile 并启用）。 */
    installState(event) {
      const name = requests.get(event?.requestId);
      if (name && event.phase === 'applying') setProgress(name, { phase: 'applying' });
    },
    retry(name) {
      const entry = state.plugins[name];
      if (entry) { entry.failures = 0; entry.pausedRevision = null; entry.lastError = ''; save(); }
      return this.checkNow();
    },
    getConfig: config,
    setConfig(input) {
      const saved = readJson(configFile, {});
      if (input.address !== undefined) saved.address = input.address === null || input.address === '' ? undefined : centerAddress(String(input.address));
      if (input.autoSync !== undefined) {
        if (typeof input.autoSync !== 'boolean') throw new Error('自动更新开关必须是布尔值');
        saved.autoSync = input.autoSync;
      }
      writeJson(configFile, saved);
      // 地址或开关变化后尽快按新配置检查；关闭时 schedule 只清除计时器。
      schedule(startupDelayMs, 'manual');
      return config();
    },
    /** since：页面加载时间，早于该时间的刷新提示已因页面重新加载而失效。 */
    status(since = 0) {
      const { address, source, autoSync } = config();
      return {
        available: true, autoSync, center: address, centerSource: source, running: !!running, nextCheckAt,
        lastCheck: state.lastCheck, lastError: state.lastError, revision: state.revision, conflict,
        policySource, seed: seed ? { loaded: !!seedPolicy, error: seedError } : null,
        plugins: rows, history: state.history,
        // 进行中的安装始终返回；完成的保留 20 秒用于显示结果，失败的保留到下次尝试。
        progress: Object.fromEntries([...progress].filter(([, p]) => p.phase !== 'done' || now() - p.at < 20000)),
        notices: notices.filter(n => n.kind === 'restart' || n.at > since).map(({ batch, ...n }) => n),
      };
    },
  };
}
