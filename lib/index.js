// src/index.ts
import { homedir } from "node:os";
import { join as join3 } from "node:path";

// src/service.mjs
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
var defaultCenter = "https://118.145.114.8/plugin-center/plugins.json";
function centerAddress(value) {
  const url = new URL(value || defaultCenter);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("\u8BF7\u586B\u5199 HTTP \u6216 HTTPS \u4E2D\u5FC3\u5730\u5740");
  if (!url.pathname.endsWith("/plugins.json")) url.pathname = url.pathname.replace(/\/$/, "") + "/plugins.json";
  url.search = "";
  url.hash = "";
  return url.href;
}
async function readCatalog(value) {
  const center = centerAddress(value);
  const response = await fetch(center, { signal: AbortSignal.timeout(15e3) });
  if (!response.ok) throw new Error(`\u4E2D\u5FC3\u8BFB\u53D6\u5931\u8D25\uFF08HTTP ${response.status}\uFF09\uFF0C\u8BF7\u68C0\u67E5\u5730\u5740\u540E\u91CD\u8BD5`);
  const catalog = await response.json();
  if (!Array.isArray(catalog.plugins)) throw new Error("\u4E2D\u5FC3\u8FD4\u56DE\u7684\u76EE\u5F55\u4E0D\u5B8C\u6574");
  return { center, plugins: catalog.plugins };
}
function parseDistribution(result) {
  if (result?.schemaVersion !== 2 || !Array.isArray(result.rules) || !Number.isSafeInteger(result.revision) || result.revision < 0) throw new Error("\u4E2D\u5FC3\u8FD4\u56DE\u7684\u7B56\u7565\u683C\u5F0F\u4E0D\u53D7\u652F\u6301");
  return { schemaVersion: result.schemaVersion, revision: result.revision, rules: result.rules };
}
function packageManifest(bytes) {
  const tar = gunzipSync(bytes, { maxOutputLength: 256 * 1024 * 1024 });
  for (let offset = 0; offset + 512 <= tar.length; ) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((v) => v === 0)) break;
    const text = (a, b) => header.subarray(a, b).toString().replace(/\0.*$/s, "");
    const size = parseInt(text(124, 136).trim() || "0", 8);
    if (!Number.isSafeInteger(size) || size < 0 || offset + 512 + size > tar.length) throw new Error("\u5305\u7ED3\u6784\u635F\u574F");
    if (text(0, 100) === "package/package.json") return JSON.parse(tar.subarray(offset + 512, offset + 512 + size).toString());
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return void 0;
}
async function prepareArtifact(artifact, packageName2, directory, onProgress = () => {
}) {
  if (!artifact || !/^[a-f0-9]{64}$/.test(artifact.sha256) || !Number.isSafeInteger(artifact.size) || artifact.size < 1 || artifact.size > 64 * 1024 * 1024) throw new Error("\u8BF7\u5148\u5728\u4E2D\u5FC3\u4E0A\u4F20\u56FA\u5B9A\u7248\u672C\u5305\u5E76\u4E0A\u67B6");
  const file = join(directory, artifact.sha256 + ".tgz");
  let bytes;
  if (existsSync(file)) bytes = readFileSync(file);
  else {
    const url = new URL(artifact.url);
    if (!["http:", "https:"].includes(url.protocol)) throw new Error("\u53D1\u5E03\u5305\u5730\u5740\u5FC5\u987B\u662F HTTP \u6216 HTTPS");
    const response = await fetch(url, { signal: AbortSignal.timeout(12e4) });
    if (!response.ok || !response.body) throw new Error(`\u4E0B\u8F7D\u5931\u8D25\uFF08HTTP ${response.status}\uFF09`);
    const chunks = [];
    let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > artifact.size) throw new Error("\u4E0B\u8F7D\u5927\u5C0F\u8D85\u8FC7\u53D1\u5E03\u8BB0\u5F55");
      chunks.push(Buffer.from(chunk));
      onProgress(size, artifact.size);
    }
    bytes = Buffer.concat(chunks);
  }
  if (bytes.length !== artifact.size || createHash("sha256").update(bytes).digest("hex") !== artifact.sha256) throw new Error("\u5305\u6821\u9A8C\u5931\u8D25\uFF0C\u672A\u4EA4\u7ED9\u5B89\u88C5\u5668");
  const manifest = packageManifest(bytes);
  if (!manifest || manifest.name !== packageName2 || manifest.version !== artifact.version || JSON.stringify(manifest) !== JSON.stringify(artifact.manifest)) throw new Error("\u5305\u6E05\u5355\u4E0E\u53D1\u5E03\u8BB0\u5F55\u4E0D\u7B26");
  mkdirSync(directory, { recursive: true });
  if (!existsSync(file)) writeFileSync(file, bytes, { flag: "wx" });
  return { spec: "file:" + file.replaceAll("\\", "/"), name: manifest.name, version: manifest.version };
}

// src/sync.mjs
import { copyFileSync, existsSync as existsSync2, lstatSync, mkdirSync as mkdirSync2, readFileSync as readFileSync2, readdirSync, realpathSync, renameSync, writeFileSync as writeFileSync2 } from "node:fs";
import { dirname, isAbsolute, join as join2, relative } from "node:path";
import { createHash as createHash2, randomUUID } from "node:crypto";
var SELF = "@bkms/plugin-center";
var protectedName = (name) => ["bkms-market", "dshmarket", "dsh-market"].includes(name) || name.startsWith("@deepseek-ai/");
var packageName = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;
var HISTORY = 30;
function compareVersions(a, b) {
  const parse = (v) => /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+.*)?$/.exec(String(v ?? "").trim());
  const x = parse(a), y = parse(b);
  if (!x || !y) return null;
  for (let i = 1; i <= 3; i++) if (Number(x[i]) !== Number(y[i])) return Number(x[i]) > Number(y[i]) ? 1 : -1;
  if (x[4] === y[4]) return 0;
  if (!x[4]) return 1;
  if (!y[4]) return -1;
  const p = x[4].split("."), q = y[4].split(".");
  for (let i = 0; i < Math.max(p.length, q.length); i++) {
    if (p[i] === void 0) return -1;
    if (q[i] === void 0) return 1;
    if (p[i] === q[i]) continue;
    const m = /^\d+$/.test(p[i]), n = /^\d+$/.test(q[i]);
    if (m && n) return Number(p[i]) > Number(q[i]) ? 1 : -1;
    if (m !== n) return m ? -1 : 1;
    return p[i] > q[i] ? 1 : -1;
  }
  return 0;
}
function effectOf(rule, application) {
  if (application === "restart-required" || rule.packageName === SELF) return "restart";
  const mode = rule.restart?.mode === "required" ? "restart" : rule.restart?.mode;
  if (mode === "none" || mode === "reload" || mode === "restart") return mode;
  return "reload";
}
function planRule(rule, bundle, record) {
  if (rule.forceRemove) return { action: "none", state: "unsupported", message: "\u660E\u786E\u5378\u8F7D\u6682\u672A\u5728\u5BA2\u6237\u7AEF\u6267\u884C" };
  const installed = bundle?.installed === true;
  if (bundle && !installed) return { action: "none", state: "builtin", message: "\u7531 DSH \u5B89\u88C5\u5305\u63D0\u4F9B\uFF0C\u4E0D\u81EA\u52A8\u4FEE\u6539" };
  if (!installed) {
    if (rule.installMode === "manual") return { action: "none", state: "manual", message: "\u624B\u5DE5\u7BA1\u7406\uFF0C\u672A\u5B89\u88C5" };
    if (rule.installMode === "automatic" && record?.managed) return { action: "none", state: "user-removed", message: "\u7528\u6237\u5DF2\u5378\u8F7D\uFF0C\u81EA\u52A8\u7EF4\u62A4\u4E0D\u518D\u8865\u88C5" };
    return { action: "install", state: "install" };
  }
  const order = compareVersions(rule.version, bundle.version);
  if (order === null) return { action: "none", state: "unknown-version", message: `\u65E0\u6CD5\u6BD4\u8F83\u7248\u672C ${bundle.version ?? "\u672A\u77E5"} \u4E0E ${rule.version}` };
  if (order > 0 && rule.autoUpgrade) return { action: "upgrade", state: "upgrade" };
  if (order > 0) return { action: "none", state: "outdated", message: "\u89C4\u5219\u672A\u5F00\u542F\u81EA\u52A8\u5347\u7EA7" };
  return { action: "none", state: "current" };
}
function validRule(rule) {
  return rule && typeof rule === "object" && typeof rule.packageName === "string" && packageName.test(rule.packageName) && typeof rule.version === "string" && rule.artifact && typeof rule.artifact === "object" && rule.artifact.version === rule.version && ["manual", "automatic", "required"].includes(rule.installMode);
}
function readJson(file, fallback) {
  try {
    return existsSync2(file) ? JSON.parse(readFileSync2(file, "utf8")) : fallback;
  } catch {
    return fallback;
  }
}
function writeJson(file, value) {
  mkdirSync2(dirname(file), { recursive: true });
  writeFileSync2(file + ".tmp", JSON.stringify(value, null, 2));
  renameSync(file + ".tmp", file);
}
var messageOf = (error) => error instanceof Error ? error.message : String(error);
function failureOf(result) {
  if (result?.pendingBuilds?.length) return `\u9700\u8981\u6279\u51C6\u5B89\u88C5\u811A\u672C\uFF1A${result.pendingBuilds.join(", ")}\uFF0C\u8BF7\u5728 DSH \u5B98\u65B9\u201C\u63D2\u4EF6\u201D\u9875\u624B\u5DE5\u5B89\u88C5\u4E00\u6B21\u5E76\u6279\u51C6`;
  const text = [result?.error?.diagnostic, result?.packageResult?.output].filter(Boolean).join("\n");
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const key = lines.find((line) => /ERR_PNPM_|^Error\b|EPERM|EACCES|ENOENT|ETIMEDOUT/.test(line)) ?? lines.at(-1);
  const reason = [result?.error?.code, key].filter(Boolean).join("\uFF1A") || "\u5B89\u88C5\u5931\u8D25";
  return reason.length > 400 ? reason.slice(0, 400) + "\u2026" : reason;
}
function staleLinkProblem(profileDir, name) {
  if (!profileDir) return "";
  const path = join2(profileDir, "node_modules", ...name.split("/"));
  let stat;
  try {
    stat = lstatSync(path);
  } catch {
    return "";
  }
  if (!stat.isSymbolicLink()) return "";
  let target = "";
  try {
    target = realpathSync(path);
  } catch {
    target = "\uFF08\u94FE\u63A5\u76EE\u6807\u4E0D\u5B58\u5728\uFF09";
  }
  const inside = target && !relative(profileDir, target).startsWith("..") && !isAbsolute(relative(profileDir, target));
  if (inside) return "";
  const declared = readJson(join2(profileDir, "package.json"), {})?.dependencies?.[name];
  if (declared) return "";
  return `Profile \u7684 node_modules/${name} \u662F\u6307\u5411 ${target} \u7684\u6B8B\u7559\u94FE\u63A5\uFF08\u901A\u5E38\u662F\u4E4B\u524D\u7528\u672C\u5730\u76EE\u5F55\u5B89\u88C5\u9057\u7559\uFF09\uFF0C\u81EA\u52A8\u5B89\u88C5\u4F1A\u5199\u5165\u8BE5\u76EE\u5F55\uFF0C\u5DF2\u505C\u6B62\u3002\u8BF7\u53EA\u5220\u9664\u8FD9\u4E2A\u94FE\u63A5\uFF08\u4E0D\u8981\u5220\u9664\u6E90\u7801\u76EE\u5F55\uFF09\u540E\u70B9\u51FB\u91CD\u8BD5\u3002`;
}
function createSync({ manager, home, stateDir, profileDir, preset = {}, fetcher = (...args) => fetch(...args), now = () => Date.now(), timers = { set: setTimeout, clear: clearTimeout }, startupDelayMs = 1e4, log = () => {
}, seed }) {
  const root = join2(home, "bkms-plugin-center");
  const configFile = join2(root, "config.json");
  const cacheDir = join2(root, "packages");
  const stateFile = join2(stateDir, "sync-state.json");
  const policyFile = join2(stateDir, "policy.json");
  let state = { revision: null, lastCheck: null, lastError: "", plugins: {}, history: [], ...readJson(stateFile, {}) };
  let policy = null, etag = null, policyCenter = null, policySource = null;
  let seedPolicy = null, seedError = "", seeded = false;
  let running = null, timer, nextCheckAt = null, disposed = false, backoff = 0, conflict = "";
  let rows = [];
  const progress = /* @__PURE__ */ new Map(), requests = /* @__PURE__ */ new Map();
  let queue = Promise.resolve();
  const exclusive = (fn) => {
    const next = queue.then(fn, fn);
    queue = next.catch(() => {
    });
    return next;
  };
  const setProgress = (name, patch) => progress.set(name, { ...progress.get(name), ...patch, at: now() });
  const notices = [];
  let noticeSeq = 0;
  function config() {
    const saved = readJson(configFile, {});
    const savedAddress = typeof saved.address === "string" && saved.address ? saved.address : null;
    let address = defaultCenter, source = "default";
    try {
      if (savedAddress) {
        address = centerAddress(savedAddress);
        source = "saved";
      } else if (preset.center) {
        address = centerAddress(preset.center);
        source = "profile";
      }
    } catch {
    }
    const autoSync = typeof saved.autoSync === "boolean" ? saved.autoSync : preset.autoSync !== false;
    return { address, source, autoSync };
  }
  const save = () => writeJson(stateFile, state);
  const record = (name) => state.plugins[name] ??= { failures: 0, lastError: "", lastAttempt: null, managed: false, pausedRevision: null };
  function remember(entry) {
    state.history = [{ at: new Date(now()).toISOString(), ...entry }, ...state.history].slice(0, HISTORY);
  }
  async function fetchPolicy(address) {
    const url = new URL("distribution-v2.json", address).href;
    if (policyCenter !== address) {
      policy = null;
      etag = null;
    }
    const response = await fetcher(url, { signal: AbortSignal.timeout(15e3), headers: etag && policy ? { "if-none-match": etag } : {} });
    if (response.status === 304 && policy) return policy;
    if (!response.ok) throw new Error(`\u7B56\u7565\u8BFB\u53D6\u5931\u8D25\uFF08HTTP ${response.status}\uFF09\uFF0C\u8BF7\u68C0\u67E5\u4E2D\u5FC3\u5730\u5740\u6216\u670D\u52A1\u7248\u672C`);
    let body;
    try {
      body = await response.json();
    } catch {
      throw new Error("\u4E2D\u5FC3\u8FD4\u56DE\u7684\u7B56\u7565\u4E0D\u662F\u6709\u6548 JSON");
    }
    policy = parseDistribution(body);
    etag = response.headers.get("etag");
    policyCenter = address;
    try {
      writeJson(policyFile, { center: address, policy });
    } catch {
    }
    return policy;
  }
  function loadSeed() {
    if (seeded || !seed) return;
    seeded = true;
    try {
      const rulesFile = join2(seed, "distribution-v2.json");
      if (existsSync2(rulesFile)) seedPolicy = parseDistribution(JSON.parse(readFileSync2(rulesFile, "utf8")));
      const packagesDir = join2(seed, "packages");
      if (existsSync2(packagesDir)) {
        mkdirSync2(cacheDir, { recursive: true });
        for (const file of readdirSync(packagesDir).filter((name) => name.endsWith(".tgz"))) {
          const bytes = readFileSync2(join2(packagesDir, file));
          const target = join2(cacheDir, createHash2("sha256").update(bytes).digest("hex") + ".tgz");
          if (!existsSync2(target)) copyFileSync(join2(packagesDir, file), target);
        }
      }
    } catch (error) {
      seedError = `\u79BB\u7EBF\u79CD\u5B50\u4E0D\u53EF\u7528\uFF1A${messageOf(error)}`;
      log("warn", seedError);
    }
  }
  function fallbackPolicy(address) {
    if (policy && policyCenter === address) return { policy, source: "cache" };
    const cached = readJson(policyFile, null);
    if (cached?.policy && cached.center === address) {
      try {
        return { policy: parseDistribution(cached.policy), source: "cache" };
      } catch {
      }
    }
    return seedPolicy ? { policy: seedPolicy, source: "seed" } : null;
  }
  function legacyConflict(bundles) {
    const market = bundles.find((b) => b.name === "bkms-market");
    if (!market?.enabled || !profileDir) return "";
    const managed = readJson(join2(profileDir, ".bkms-market", "managed.json"), null);
    return managed?.enabled ? "bkms-market \u7684\u81EA\u52A8\u540C\u6B65\u4ECD\u5F00\u542F\uFF0C\u8BF7\u5728 bkms-market \u4E2D\u6682\u505C\u81EA\u52A8\u540C\u6B65\u6216\u505C\u7528 bkms-market\uFF0C\u907F\u514D\u4E24\u5904\u540C\u65F6\u4FEE\u6539\u63D2\u4EF6" : "";
  }
  function addNotice(kind, item) {
    const last = notices.at(-1);
    if (last && last.kind === kind && last.batch === noticeSeq) {
      last.items.push(item);
      last.at = now();
      return;
    }
    notices.push({ id: `${kind}-${now()}-${notices.length}`, kind, at: now(), batch: noticeSeq, items: [item] });
    if (notices.length > 20) notices.shift();
  }
  async function execute(rule, plan, bundle, source = "auto") {
    const name = rule.packageName, entry = record(name);
    entry.lastAttempt = new Date(now()).toISOString();
    const requestId = randomUUID();
    setProgress(name, { phase: "downloading", received: 0, total: rule.artifact?.size ?? 0, detail: "", source, action: plan.action, version: rule.version, error: "" });
    try {
      const problem = staleLinkProblem(profileDir, name);
      if (problem) throw new Error(problem);
      const prepared = await prepareArtifact(rule.artifact, name, cacheDir, (received, total) => setProgress(name, { received, total }));
      setProgress(name, { phase: "installing", detail: "" });
      requests.set(requestId, name);
      const result = await manager().installBundle(prepared.spec, { requestId, enabled: plan.action === "install" ? true : bundle?.enabled !== false });
      if (!result || result.application === "failed" || result.application === "cancelled") throw new Error(failureOf(result));
      const after = (await manager().listBundles()).find((b) => b.name === rule.packageName);
      if (after?.version !== rule.version) throw new Error(`\u5B89\u88C5\u540E\u7248\u672C\u4E3A ${after?.version ?? "\u672A\u77E5"}\uFF0C\u4E0E\u76EE\u6807 ${rule.version} \u4E0D\u7B26`);
      const effect = effectOf(rule, result.application);
      Object.assign(entry, { failures: 0, lastError: "", managed: entry.managed || plan.action === "install", pausedRevision: null, version: rule.version });
      remember({ packageName: rule.packageName, name: rule.name, action: plan.action, from: bundle?.version ?? null, to: rule.version, ok: true, effect, source });
      setProgress(name, { phase: "done", effect, detail: "" });
      const row = rows.find((r) => r.packageName === name);
      if (row) Object.assign(row, { installed: rule.version, state: "done", failures: 0, lastError: "" });
      if (effect !== "none") addNotice(effect, { packageName: rule.packageName, name: rule.name || rule.packageName, version: rule.version, note: rule.restart?.note ?? "" });
      log("info", `${plan.action} ${rule.packageName}@${rule.version} \u2192 ${effect}`);
    } catch (error) {
      const message = messageOf(error);
      entry.failures += 1;
      entry.lastError = message;
      if (entry.failures >= (rule.retry?.maxFailures ?? 3)) entry.pausedRevision = state.revision;
      remember({ packageName: rule.packageName, name: rule.name, action: plan.action, from: bundle?.version ?? null, to: rule.version, ok: false, error: message, source });
      setProgress(name, { phase: "failed", error: message, detail: "" });
      log("warn", `${plan.action} ${rule.packageName}@${rule.version} failed: ${message}`);
    } finally {
      requests.delete(requestId);
    }
    save();
  }
  async function check(trigger) {
    const { address } = config();
    noticeSeq += 1;
    loadSeed();
    let current, centerError = "";
    try {
      current = await fetchPolicy(address);
      policySource = "center";
      backoff = 0;
    } catch (error) {
      centerError = messageOf(error);
      backoff += 1;
      const fallback = fallbackPolicy(address);
      if (!fallback) {
        state.lastError = centerError;
        state.lastCheck = new Date(now()).toISOString();
        save();
        return;
      }
      current = fallback.policy;
      policySource = fallback.source;
      log("warn", `center unavailable (${centerError}); using ${fallback.source} rules`);
    }
    const bundles = await manager().listBundles();
    conflict = legacyConflict(bundles);
    if (state.revision !== current.revision) {
      for (const entry of Object.values(state.plugins)) if (entry.pausedRevision !== null) {
        entry.pausedRevision = null;
        entry.failures = 0;
      }
      state.revision = current.revision;
    }
    const nextRows = [], work = [];
    for (const rule of current.rules) {
      if (!validRule(rule) || protectedName(rule.packageName)) continue;
      const bundle = bundles.find((b) => b.name === rule.packageName);
      const entry = state.plugins[rule.packageName];
      const plan = planRule(rule, bundle, entry);
      const row = { packageName: rule.packageName, name: rule.name || rule.packageName, target: rule.version, installed: bundle?.installed ? bundle.version ?? null : null, enabled: !!bundle?.enabled, installMode: rule.installMode, autoUpgrade: !!rule.autoUpgrade, restart: rule.restart?.mode ?? "auto", state: plan.state, message: plan.message ?? "", failures: entry?.failures ?? 0, lastError: entry?.lastError ?? "" };
      nextRows.push(row);
      if (plan.action === "none") continue;
      const sync = rule.sync ?? { startup: true, periodic: true };
      if (trigger === "startup" && !sync.startup) {
        row.state = "scheduled";
        continue;
      }
      if (trigger === "periodic" && !sync.periodic) {
        row.state = "scheduled";
        continue;
      }
      if (entry?.pausedRevision !== null && entry?.pausedRevision !== void 0) {
        row.state = "paused";
        row.message = `\u8FDE\u7EED\u5931\u8D25 ${entry.failures} \u6B21\uFF0C\u5DF2\u6682\u505C`;
        continue;
      }
      const delay = (rule.retry?.delaySeconds ?? 300) * 1e3;
      if (entry?.failures && entry.lastAttempt && now() - Date.parse(entry.lastAttempt) < delay && trigger !== "manual") {
        row.state = "waiting-retry";
        continue;
      }
      if (conflict) {
        row.state = "conflict";
        row.message = conflict;
        continue;
      }
      row.state = "queued";
      setProgress(rule.packageName, { phase: "queued", received: 0, total: rule.artifact?.size ?? 0, detail: "", source: "auto", action: plan.action, version: rule.version, error: "" });
      work.push({ rule, plan, bundle, row });
    }
    work.sort((a, b) => Number(a.rule.packageName === SELF) - Number(b.rule.packageName === SELF));
    rows = nextRows;
    for (const item of work) {
      if (disposed) break;
      item.row.state = "running";
      await exclusive(() => execute(item.rule, item.plan, item.bundle));
      const entry = state.plugins[item.rule.packageName];
      item.row.state = entry.failures ? entry.pausedRevision !== null ? "paused" : "failed" : "done";
      item.row.failures = entry.failures;
      item.row.lastError = entry.lastError;
      if (!entry.failures) item.row.installed = item.rule.version;
    }
    state.lastError = centerError ? `${centerError}\uFF08\u5DF2\u6309${policySource === "seed" ? "\u79BB\u7EBF\u79CD\u5B50" : "\u4E0A\u6B21\u7684\u4E2D\u5FC3\u89C4\u5219"}\u7EE7\u7EED\uFF09` : "";
    state.lastCheck = new Date(now()).toISOString();
    save();
  }
  function run(trigger) {
    if (running) return running;
    running = check(trigger).catch((error) => {
      state.lastError = messageOf(error);
      save();
    }).finally(() => {
      running = null;
    });
    return running;
  }
  function intervalMs() {
    const minutes = (policy?.rules ?? []).filter((r) => r?.sync?.periodic !== false && Number.isInteger(r?.sync?.intervalMinutes)).map((r) => r.sync.intervalMinutes);
    const base = (minutes.length ? Math.max(1, Math.min(...minutes)) : 5) * 6e4;
    return Math.min(base * 2 ** Math.min(backoff, 4), 36e5) + Math.floor(Math.random() * 15e3);
  }
  function schedule(delay, trigger) {
    if (timer) timers.clear(timer);
    timer = void 0;
    nextCheckAt = null;
    if (disposed || !config().autoSync) return;
    nextCheckAt = now() + delay;
    timer = timers.set(async () => {
      timer = void 0;
      await run(trigger);
      schedule(intervalMs(), "periodic");
    }, delay);
    timer?.unref?.();
  }
  return {
    start() {
      disposed = false;
      schedule(startupDelayMs, "startup");
    },
    stop() {
      disposed = true;
      if (timer) timers.clear(timer);
      timer = void 0;
      nextCheckAt = null;
    },
    /** 用户手动检查：处理全部规则，忽略重试间隔。 */
    async checkNow() {
      await run("manual");
      schedule(intervalMs(), "periodic");
      return this.status();
    },
    /**
     * 用户在 BKMS 插件页点击安装 / 更新：按中心目录的发布包直接在后台安装，立即返回，进度从 status 读取。
     * @param {string} identity 目录条目的 url
     */
    async install(identity) {
      const { plugins } = await readCatalog(config().address);
      const entry = plugins.find((p) => p.url === identity);
      const artifact = entry?.artifact;
      if (!artifact || !entry.packageName) throw new Error("\u8BE5\u63D2\u4EF6\u5C1A\u672A\u4E0A\u4F20\u5E76\u53D1\u5E03 .tgz \u5305");
      if (protectedName(entry.packageName)) throw new Error("\u5E02\u573A\u548C DSH \u57FA\u7840\u5305\u4E0D\u80FD\u5728\u8FD9\u91CC\u5B89\u88C5");
      const active = progress.get(entry.packageName);
      if (active && !["done", "failed"].includes(active.phase)) return this.status();
      const bundle = (await manager().listBundles()).find((b) => b.name === entry.packageName);
      if (bundle?.installed && compareVersions(artifact.version, bundle.version) === 0) throw new Error("\u5DF2\u5B89\u88C5\u6B64\u7248\u672C");
      const rule = { packageName: entry.packageName, name: entry.name, version: artifact.version, artifact, restart: artifact.restart, installMode: "manual" };
      const plan = { action: bundle?.installed ? "upgrade" : "install" };
      Object.assign(record(entry.packageName), { failures: 0, pausedRevision: null, lastError: "" });
      noticeSeq += 1;
      setProgress(entry.packageName, { phase: "queued", received: 0, total: artifact.size, detail: "", source: "manual", action: plan.action, version: artifact.version, error: "" });
      void exclusive(() => execute(rule, plan, bundle, "manual"));
      return this.status();
    },
    /** 官方安装器的日志事件：在卡片上显示 pnpm 的最新一行输出。 */
    installLog(chunk) {
      const name = requests.get(chunk?.requestId);
      if (!name) return;
      const line = String(chunk.text ?? "").replace(/\u001b\[[0-9;]*[A-Za-z]/g, "").split(/\r?\n|\r/).map((l) => l.trim()).filter(Boolean).at(-1);
      if (line) setProgress(name, { detail: line.length > 160 ? line.slice(0, 160) + "\u2026" : line });
    },
    /** 官方安装器的阶段事件：pnpm 完成后进入 applying（写入 Profile 并启用）。 */
    installState(event) {
      const name = requests.get(event?.requestId);
      if (name && event.phase === "applying") setProgress(name, { phase: "applying" });
    },
    retry(name) {
      const entry = state.plugins[name];
      if (entry) {
        entry.failures = 0;
        entry.pausedRevision = null;
        entry.lastError = "";
        save();
      }
      return this.checkNow();
    },
    getConfig: config,
    setConfig(input) {
      const saved = readJson(configFile, {});
      if (input.address !== void 0) saved.address = input.address === null || input.address === "" ? void 0 : centerAddress(String(input.address));
      if (input.autoSync !== void 0) {
        if (typeof input.autoSync !== "boolean") throw new Error("\u81EA\u52A8\u66F4\u65B0\u5F00\u5173\u5FC5\u987B\u662F\u5E03\u5C14\u503C");
        saved.autoSync = input.autoSync;
      }
      writeJson(configFile, saved);
      schedule(startupDelayMs, "manual");
      return config();
    },
    /** since：页面加载时间，早于该时间的刷新提示已因页面重新加载而失效。 */
    status(since = 0) {
      const { address, source, autoSync } = config();
      return {
        available: true,
        autoSync,
        center: address,
        centerSource: source,
        running: !!running,
        nextCheckAt,
        lastCheck: state.lastCheck,
        lastError: state.lastError,
        revision: state.revision,
        conflict,
        policySource,
        seed: seed ? { loaded: !!seedPolicy, error: seedError } : null,
        plugins: rows,
        history: state.history,
        // 进行中的安装始终返回；完成的保留 20 秒用于显示结果，失败的保留到下次尝试。
        progress: Object.fromEntries([...progress].filter(([, p]) => p.phase !== "done" || now() - p.at < 2e4)),
        notices: notices.filter((n) => n.kind === "restart" || n.at > since).map(({ batch, ...n }) => n)
      };
    }
  };
}

// src/index.ts
var unavailable = { available: false, reason: "\u5F53\u524D DSH \u672A\u63D0\u4F9B\u63D2\u4EF6\u7BA1\u7406\u670D\u52A1\uFF0C\u65E0\u6CD5\u81EA\u52A8\u66F4\u65B0" };
function apply(ctx, config = {}) {
  const homeOf = () => ctx.get("profileContext")?.home || process.env.DSH_HOME || join3(homedir(), ".dsh");
  let sync;
  ctx.inject(["pluginManager"], (managed) => {
    const profile = ctx.get("profileContext");
    const instance = createSync({
      manager: () => managed.pluginManager,
      home: homeOf(),
      stateDir: profile?.dir ? join3(profile.dir, ".bkms-plugin-center") : join3(homeOf(), "bkms-plugin-center"),
      profileDir: profile?.dir,
      preset: { center: config.center, autoSync: config.autoSync },
      log: (level, message) => managed.logger?.[level]?.(message),
      seed: config.seed?.trim() || process.env.BKMS_PLUGIN_CENTER_SEED?.trim() || void 0
    });
    managed.on("plugin-manager/install-log", (chunk) => instance.installLog(chunk));
    managed.on("plugin-manager/install-state", (event) => instance.installState(event));
    managed.effect(() => {
      sync = instance;
      instance.start();
      return () => {
        instance.stop();
        if (sync === instance) sync = void 0;
      };
    }, "bkms-plugin-center: auto sync");
  });
  ctx.inject(["webServer"], (host) => {
    const register = (path, methods) => host.effect(() => host.webServer.register({ kind: "exact", path, handler: async (req, res) => {
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.setHeader("cache-control", "no-store");
      const operation = methods[req.method];
      if (!operation) {
        res.writeHead(405);
        res.end(JSON.stringify({ error: `\u53EA\u652F\u6301 ${Object.keys(methods).join(" / ")} \u8BF7\u6C42` }));
        return;
      }
      try {
        let body = {};
        if (req.method === "POST") {
          if (!String(req.headers["content-type"] ?? "").toLowerCase().startsWith("application/json")) {
            res.writeHead(415);
            res.end(JSON.stringify({ error: "\u8BF7\u6C42\u5FC5\u987B\u662F JSON" }));
            return;
          }
          const chunks = [];
          let size = 0;
          for await (const chunk of req) {
            size += chunk.length;
            if (size > 65536) throw new Error("\u8BF7\u6C42\u5185\u5BB9\u8FC7\u5927");
            chunks.push(Buffer.from(chunk));
          }
          const text = Buffer.concat(chunks).toString("utf8").trim();
          body = text ? JSON.parse(text) : {};
        }
        res.end(JSON.stringify(await operation(new URL(req.url, "http://localhost"), body)));
      } catch (error) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
      }
    } }));
    const center = (url) => url.searchParams.get("center") || sync?.getConfig().address;
    const required = () => {
      if (!sync) throw new Error(unavailable.reason);
      return sync;
    };
    register("/api/bkms-plugin-center/catalog", { GET: (url) => readCatalog(center(url)) });
    register("/api/bkms-plugin-center/config", { GET: () => sync?.getConfig() ?? unavailable, POST: (_url, body) => required().setConfig(body) });
    register("/api/bkms-plugin-center/sync", { GET: (url) => sync?.status(Number(url.searchParams.get("since")) || 0) ?? unavailable });
    register("/api/bkms-plugin-center/sync/check", { POST: () => required().checkNow() });
    register("/api/bkms-plugin-center/sync/install", { POST: (_url, body) => required().install(String(body.plugin ?? "")) });
    register("/api/bkms-plugin-center/sync/retry", { POST: (_url, body) => required().retry(String(body.name ?? "")) });
  });
}
export {
  apply
};
