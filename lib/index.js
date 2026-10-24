import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
//#region src/service.mjs
const defaultCenter = "https://118.145.114.8/plugin-center/plugins.json";
function centerAddress(value) {
	const url = new URL(value || "https://118.145.114.8/plugin-center/plugins.json");
	if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("请填写 HTTP 或 HTTPS 中心地址");
	if (!url.pathname.endsWith("/plugins.json")) url.pathname = url.pathname.replace(/\/$/, "") + "/plugins.json";
	url.search = "";
	url.hash = "";
	return url.href;
}
async function readCatalog(value) {
	const center = centerAddress(value);
	const response = await fetch(center, { signal: AbortSignal.timeout(15e3) });
	if (!response.ok) throw new Error(`中心读取失败（HTTP ${response.status}），请检查地址后重试`);
	const catalog = await response.json();
	if (!Array.isArray(catalog.plugins)) throw new Error("中心返回的目录不完整");
	return {
		center,
		plugins: catalog.plugins
	};
}
/** 校验第二版分发策略的外层结构；单条规则由同步引擎逐条校验。 */
function parseDistribution(result) {
	if (result?.schemaVersion !== 2 || !Array.isArray(result.rules) || !Number.isSafeInteger(result.revision) || result.revision < 0) throw new Error("中心返回的策略格式不受支持");
	return {
		schemaVersion: result.schemaVersion,
		revision: result.revision,
		rules: result.rules
	};
}
function packageManifest(bytes) {
	const tar = gunzipSync(bytes, { maxOutputLength: 256 * 1024 * 1024 });
	for (let offset = 0; offset + 512 <= tar.length;) {
		const header = tar.subarray(offset, offset + 512);
		if (header.every((v) => v === 0)) break;
		const text = (a, b) => header.subarray(a, b).toString().replace(/\0.*$/s, "");
		const size = parseInt(text(124, 136).trim() || "0", 8);
		if (!Number.isSafeInteger(size) || size < 0 || offset + 512 + size > tar.length) throw new Error("包结构损坏");
		if (text(0, 100) === "package/package.json") return JSON.parse(tar.subarray(offset + 512, offset + 512 + size).toString());
		offset += 512 + Math.ceil(size / 512) * 512;
	}
}
/**
* 下载（或复用缓存）发布包，校验大小、SHA256、包名、版本与完整清单后返回 file: 安装来源。
* 缓存文件名为 SHA256.tgz，只有校验通过的内容才会写入。onProgress(已下载字节, 总字节) 在下载过程中调用。
*/
async function prepareArtifact(artifact, packageName, directory, onProgress = () => {}) {
	if (!artifact || !/^[a-f0-9]{64}$/.test(artifact.sha256) || !Number.isSafeInteger(artifact.size) || artifact.size < 1 || artifact.size > 64 * 1024 * 1024) throw new Error("请先在中心上传固定版本包并上架");
	const file = join(directory, artifact.sha256 + ".tgz");
	let bytes;
	if (existsSync(file)) bytes = readFileSync(file);
	else {
		const url = new URL(artifact.url);
		if (!["http:", "https:"].includes(url.protocol)) throw new Error("发布包地址必须是 HTTP 或 HTTPS");
		const response = await fetch(url, { signal: AbortSignal.timeout(12e4) });
		if (!response.ok || !response.body) throw new Error(`下载失败（HTTP ${response.status}）`);
		const chunks = [];
		let size = 0;
		for await (const chunk of response.body) {
			size += chunk.length;
			if (size > artifact.size) throw new Error("下载大小超过发布记录");
			chunks.push(Buffer.from(chunk));
			onProgress(size, artifact.size);
		}
		bytes = Buffer.concat(chunks);
	}
	if (bytes.length !== artifact.size || createHash("sha256").update(bytes).digest("hex") !== artifact.sha256) throw new Error("包校验失败，未交给安装器");
	const manifest = packageManifest(bytes);
	if (!manifest || manifest.name !== packageName || manifest.version !== artifact.version || JSON.stringify(manifest) !== JSON.stringify(artifact.manifest)) throw new Error("包清单与发布记录不符");
	mkdirSync(directory, { recursive: true });
	if (!existsSync(file)) writeFileSync(file, bytes, { flag: "wx" });
	return {
		spec: "file:" + file.replaceAll("\\", "/"),
		name: manifest.name,
		version: manifest.version
	};
}
//#endregion
//#region src/sync.mjs
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
*/
const SELF = "@bkms/plugin-center";
const protectedName = (name) => [
	"bkms-market",
	"dshmarket",
	"dsh-market"
].includes(name) || name.startsWith("@deepseek-ai/");
const packageName = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;
const HISTORY = 30;
/** 比较语义版本；预发布版本低于同号正式版本。无法解析时返回 null。 */
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
/** 生效动作：官方要求重启时总是重启；auto 在官方已热加载时刷新界面；插件中心自身总是重启。 */
function effectOf(rule, application) {
	if (application === "restart-required" || rule.packageName === "@bkms/plugin-center") return "restart";
	const mode = rule.restart?.mode === "required" ? "restart" : rule.restart?.mode;
	if (mode === "none" || mode === "reload" || mode === "restart") return mode;
	return "reload";
}
/** 计算一条规则对本机的动作，不执行任何修改。 */
function planRule(rule, bundle, record) {
	if (rule.forceRemove) return {
		action: "none",
		state: "unsupported",
		message: "明确卸载暂未在客户端执行"
	};
	const installed = bundle?.installed === true;
	if (bundle && !installed) return {
		action: "none",
		state: "builtin",
		message: "由 DSH 安装包提供，不自动修改"
	};
	if (!installed) {
		if (rule.installMode === "manual") return {
			action: "none",
			state: "manual",
			message: "手工管理，未安装"
		};
		if (rule.installMode === "automatic" && record?.managed) return {
			action: "none",
			state: "user-removed",
			message: "用户已卸载，自动维护不再补装"
		};
		return {
			action: "install",
			state: "install"
		};
	}
	const order = compareVersions(rule.version, bundle.version);
	if (order === null) return {
		action: "none",
		state: "unknown-version",
		message: `无法比较版本 ${bundle.version ?? "未知"} 与 ${rule.version}`
	};
	if (order > 0 && rule.autoUpgrade) return {
		action: "upgrade",
		state: "upgrade"
	};
	if (order > 0) return {
		action: "none",
		state: "outdated",
		message: "规则未开启自动升级"
	};
	return {
		action: "none",
		state: "current"
	};
}
function validRule(rule) {
	return rule && typeof rule === "object" && typeof rule.packageName === "string" && packageName.test(rule.packageName) && typeof rule.version === "string" && rule.artifact && typeof rule.artifact === "object" && rule.artifact.version === rule.version && [
		"manual",
		"automatic",
		"required"
	].includes(rule.installMode);
}
function readJson(file, fallback) {
	try {
		return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : fallback;
	} catch {
		return fallback;
	}
}
function writeJson(file, value) {
	mkdirSync(dirname(file), { recursive: true });
	writeFileSync(file + ".tmp", JSON.stringify(value, null, 2));
	renameSync(file + ".tmp", file);
}
const messageOf = (error) => error instanceof Error ? error.message : String(error);
/** 官方结果中的可读失败原因：优先取 pnpm 的错误行，完整输出不重复堆叠。 */
function failureOf(result) {
	if (result?.pendingBuilds?.length) return `需要批准安装脚本：${result.pendingBuilds.join(", ")}，请在 DSH 官方“插件”页手工安装一次并批准`;
	const lines = [result?.error?.diagnostic, result?.packageResult?.output].filter(Boolean).join("\n").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
	const key = lines.find((line) => /ERR_PNPM_|^Error\b|EPERM|EACCES|ENOENT|ETIMEDOUT/.test(line)) ?? lines.at(-1);
	const reason = [result?.error?.code, key].filter(Boolean).join("：") || "安装失败";
	return reason.length > 400 ? reason.slice(0, 400) + "…" : reason;
}
/**
* Profile 中同名目录是指向 Profile 外的链接、且未作为依赖声明时（常见于之前用本地目录开发安装后遗留），
* pnpm 会顺着链接写入源码目录并失败。返回提示文字；无问题时返回空字符串。
*/
function staleLinkProblem(profileDir, name) {
	if (!profileDir) return "";
	const path = join(profileDir, "node_modules", ...name.split("/"));
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
		target = "（链接目标不存在）";
	}
	if (target && !relative(profileDir, target).startsWith("..") && !isAbsolute(relative(profileDir, target))) return "";
	if (readJson(join(profileDir, "package.json"), {})?.dependencies?.[name]) return "";
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
*/
function createSync({ manager, home, stateDir, profileDir, preset = {}, fetcher = (...args) => fetch(...args), now = () => Date.now(), timers = {
	set: setTimeout,
	clear: clearTimeout
}, startupDelayMs = 1e4, log = () => {} }) {
	const root = join(home, "bkms-plugin-center");
	const configFile = join(root, "config.json");
	const cacheDir = join(root, "packages");
	const stateFile = join(stateDir, "sync-state.json");
	let state = {
		revision: null,
		lastCheck: null,
		lastError: "",
		plugins: {},
		history: [],
		...readJson(stateFile, {})
	};
	let policy = null, etag = null, policyCenter = null;
	let running = null, timer, nextCheckAt = null, disposed = false, backoff = 0, conflict = "";
	let rows = [];
	const progress = /* @__PURE__ */ new Map(), requests = /* @__PURE__ */ new Map();
	let queue = Promise.resolve();
	const exclusive = (fn) => {
		const next = queue.then(fn, fn);
		queue = next.catch(() => {});
		return next;
	};
	const setProgress = (name, patch) => progress.set(name, {
		...progress.get(name),
		...patch,
		at: now()
	});
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
		} catch {}
		const autoSync = typeof saved.autoSync === "boolean" ? saved.autoSync : preset.autoSync !== false;
		return {
			address,
			source,
			autoSync
		};
	}
	const save = () => writeJson(stateFile, state);
	const record = (name) => state.plugins[name] ??= {
		failures: 0,
		lastError: "",
		lastAttempt: null,
		managed: false,
		pausedRevision: null
	};
	function remember(entry) {
		state.history = [{
			at: new Date(now()).toISOString(),
			...entry
		}, ...state.history].slice(0, HISTORY);
	}
	async function fetchPolicy(address) {
		const url = new URL("distribution-v2.json", address).href;
		if (policyCenter !== address) {
			policy = null;
			etag = null;
		}
		const response = await fetcher(url, {
			signal: AbortSignal.timeout(15e3),
			headers: etag && policy ? { "if-none-match": etag } : {}
		});
		if (response.status === 304 && policy) return policy;
		if (!response.ok) throw new Error(`策略读取失败（HTTP ${response.status}），请检查中心地址或服务版本`);
		let body;
		try {
			body = await response.json();
		} catch {
			throw new Error("中心返回的策略不是有效 JSON");
		}
		policy = parseDistribution(body);
		etag = response.headers.get("etag");
		policyCenter = address;
		return policy;
	}
	/** bkms-market 的旧自动同步仍开启时，两边会同时修改同一个 Profile，暂停执行。 */
	function legacyConflict(bundles) {
		if (!bundles.find((b) => b.name === "bkms-market")?.enabled || !profileDir) return "";
		return readJson(join(profileDir, ".bkms-market", "managed.json"), null)?.enabled ? "bkms-market 的自动同步仍开启，请在 bkms-market 中暂停自动同步或停用 bkms-market，避免两处同时修改插件" : "";
	}
	function addNotice(kind, item) {
		const last = notices.at(-1);
		if (last && last.kind === kind && last.batch === noticeSeq) {
			last.items.push(item);
			last.at = now();
			return;
		}
		notices.push({
			id: `${kind}-${now()}-${notices.length}`,
			kind,
			at: now(),
			batch: noticeSeq,
			items: [item]
		});
		if (notices.length > 20) notices.shift();
	}
	async function execute(rule, plan, bundle, source = "auto") {
		const name = rule.packageName, entry = record(name);
		entry.lastAttempt = new Date(now()).toISOString();
		const requestId = randomUUID();
		setProgress(name, {
			phase: "downloading",
			received: 0,
			total: rule.artifact?.size ?? 0,
			detail: "",
			source,
			action: plan.action,
			version: rule.version,
			error: ""
		});
		try {
			const problem = staleLinkProblem(profileDir, name);
			if (problem) throw new Error(problem);
			const prepared = await prepareArtifact(rule.artifact, name, cacheDir, (received, total) => setProgress(name, {
				received,
				total
			}));
			setProgress(name, {
				phase: "installing",
				detail: ""
			});
			requests.set(requestId, name);
			const result = await manager().installBundle(prepared.spec, {
				requestId,
				enabled: plan.action === "install" ? true : bundle?.enabled !== false
			});
			if (!result || result.application === "failed" || result.application === "cancelled") throw new Error(failureOf(result));
			const after = (await manager().listBundles()).find((b) => b.name === rule.packageName);
			if (after?.version !== rule.version) throw new Error(`安装后版本为 ${after?.version ?? "未知"}，与目标 ${rule.version} 不符`);
			const effect = effectOf(rule, result.application);
			Object.assign(entry, {
				failures: 0,
				lastError: "",
				managed: entry.managed || plan.action === "install",
				pausedRevision: null,
				version: rule.version
			});
			remember({
				packageName: rule.packageName,
				name: rule.name,
				action: plan.action,
				from: bundle?.version ?? null,
				to: rule.version,
				ok: true,
				effect,
				source
			});
			setProgress(name, {
				phase: "done",
				effect,
				detail: ""
			});
			const row = rows.find((r) => r.packageName === name);
			if (row) Object.assign(row, {
				installed: rule.version,
				state: "done",
				failures: 0,
				lastError: ""
			});
			if (effect !== "none") addNotice(effect, {
				packageName: rule.packageName,
				name: rule.name || rule.packageName,
				version: rule.version,
				note: rule.restart?.note ?? ""
			});
			log("info", `${plan.action} ${rule.packageName}@${rule.version} → ${effect}`);
		} catch (error) {
			const message = messageOf(error);
			entry.failures += 1;
			entry.lastError = message;
			if (entry.failures >= (rule.retry?.maxFailures ?? 3)) entry.pausedRevision = state.revision;
			remember({
				packageName: rule.packageName,
				name: rule.name,
				action: plan.action,
				from: bundle?.version ?? null,
				to: rule.version,
				ok: false,
				error: message,
				source
			});
			setProgress(name, {
				phase: "failed",
				error: message,
				detail: ""
			});
			log("warn", `${plan.action} ${rule.packageName}@${rule.version} failed: ${message}`);
		} finally {
			requests.delete(requestId);
		}
		save();
	}
	/**
	* 执行一轮检查。trigger：startup 只处理启用启动检查的规则，periodic 只处理启用定时检查的规则，manual 处理全部。
	*/
	async function check(trigger) {
		const { address } = config();
		noticeSeq += 1;
		let current;
		try {
			current = await fetchPolicy(address);
		} catch (error) {
			state.lastError = messageOf(error);
			state.lastCheck = new Date(now()).toISOString();
			save();
			backoff += 1;
			return;
		}
		backoff = 0;
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
			const row = {
				packageName: rule.packageName,
				name: rule.name || rule.packageName,
				target: rule.version,
				installed: bundle?.installed ? bundle.version ?? null : null,
				enabled: !!bundle?.enabled,
				installMode: rule.installMode,
				autoUpgrade: !!rule.autoUpgrade,
				restart: rule.restart?.mode ?? "auto",
				state: plan.state,
				message: plan.message ?? "",
				failures: entry?.failures ?? 0,
				lastError: entry?.lastError ?? ""
			};
			nextRows.push(row);
			if (plan.action === "none") continue;
			const sync = rule.sync ?? {
				startup: true,
				periodic: true
			};
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
				row.message = `连续失败 ${entry.failures} 次，已暂停`;
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
			setProgress(rule.packageName, {
				phase: "queued",
				received: 0,
				total: rule.artifact?.size ?? 0,
				detail: "",
				source: "auto",
				action: plan.action,
				version: rule.version,
				error: ""
			});
			work.push({
				rule,
				plan,
				bundle,
				row
			});
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
		state.lastError = "";
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
			if (!artifact || !entry.packageName) throw new Error("该插件尚未上传并发布 .tgz 包");
			if (protectedName(entry.packageName)) throw new Error("市场和 DSH 基础包不能在这里安装");
			const active = progress.get(entry.packageName);
			if (active && !["done", "failed"].includes(active.phase)) return this.status();
			const bundle = (await manager().listBundles()).find((b) => b.name === entry.packageName);
			if (bundle?.installed && compareVersions(artifact.version, bundle.version) === 0) throw new Error("已安装此版本");
			const rule = {
				packageName: entry.packageName,
				name: entry.name,
				version: artifact.version,
				artifact,
				restart: artifact.restart,
				installMode: "manual"
			};
			const plan = { action: bundle?.installed ? "upgrade" : "install" };
			Object.assign(record(entry.packageName), {
				failures: 0,
				pausedRevision: null,
				lastError: ""
			});
			noticeSeq += 1;
			setProgress(entry.packageName, {
				phase: "queued",
				received: 0,
				total: artifact.size,
				detail: "",
				source: "manual",
				action: plan.action,
				version: artifact.version,
				error: ""
			});
			exclusive(() => execute(rule, plan, bundle, "manual"));
			return this.status();
		},
		/** 官方安装器的日志事件：在卡片上显示 pnpm 的最新一行输出。 */
		installLog(chunk) {
			const name = requests.get(chunk?.requestId);
			if (!name) return;
			const line = String(chunk.text ?? "").replace(/\u001b\[[0-9;]*[A-Za-z]/g, "").split(/\r?\n|\r/).map((l) => l.trim()).filter(Boolean).at(-1);
			if (line) setProgress(name, { detail: line.length > 160 ? line.slice(0, 160) + "…" : line });
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
				if (typeof input.autoSync !== "boolean") throw new Error("自动更新开关必须是布尔值");
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
				plugins: rows,
				history: state.history,
				progress: Object.fromEntries([...progress].filter(([, p]) => p.phase !== "done" || now() - p.at < 2e4)),
				notices: notices.filter((n) => n.kind === "restart" || n.at > since).map(({ batch, ...n }) => n)
			};
		}
	};
}
//#endregion
//#region src/index.ts
const unavailable = {
	available: false,
	reason: "当前 DSH 未提供插件管理服务，无法自动更新"
};
function apply(ctx, config = {}) {
	const homeOf = () => ctx.get("profileContext")?.home || process.env.DSH_HOME || join(homedir(), ".dsh");
	let sync;
	ctx.inject(["pluginManager"], (managed) => {
		const profile = ctx.get("profileContext");
		const instance = createSync({
			manager: () => managed.pluginManager,
			home: homeOf(),
			stateDir: profile?.dir ? join(profile.dir, ".bkms-plugin-center") : join(homeOf(), "bkms-plugin-center"),
			profileDir: profile?.dir,
			preset: {
				center: config.center,
				autoSync: config.autoSync
			},
			log: (level, message) => managed.logger?.[level]?.(message)
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
		const register = (path, methods) => host.effect(() => host.webServer.register({
			kind: "exact",
			path,
			handler: async (req, res) => {
				res.setHeader("content-type", "application/json; charset=utf-8");
				res.setHeader("cache-control", "no-store");
				const operation = methods[req.method];
				if (!operation) {
					res.writeHead(405);
					res.end(JSON.stringify({ error: `只支持 ${Object.keys(methods).join(" / ")} 请求` }));
					return;
				}
				try {
					let body = {};
					if (req.method === "POST") {
						if (!String(req.headers["content-type"] ?? "").toLowerCase().startsWith("application/json")) {
							res.writeHead(415);
							res.end(JSON.stringify({ error: "请求必须是 JSON" }));
							return;
						}
						const chunks = [];
						let size = 0;
						for await (const chunk of req) {
							size += chunk.length;
							if (size > 65536) throw new Error("请求内容过大");
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
			}
		}));
		const center = (url) => url.searchParams.get("center") || sync?.getConfig().address;
		const required = () => {
			if (!sync) throw new Error(unavailable.reason);
			return sync;
		};
		register("/api/bkms-plugin-center/catalog", { GET: (url) => readCatalog(center(url)) });
		register("/api/bkms-plugin-center/config", {
			GET: () => sync?.getConfig() ?? unavailable,
			POST: (_url, body) => required().setConfig(body)
		});
		register("/api/bkms-plugin-center/sync", { GET: (url) => sync?.status(Number(url.searchParams.get("since")) || 0) ?? unavailable });
		register("/api/bkms-plugin-center/sync/check", { POST: () => required().checkNow() });
		register("/api/bkms-plugin-center/sync/install", { POST: (_url, body) => required().install(String(body.plugin ?? "")) });
		register("/api/bkms-plugin-center/sync/retry", { POST: (_url, body) => required().retry(String(body.name ?? "")) });
	});
}
//#endregion
export { apply };
