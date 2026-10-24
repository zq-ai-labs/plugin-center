window.__ModuleLoader__.load({
	id: "@bkms/plugin-center",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		let react_dom = require("react-dom");
		let _deepseek_ai_dsh_client_ui_slots = require("@deepseek-ai/dsh-client-ui-slots");
		let _deepseek_ai_dsh_client_store = require("@deepseek-ai/dsh-client-store");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/client/center-settings.ts
		const storageKey = "bkms-plugin-center.preferences";
		const oldAddressKey = "bkms-plugin-center.catalog-url";
		const fallback = "https://118.145.114.8/plugin-center/plugins.json";
		/** 刷新提示只针对本次页面加载之前完成的更新。 */
		const pageLoadedAt = Date.now();
		function normalizeCenterAddress(value) {
			const url = new URL(value.trim());
			if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("请填写 HTTP 或 HTTPS 中心地址");
			if (!url.pathname.endsWith("/plugins.json")) url.pathname = url.pathname.replace(/\/$/, "") + "/plugins.json";
			url.search = "";
			url.hash = "";
			return url.href;
		}
		/** 旧版本只在浏览器保存地址；首次连接宿主时迁移到宿主配置。 */
		function browserAddress() {
			try {
				const saved = JSON.parse(localStorage.getItem(storageKey) || "{}").address || localStorage.getItem(oldAddressKey);
				return saved ? normalizeCenterAddress(saved) : null;
			} catch {
				return null;
			}
		}
		function initial$1() {
			let value = {};
			try {
				value = JSON.parse(localStorage.getItem(storageKey) || "{}");
			} catch {}
			return {
				visible: value.visible !== false,
				address: browserAddress() ?? fallback,
				source: "browser",
				autoSync: true,
				hostReady: false,
				sync: null,
				syncBusy: false,
				syncError: ""
			};
		}
		let state = initial$1();
		const listeners = /* @__PURE__ */ new Set();
		const patch = (next) => {
			state = {
				...state,
				...next
			};
			listeners.forEach((fn) => fn());
		};
		function save(next) {
			const value = {
				...state,
				...next
			};
			localStorage.setItem(storageKey, JSON.stringify({
				visible: value.visible,
				address: value.address
			}));
			patch(next);
		}
		async function api(path, body) {
			const url = new URL("api/bkms-plugin-center/" + path, document.baseURI);
			const response = await fetch(url.pathname + url.search, body === void 0 ? { cache: "no-store" } : {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(body)
			});
			const text = await response.text();
			let result;
			try {
				result = JSON.parse(text);
			} catch {
				throw new Error("插件中心接口未加载，请更新插件并完全退出 DSH 后重启");
			}
			if (!response.ok) throw new Error(result.error || "请求失败");
			return result;
		}
		function applyConfig(config) {
			if (config?.available === false) return;
			patch({
				address: config.address,
				source: config.source,
				autoSync: config.autoSync,
				hostReady: true
			});
		}
		let started = false, pollTimer;
		/** 有安装进行中时每秒刷新进度，否则每 30 秒（窗口不可见时跳过）。 */
		function schedulePoll() {
			if (pollTimer) clearTimeout(pollTimer);
			const active = Object.values(state.sync?.progress ?? {}).some((p) => p.phase !== "done" && p.phase !== "failed");
			pollTimer = setTimeout(() => {
				if (active || document.visibilityState === "visible") centerSettings.refreshSync();
				else schedulePoll();
			}, active ? 1e3 : 3e4);
		}
		async function connect() {
			try {
				let config = await api("config");
				const local = browserAddress();
				if (config.available !== false && config.source !== "saved" && local && local !== config.address) config = await api("config", { address: local });
				applyConfig(config);
			} catch {}
			await centerSettings.refreshSync();
		}
		const centerSettings = {
			getSnapshot: () => state,
			subscribe: (fn) => {
				listeners.add(fn);
				if (!started) {
					started = true;
					connect();
					document.addEventListener("visibilitychange", () => {
						if (document.visibilityState === "visible") centerSettings.refreshSync();
					});
				}
				return () => {
					listeners.delete(fn);
				};
			},
			setVisible: (visible) => save({ visible }),
			async setAddress(address) {
				address = normalizeCenterAddress(address);
				if (state.hostReady) applyConfig(await api("config", { address }));
				save({ address });
				centerSettings.refreshSync();
			},
			async setAutoSync(autoSync) {
				applyConfig(await api("config", { autoSync }));
				await centerSettings.refreshSync();
			},
			async refreshSync() {
				try {
					patch({
						sync: await api("sync?since=" + pageLoadedAt),
						syncError: ""
					});
				} catch (error) {
					patch({ syncError: error instanceof Error ? error.message : String(error) });
				} finally {
					schedulePoll();
				}
			},
			/** 在后台直接安装或更新 BKMS 插件（目录条目 url），立即返回；进度从同步状态读取。失败时抛出原因。 */
			async installPlugin(url) {
				patch({ sync: await api("sync/install", { plugin: url }) });
				schedulePoll();
			},
			/** 执行一次后端同步动作（立即检查 / 重试），完成后更新状态。 */
			async syncAction(path, body = {}) {
				patch({
					syncBusy: true,
					syncError: ""
				});
				try {
					patch({ sync: await api(path, body) });
					await centerSettings.refreshSync();
				} catch (error) {
					patch({ syncError: error instanceof Error ? error.message : String(error) });
				} finally {
					patch({ syncBusy: false });
				}
			}
		};
		//#endregion
		//#region src/client/config-ledger.ts
		/**
		* The key a row's configuration registers under.
		* @param bundle - the bundle's package name.
		* @param rowId - the row id the bundle's patch declares.
		* @returns the `bkmsPlugins.row.config` key.
		*/
		function rowConfigKey(bundle, rowId) {
			return `${bundle}#${rowId}`;
		}
		const SLOTS = [
			"bkmsPlugins.item",
			"bkmsPlugins.bundle.config",
			"bkmsPlugins.row.config"
		];
		/**
		* Project the configuration ledgers as one observable the page binds.
		* @param ctx - the page plugin's context, whose slot registry and locale the projection follows.
		* @returns the ledger source; its snapshot changes only when a ledger or the locale does.
		*/
		function configLedgerSource(ctx) {
			let versions = [];
			let revision = -1;
			let ledger = {
				items: [],
				bundles: /* @__PURE__ */ new Set(),
				rows: /* @__PURE__ */ new Set()
			};
			const keysOf = (name) => new Set(ctx.slots.entries(name).flatMap((entry) => entry.options.key === void 0 ? [] : [entry.options.key]));
			return {
				getSnapshot: () => {
					const next = SLOTS.map((name) => ctx.slots.getVersion(name));
					const current = ctx.locale.getSnapshot().revision;
					if (current !== revision || next.some((version, index) => version !== versions[index])) {
						versions = next;
						revision = current;
						ledger = {
							items: ctx.slots.entries("bkmsPlugins.item").map((entry) => ({
								/* v8 ignore next -- list-slot registration requires id */
								id: entry.options.id ?? "",
								label: (0, _deepseek_ai_dsh_client_ui_slots.resolveSlotLabel)(entry.options.label) ?? ""
							})),
							bundles: keysOf("bkmsPlugins.bundle.config"),
							rows: keysOf("bkmsPlugins.row.config")
						};
					}
					return ledger;
				},
				subscribe: (listener) => {
					const offs = [...SLOTS.map((name) => ctx.slots.subscribe(name, listener)), ctx.locale.subscribe(listener)];
					return () => {
						for (const off of offs) off();
					};
				}
			};
		}
		//#endregion
		//#region ../../../deepseek-harness/packages/util/crypto/lib/index.js
		/**
		* Random v4 UUID, minted from `crypto.getRandomValues`.
		* @returns the UUID string.
		*/
		function randomUUID() {
			const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
			const hex = Array.from(bytes, (byte, index) => {
				return (index === 6 ? byte & 15 | 64 : index === 8 ? byte & 63 | 128 : byte).toString(16).padStart(2, "0");
			}).join("");
			return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
		}
		//#endregion
		//#region ../../../deepseek-harness/packages/boot/plugin-manager/lib/types/registry.js
		/** An http(s) URL, as pnpm's `--registry` takes it. */
		const REGISTRY_URL = /^https?:\/\/\S+$/;
		//#endregion
		//#region src/client/presentation.ts
		/** The registries with a name of their own, by host. */
		const REGISTRY_COPY = new Map([["registry.npmmirror.com", "registryNpmmirror"]]);
		/** npm's own registry, which pnpm names without any configuration. */
		const OFFICIAL_NPM_HOST = "registry.npmjs.org";
		/**
		* What a registry reads as: pnpm's own as the default registry, a known mirror by its name, any other registry by
		* its host; and the host each names, for where the name alone would leave it unsaid.
		* @param registry - the registry, null for the one pnpm's own configuration names.
		* @param t - the manager's translate seat.
		* @param resolved - the URL pnpm's own configuration names, null while unknown, when it reads as npm's own.
		* @returns the name and the host.
		*/
		function registryText(registry, t, resolved) {
			if (registry === null) return {
				name: t("registryDefault"),
				host: resolved === null ? OFFICIAL_NPM_HOST : registryHost(resolved)
			};
			const host = registryHost(registry);
			const key = REGISTRY_COPY.get(host);
			return {
				name: key === void 0 ? host : t(key),
				host
			};
		}
		/** The host of a registry URL; the URL as written when it does not parse. */
		function registryHost(registry) {
			try {
				return new URL(registry).host;
			} catch {
				return registry;
			}
		}
		/** The sentence each of the Host's refusal codes reads as. */
		const CODE_KEYS = {
			"management-required": "reasonManagementRequired",
			"unaddressable": "reasonUnaddressable",
			"unknown-plugin": "reasonUnknownPlugin",
			"invalid-spec": "reasonInvalidSpec",
			"ambiguous-install": "reasonAmbiguousInstall",
			"not-bundle": "reasonNotBundle",
			"not-removable": "reasonNotRemovable",
			"stop-profile": "reasonStopProfile",
			"bundle-in-use": "reasonBundleInUse",
			"stale-approval": "reasonStaleApproval",
			"incompatible-version": "reasonIncompatibleVersionUnnamed",
			"operation-error": "reasonOperationError"
		};
		/** The sentence a failed action opens with, by what was being done. */
		const FAILED_KEYS = {
			enable: "failedEnable",
			disable: "failedDisable",
			uninstall: "failedUninstall",
			rowEnable: "failedRowEnable",
			rowDisable: "failedRowDisable"
		};
		/**
		* What a management error reads as: the code's sentence, one sentence per
		* package an incompatibility names, or, for an operation error, the Host's diagnostic as it is.
		* @param error - the Host's code, its diagnostic, and the packages an incompatibility names.
		* @param t - the manager's translate seat.
		* @returns the sentence.
		*/
		function managementText(error, t) {
			if (error.code === "incompatible-version" && error.incompatible !== void 0 && error.incompatible.length > 0) return error.incompatible.map((plugin) => t("reasonIncompatibleVersion", {
				plugin: `${plugin.name}@${plugin.version}`,
				runtime: plugin.runtimeVersion,
				peers: Object.entries(plugin.peers).map(([name, range]) => `${name} ${range}`).join(", ")
			})).join(" ");
			if (error.code !== "operation-error") return t(CODE_KEYS[error.code]);
			return error.diagnostic === void 0 || error.diagnostic === "" ? t("reasonOperationError") : error.diagnostic;
		}
		/**
		* Compact a package name to what a person calls it.
		* @param name - the package name.
		* @returns the unscoped name without the harness prefixes.
		*/
		function shortName(name) {
			return (name.startsWith("@") ? name.slice(name.indexOf("/") + 1) : name).replace(/^dsh-(?:host-|client-)?/, "");
		}
		/**
		* Resolve installed package metadata without changing its technical identity.
		* @param pkg - package identity and local metadata.
		* @param resolveText - current-locale package text resolver.
		* @returns localized copy with a technical-name fallback and the independent beta status.
		*/
		function packageText(pkg, resolveText) {
			return {
				title: pkg.meta?.title === void 0 ? pkg.name : resolveText(pkg.meta.title),
				description: pkg.meta?.description === void 0 ? void 0 : resolveText(pkg.meta.description) || void 0,
				beta: pkg.name.startsWith("@deepseek-ai/dsh-experimental-")
			};
		}
		/**
		* Resolve a bundle row's plugin metadata, using its full module specifier as the final title fallback.
		* @param row - row identity and local metadata.
		* @param resolveText - current-locale package text resolver.
		* @returns the row's display title and optional description.
		*/
		function rowText(row, resolveText) {
			return {
				title: row.meta?.title === void 0 ? row.moduleName : resolveText(row.meta.title),
				description: row.meta?.description === void 0 ? void 0 : resolveText(row.meta.description) || void 0
			};
		}
		/**
		* The sentence one notice shows.
		* @param notice - the last action's outcome.
		* @param t - the manager's translate seat.
		* @returns the sentence.
		*/
		function noticeText(notice, t) {
			switch (notice.kind) {
				case "restart": return t("restartNotice");
				case "overridden": return t("overriddenNotice", { name: notice.packageName });
				case "cancelled": return t("installCancelled");
				case "install": return t({
					done: "installBackgroundDone",
					failed: "installBackgroundFailed",
					unconfirmed: "installBackgroundUnconfirmed",
					applying: "installBackgroundApplying",
					unknown: "installBackgroundUnknown"
				}[notice.outcome]);
				case "failed": {
					const reason = notice.code === void 0 ? notice.reason : managementText({
						code: notice.code,
						diagnostic: notice.reason,
						...notice.incompatible === void 0 ? {} : { incompatible: notice.incompatible }
					}, t);
					return t(FAILED_KEYS[notice.action], { reason: reason === "" ? t("reasonOperationError") : reason });
				}
			}
		}
		//#endregion
		//#region src/client/manager-store.ts
		/**
		* The plugin manager's state: the Host's bundles joined with its plugin
		* entries, the action in flight, the install run, and the confirmation an
		* uninstall waits on. Every fact comes from the Host — the store re-reads
		* after each action and after every `plugin-manager/changed` event, so a
		* change made on another surface shows here without a manual refresh.
		*/
		/** The choice shown until the Host has said which registry it asks first: the one pnpm's own configuration names. */
		const OFFICIAL_REGISTRY = {
			kind: "offered",
			registry: null
		};
		/**
		* The registries the dialog offers: the Host's first, its fallbacks, and pnpm's own, each once.
		* @param registries - what the Host configured, or null while unread.
		* @returns the registries in the order the dialog lists them.
		*/
		function offeredRegistries(registries) {
			const offered = [];
			for (const registry of [...registries === null ? [] : [registries.registry, ...registries.fallbackRegistries], null]) if (!offered.includes(registry)) offered.push(registry);
			return offered;
		}
		/**
		* Whether an installation is still owned by the Host.
		* @param phase - the dialog's current installation phase.
		* @returns true while a Host result or a check for an active request is outstanding.
		*/
		function isInstallPending(phase) {
			return phase === "starting" || phase === "running" || phase === "cancelling" || phase === "applying" || phase === "unconfirmed";
		}
		/**
		* Offer the configured mainland mirror after a confirmed GitHub connection failure.
		* @param install - the installation and the Host's failure attribution.
		* @returns the offered mirror URL, or undefined when this recovery does not apply.
		*/
		function githubRecoveryRegistry(install) {
			if (install.phase !== "failed" || install.failure?.failedAt !== "spec-host" || install.failure.kind !== "network" && install.failure.kind !== "timeout") return void 0;
			const host = install.subject?.host?.toLowerCase().split(":")[0];
			if (host !== "github.com" && !host?.endsWith(".github.com")) return void 0;
			return offeredRegistries(install.registries).find((registry) => registry !== null && new URL(registry).hostname === "registry.npmmirror.com");
		}
		/** A refused answer or a change the Host could not apply, carrying what it said and, for a refusal, its code. */
		var RemoteAnswerError = class extends Error {
			reason;
			code;
			incompatible;
			constructor(reason, code, incompatible) {
				super(reason);
				this.reason = reason;
				this.code = code;
				this.incompatible = incompatible;
				this.name = "RemoteAnswerError";
			}
		};
		/** The dialog's reading of a failed change: the Host's code and diagnostic, and the run's classified failure. */
		function failureOf(error, kind, pendingBuilds, failedAt) {
			return {
				reason: error?.diagnostic ?? "",
				...error === void 0 ? {} : { code: error.code },
				...error?.incompatible === void 0 ? {} : { incompatible: error.incompatible },
				...kind === void 0 ? {} : { kind },
				...failedAt === void 0 ? {} : { failedAt },
				...pendingBuilds === void 0 || pendingBuilds.length === 0 ? {} : { pendingBuilds }
			};
		}
		/** The notice a thrown failure becomes: a refusal keeps its code, anything else its words. */
		function failedNotice(error, subject, seq) {
			const code = error instanceof RemoteAnswerError ? error.code : void 0;
			const incompatible = error instanceof RemoteAnswerError ? error.incompatible : void 0;
			return {
				kind: "failed",
				reason: reasonOf(error),
				...code === void 0 ? {} : { code },
				...incompatible === void 0 ? {} : { incompatible },
				...subject,
				seq
			};
		}
		/** The runs with every one still open settled at `exitCode`. */
		function settledRuns(runs, exitCode) {
			return runs.map((run) => run.exitCode === void 0 ? {
				...run,
				exitCode
			} : run);
		}
		/**
		* The key one row occupies in the busy list.
		* @param entryId - the row's Loader entry id.
		* @returns the busy key.
		*/
		function rowKey(entryId) {
			return `row:${entryId}`;
		}
		/**
		* One bundle as the page shows it: its rows joined with the Host's entries.
		* @param bundle - the Host's bundle.
		* @param plugins - the Host's plugin entries.
		* @returns the package view.
		*/
		function packageView(bundle, plugins) {
			const rows = bundle.rows.map((row) => {
				const live = row.entryId === void 0 ? void 0 : plugins.find((plugin) => plugin.entryId === row.entryId);
				return {
					rowId: row.rowId,
					moduleName: row.moduleName,
					enabled: live?.enabled ?? false,
					phase: live?.fiberPhase ?? null,
					...row.meta === void 0 ? {} : { meta: row.meta },
					...row.entryId === void 0 ? {} : { entryId: row.entryId },
					...live?.readOnlyReason === void 0 ? {} : { readOnlyReason: live.readOnlyReason }
				};
			});
			return {
				name: bundle.name,
				installed: bundle.installed,
				optional: bundle.optional,
				enabled: bundle.enabled,
				rows,
				...bundle.version === void 0 ? {} : { version: bundle.version },
				...bundle.description === void 0 ? {} : { description: bundle.description },
				...bundle.meta === void 0 ? {} : { meta: bundle.meta },
				...bundle.readOnlyReason === void 0 ? {} : { readOnlyReason: bundle.readOnlyReason },
				...bundle.error === void 0 ? {} : { error: bundle.error }
			};
		}
		/**
		* The order the list shows packages in: by the short name a person reads, so a
		* card stays put when its bundle is switched, whatever order the Host answers in.
		* @param packages - the Host's bundles as views.
		* @returns the views sorted by short name.
		*/
		function sortPackages(packages) {
			return [...packages].sort((a, b) => shortName(a.name).localeCompare(shortName(b.name)));
		}
		const IDLE_INSTALL = {
			open: false,
			spec: "",
			registries: null,
			registry: OFFICIAL_REGISTRY,
			registryOpen: false,
			registryError: false,
			attempts: null,
			phase: "idle",
			inputError: null,
			subject: null,
			runs: [],
			detailsOpen: false,
			installed: null,
			restartRequired: false,
			failure: null,
			approvedBuilds: [],
			enabling: false
		};
		/** The dialog back at its spec: the run and its outcome forgotten, the spec and the registries kept. */
		function specAgain(install) {
			const { open, spec, registries, registry, mirrorRecovery } = install;
			return {
				...IDLE_INSTALL,
				open,
				spec,
				registries,
				registry,
				...mirrorRecovery === void 0 ? {} : { mirrorRecovery }
			};
		}
		/**
		* The choice as the dialog can show it once the Host has answered: nothing remembered starts from the registry the
		* Host asks first; a remembered registry the Host no longer offers is kept as a typed one.
		*/
		function reconciled(remembered, registries) {
			if (remembered === null) return {
				kind: "offered",
				registry: registries.registry
			};
			return remembered.kind === "offered" && remembered.registry !== null && !offeredRegistries(registries).includes(remembered.registry) ? {
				kind: "custom",
				url: remembered.registry
			} : remembered;
		}
		/** Reads and mutates the profile's plugins through the `pluginManager` Remote. */
		var PluginManagerController = class {
			ctx;
			store;
			inFlight;
			rerun = false;
			generation = 0;
			disposed = false;
			pendingConfirm;
			/** Cancels the check the dialog has in flight. */
			inspectAbort;
			request;
			noticeSeq = 0;
			registryRead;
			/** The registry last used from this browser, kept across dialogs and page loads; null until one was used. */
			registryMemory = (0, _deepseek_ai_dsh_client_store.createSnapshotStore)(null, { persist: { name: "bkms.plugin-center.install-registry" } });
			/**
			* @param ctx - the tab plugin's context, whose `remote.pluginManager` and `remote.pluginInventory` namespaces answer.
			*/
			constructor(ctx) {
				this.ctx = ctx;
				this.store = (0, _deepseek_ai_dsh_client_store.createSnapshotStore)({
					status: "idle",
					packages: [],
					busy: [],
					notice: null,
					install: IDLE_INSTALL,
					confirm: null,
					highlight: null
				});
			}
			/**
			* Read the tab's state.
			* @returns the current sync snapshot (stable reference until the next change).
			*/
			getSnapshot() {
				return this.store.getSnapshot();
			}
			/** Stop publishing and drop every late settlement. */
			dispose() {
				this.disposed = true;
				this.registryRead = void 0;
				this.request = void 0;
				this.generation += 1;
			}
			/**
			* Build the face the tab's slot registration injects.
			* @param configLedger - the projection of the plugins carrying configuration, bound beside the tab's own state.
			* @param resolveText - render-time package text resolution supplied by the locale service.
			* @returns the tab's snapshot sources and its actions.
			*/
			inject(configLedger, resolveText) {
				return {
					resolveText,
					hooks: {
						pluginManager: this.store,
						configLedger,
						configurations: this.ctx.configForms.describe()
					},
					configForm: (id) => this.ctx.configForms.get(id),
					ensure: () => {
						if (this.getSnapshot().status === "idle") this.load();
					},
					refresh: () => {
						this.load();
					},
					openInstall: () => {
						if (this.getSnapshot().install.requestId === void 0) {
							this.patch({ install: {
								...IDLE_INSTALL,
								open: true,
								registry: this.registryMemory.getSnapshot() ?? OFFICIAL_REGISTRY
							} });
							const read = { choice: this.getSnapshot().install.registry };
							this.registryRead = read;
							read.done = this.readRegistries(read).finally(() => {
								delete read.done;
							});
						} else this.patchInstall({ open: true });
						this.reconcileInstall();
					},
					closeInstall: () => {
						if (isInstallPending(this.getSnapshot().install.phase)) {
							this.patchInstall({ open: false });
							this.cancelInstall();
							return;
						}
						this.abortInspect();
						this.registryRead = void 0;
						this.patch({ install: IDLE_INSTALL });
					},
					editInstallSpec: (text) => {
						const install = this.getSnapshot().install;
						if (install.phase === "checking" || isInstallPending(install.phase)) return;
						this.patchInstall(install.phase === "idle" ? {
							spec: text,
							inputError: null
						} : {
							...specAgain(install),
							spec: text
						});
					},
					runInstall: () => {
						this.runInstall();
					},
					toggleRegistryOptions: () => {
						this.patchInstall({ registryOpen: !this.getSnapshot().install.registryOpen });
					},
					chooseRegistry: (choice) => {
						if (this.getSnapshot().install.phase === "idle") this.patchInstall({
							registry: choice,
							registryError: false
						});
					},
					changeRegistry: () => {
						const install = this.getSnapshot().install;
						if (install.phase === "failed") this.patch({ install: {
							...specAgain(install),
							registryOpen: true
						} });
					},
					useGithubMirror: () => {
						const install = this.getSnapshot().install;
						const mirror = githubRecoveryRegistry(install);
						if (mirror === void 0) return;
						const registry = {
							kind: "offered",
							registry: mirror
						};
						this.registryMemory.set(registry);
						this.patch({ install: {
							...specAgain(install),
							spec: "",
							mirrorRecovery: true,
							registry
						} });
					},
					approveBuildsAndRetry: () => {
						this.approveBuildsAndRetry();
					},
					cancelInstall: () => {
						this.cancelInstall();
					},
					reconcileInstall: () => {
						this.reconcileInstall();
					},
					toggleInstallDetails: () => {
						this.patchInstall({ detailsOpen: !this.getSnapshot().install.detailsOpen });
					},
					enableInstalled: () => {
						this.enableInstalled();
					},
					clearHighlight: () => {
						if (this.getSnapshot().highlight !== null) this.patch({ highlight: null });
					},
					setEnabled: (packageName, enabled) => {
						this.run(packageName, {
							packageName,
							action: enabled ? "enable" : "disable"
						}, async () => {
							this.applied(await this.ctx.remote.pluginManager.setBundleEnabled(packageName, enabled), packageName);
						});
					},
					uninstall: (packageName) => {
						this.pendingConfirm = () => this.run(packageName, {
							packageName,
							action: "uninstall"
						}, async () => {
							this.applied(await this.ctx.remote.pluginManager.removeBundle(packageName), packageName);
						});
						this.patch({ confirm: {
							action: "uninstall",
							packageName
						} });
					},
					confirm: () => {
						this.confirm();
					},
					cancelConfirm: () => {
						this.pendingConfirm = void 0;
						this.patch({ confirm: null });
					},
					setRowEnabled: (entryId, enabled) => {
						this.run(rowKey(entryId), {
							packageName: entryId,
							action: enabled ? "rowEnable" : "rowDisable"
						}, async () => {
							this.applied(await this.ctx.remote.pluginManager.setPluginEnabled(entryId, enabled), entryId);
						});
					},
					dismissNotice: () => {
						this.patch({ notice: null });
					}
				};
			}
			/**
			* Follow the Host's cancellation window for this dialog's installation.
			* @param progress - a request id and phase received from the Host.
			*/
			installProgress(progress) {
				const install = this.getSnapshot().install;
				if (install.requestId !== progress.requestId || !isInstallPending(install.phase)) return;
				const request = this.request;
				if (request === void 0) return;
				request.acknowledged = true;
				if (install.phase === "applying") return;
				if (progress.phase === "installing" && request.cancellation !== void 0) {
					if (request.cancellation.waitingForStart) this.sendCancellation(request, request.cancellation);
					return;
				}
				const attempt = progress.attempt;
				this.patchInstall({
					phase: progress.phase === "installing" ? "running" : progress.phase,
					...attempt === void 0 ? {} : { attempts: {
						registries: [...install.attempts?.registries ?? [], attempt.registry],
						total: attempt.total
					} }
				});
			}
			currentRegistryRead(read) {
				return !this.disposed && this.registryRead === read;
			}
			/** Read the registries the Host offers, for the dialog just opened; a refused read leaves pnpm's own and a typed one. */
			async readRegistries(read) {
				const answer = await this.ctx.remote.pluginManager.registries();
				const install = this.getSnapshot().install;
				if (!this.currentRegistryRead(read) || !install.open || !answer.ok) return;
				const remembered = this.registryMemory.getSnapshot();
				const untouched = install.registry === read.choice && (install.phase === "idle" || install.phase === "checking");
				if (untouched) read.choice = reconciled(remembered, answer.value);
				this.patchInstall({
					registries: answer.value,
					...untouched ? { registry: read.choice } : {}
				});
			}
			/**
			* Fold a chunk belonging to this installation into its pnpm command.
			* A final chunk may arrive after the install answer and still updates an existing run.
			* @param chunk - the chunk the Host forwarded.
			*/
			appendLog(chunk) {
				const install = this.getSnapshot().install;
				if (chunk.requestId !== install.requestId) return;
				if (install.requestId !== void 0 && (install.phase === "starting" || install.phase === "cancelling" || install.phase === "unconfirmed")) this.installProgress({
					requestId: install.requestId,
					phase: "installing"
				});
				const index = install.runs.findIndex((run) => run.jobId === chunk.jobId);
				if (index === -1 && !isInstallPending(install.phase)) return;
				const settled = chunk.exitCode === void 0 ? {} : { exitCode: chunk.exitCode };
				const runs = index === -1 ? [...install.runs, {
					jobId: chunk.jobId,
					command: chunk.argv.join(" "),
					cwd: chunk.cwd,
					output: chunk.text,
					...settled
				}] : install.runs.map((run, at) => at === index ? {
					...run,
					output: run.output + chunk.text,
					...settled
				} : run);
				this.patchInstall({ runs });
			}
			/**
			* Read the bundles and the entries their rows run as. A call during an
			* in-flight read marks one rerun after it settles.
			* @returns settlement after this call's freshness is reflected.
			*/
			load() {
				if (this.disposed) return Promise.resolve();
				this.reconcileInstall();
				if (this.inFlight !== void 0) {
					this.rerun = true;
					return this.inFlight;
				}
				const run = Promise.resolve().then(() => this.read());
				this.inFlight = run;
				return run;
			}
			async read() {
				try {
					do {
						this.rerun = false;
						const generation = ++this.generation;
						if (this.getSnapshot().status === "idle") this.patch({ status: "loading" });
						const inventory = await this.ctx.remote.pluginInventory.list();
						if (generation !== this.generation) return;
						if (!inventory.ok) {
							this.patch({ status: "error" });
							continue;
						}
						if (inventory.value.managementAvailable !== true) {
							this.patch({
								status: "unavailable",
								packages: []
							});
							continue;
						}
						const [bundles, plugins] = await Promise.all([this.ctx.remote.pluginManager.listBundles(), this.ctx.remote.pluginManager.listPlugins()]);
						if (generation !== this.generation) return;
						if (!bundles.ok || !plugins.ok) {
							this.patch({ status: "error" });
							continue;
						}
						this.patch({
							status: "ready",
							packages: sortPackages(bundles.value.map((bundle) => packageView(bundle, plugins.value)))
						});
					} while (this.shouldRerun());
				} finally {
					this.inFlight = void 0;
				}
			}
			shouldRerun() {
				return this.rerun;
			}
			async confirm() {
				const pending = this.pendingConfirm;
				this.pendingConfirm = void 0;
				this.patch({ confirm: null });
				if (pending !== void 0) await pending();
			}
			/** Drop the check in flight; its answer is ignored. */
			abortInspect() {
				this.inspectAbort?.abort();
				this.inspectAbort = void 0;
			}
			/** Whether a settlement arrives too late to matter: the store is disposed, or the dialog moved on. */
			gone(signal) {
				return this.disposed || signal.aborted;
			}
			/**
			* Check the typed spec, then install it. The Host reads what the spec
			* names first; a refused spec returns to the field with the reason, an
			* accepted one becomes the subject the next screens show while pnpm runs.
			*/
			async runInstall() {
				const state = this.getSnapshot();
				const install = state.install;
				const spec = install.spec.trim();
				if (install.phase === "checking" || isInstallPending(install.phase) || spec === "") return;
				if (state.packages.some((pkg) => pkg.name === spec)) {
					this.patchInstall({
						phase: "idle",
						inputError: {
							problem: "already-installed",
							reason: spec
						}
					});
					return;
				}
				const choice = install.registry;
				const typed = choice.kind === "custom" ? choice.url.trim() : void 0;
				if (typed !== void 0 && !REGISTRY_URL.test(typed)) {
					this.patchInstall({
						phase: "idle",
						registryError: true
					});
					return;
				}
				this.abortInspect();
				const controller = new AbortController();
				this.inspectAbort = controller;
				this.patchInstall({
					phase: "checking",
					inputError: null,
					subject: null,
					runs: [],
					detailsOpen: false,
					attempts: null,
					registryOpen: false,
					installed: null,
					restartRequired: false,
					failure: null,
					approvedBuilds: []
				});
				const read = this.registryRead;
				if (read !== void 0 && choice === read.choice && read.done !== void 0) {
					await read.done;
					if (this.gone(controller.signal) || this.registryRead !== read) return;
				}
				const currentChoice = this.getSnapshot().install.registry;
				const selected = currentChoice.kind === "custom" ? {
					...currentChoice,
					url: currentChoice.url.trim()
				} : currentChoice;
				const registry = selected.kind === "custom" ? selected.url : selected.registry;
				this.registryMemory.set(selected);
				const inspected = await this.ctx.remote.pluginManager.inspect(spec, { registry }, controller.signal);
				if (this.gone(controller.signal)) return;
				this.inspectAbort = void 0;
				if (!inspected.ok) {
					this.patchInstall({
						phase: "idle",
						inputError: {
							problem: "unknown",
							reason: inspected.error.message
						}
					});
					return;
				}
				if (inspected.value.status === "refused") {
					const { problem, reason, registries } = inspected.value;
					this.patchInstall({
						phase: "idle",
						inputError: {
							problem,
							reason,
							...registries === void 0 ? {} : { registries }
						}
					});
					return;
				}
				await this.startInstall({
					spec,
					...inspected.value
				});
			}
			/**
			* Hand the checked spec to the Host and settle the dialog from its answer.
			* `approvedBuilds` names the pending install scripts the person allowed;
			* the Host saves that permission for this profile before pnpm runs.
			*/
			async startInstall(subject, approvedBuilds) {
				const { spec, registry } = subject;
				const requestId = randomUUID();
				const request = {
					requestId,
					acknowledged: false,
					replyLost: false,
					recovering: false
				};
				this.request = request;
				this.patchInstall({
					phase: "starting",
					requestId,
					subject,
					runs: [],
					attempts: null,
					failure: null,
					installed: null,
					approvedBuilds: []
				});
				const result = await this.ctx.remote.pluginManager.installBundle(spec, {
					enabled: false,
					requestId,
					registry,
					...approvedBuilds === void 0 ? {} : { approvedBuilds: [...approvedBuilds] }
				});
				if (this.disposed || this.request !== request) return;
				if (!result.ok) {
					request.replyLost = true;
					this.installUncertain("result", result.error.message);
					this.reconcileInstall();
					return;
				}
				this.settleInstall(result.value);
			}
			/** A recovery call shares the Host's active result; absent results are explicitly unknown. */
			async reconcileInstall() {
				const request = this.request;
				if (request === void 0 || !request.replyLost || request.recovering) return;
				request.recovering = true;
				const result = await this.ctx.remote.pluginManager.waitForInstall(request.requestId);
				if (this.disposed || this.request !== request) return;
				request.recovering = false;
				if (!result.ok) {
					this.installUncertain("result", result.error.message);
					return;
				}
				if (result.value !== null) {
					this.settleInstall(result.value);
					return;
				}
				this.request = void 0;
				this.patchInstall({
					phase: "unknown",
					failure: null,
					runs: settledRuns(this.getSnapshot().install.runs, null)
				});
				this.notifyHiddenInstall("unknown");
				this.load();
			}
			settleInstall(result) {
				const { runs, attempts } = this.getSnapshot().install;
				this.request = void 0;
				const asked = result.registries === void 0 ? {} : { attempts: {
					registries: result.registries,
					total: Math.max(attempts?.total ?? 0, result.registries.length)
				} };
				if (result.application === "cancelled") this.offerSpecAgain({
					kind: "cancelled",
					seq: ++this.noticeSeq
				});
				else if (result.application === "failed") {
					const packages = result.packageResult;
					this.patchInstall({
						phase: "failed",
						runs: settledRuns(runs, packages?.exitCode ?? null),
						failure: failureOf(result.error, packages?.kind, result.pendingBuilds, result.failedAt),
						...asked
					});
				} else this.patchInstall({
					phase: "done",
					runs: settledRuns(runs, 0),
					failure: null,
					installed: result.bundle ?? null,
					restartRequired: result.application === "restart-required",
					approvedBuilds: result.approvedBuilds ?? [],
					...asked
				});
				const phase = this.getSnapshot().install.phase;
				if (phase === "done" || phase === "failed") this.notifyHiddenInstall(phase);
				this.load();
			}
			installUncertain(uncertainty, reason) {
				this.patchInstall({
					phase: this.getSnapshot().install.phase === "applying" ? "applying" : "unconfirmed",
					failure: {
						reason,
						uncertainty
					}
				});
				this.notifyHiddenInstall("unconfirmed");
			}
			/**
			* Allow the install scripts the failed run left pending and run the same
			* spec again. Only the failed screen with pending names offers this.
			*/
			async approveBuildsAndRetry() {
				const install = this.getSnapshot().install;
				const pending = install.failure?.pendingBuilds;
				if (install.phase !== "failed" || install.subject === null || pending === void 0 || pending.length === 0) return;
				await this.startInstall(install.subject, pending);
			}
			/**
			* Leave the check or the failed screen for the spec at once; a Host-owned
			* run is asked to stop and its state waits for the Host's word, since
			* neither a dropped RPC nor a closed connection means pnpm has stopped.
			*/
			async cancelInstall() {
				const install = this.getSnapshot().install;
				if (install.phase === "checking" || install.phase === "failed" || install.phase === "unknown") {
					this.abortInspect();
					this.offerSpecAgain();
					return;
				}
				const request = this.request;
				if (install.phase !== "starting" && install.phase !== "running" && install.phase !== "unconfirmed" || request === void 0) return;
				if (request.cancellation !== void 0 && !request.cancellation.waitingForStart) return;
				const cancellation = { waitingForStart: false };
				request.cancellation = cancellation;
				await this.sendCancellation(request, cancellation);
			}
			/** A cancellation that overtakes installation is retried after the Host acknowledges that request. */
			async sendCancellation(request, cancellation) {
				const acknowledged = request.acknowledged;
				cancellation.waitingForStart = false;
				this.patchInstall({
					phase: "cancelling",
					failure: null
				});
				const result = await this.ctx.remote.pluginManager.cancelInstall(request.requestId);
				if (this.disposed || this.request !== request || request.cancellation !== cancellation) return;
				if (!result.ok) {
					cancellation.waitingForStart = !request.acknowledged;
					if (request.acknowledged) request.cancellation = void 0;
					this.installUncertain(request.replyLost ? "result" : "cancellation", result.error.message);
					return;
				}
				if (result.value.status === "cancelled") {
					this.offerSpecAgain({
						kind: "cancelled",
						seq: ++this.noticeSeq
					});
					this.load();
				} else if (result.value.status === "too-late") {
					request.acknowledged = true;
					request.cancellation = void 0;
					this.patchInstall({ phase: "applying" });
					this.notifyHiddenInstall("applying");
					this.reconcileInstall();
				} else if (request.replyLost) {
					request.cancellation = void 0;
					this.installUncertain("result", "");
					this.reconcileInstall();
				} else if (!acknowledged && this.getSnapshot().install.phase !== "applying") if (request.acknowledged) await this.sendCancellation(request, cancellation);
				else {
					cancellation.waitingForStart = true;
					this.installUncertain("acceptance", "");
				}
				else {
					request.cancellation = void 0;
					this.installUncertain("cancellation", "");
				}
			}
			notifyHiddenInstall(outcome) {
				if (!this.getSnapshot().install.open) this.patch({ notice: {
					kind: "install",
					outcome,
					seq: ++this.noticeSeq
				} });
			}
			/**
			* Release the tracked request and return to editing with its spec retained.
			* A cancellation notice is supplied only after the Host confirms it stopped.
			*/
			offerSpecAgain(notice = null) {
				this.request = void 0;
				this.patch({
					install: specAgain(this.getSnapshot().install),
					...notice === null ? {} : { notice }
				});
			}
			/**
			* Enable the bundle the finished install added, then close the dialog and
			* mark it in the list. A refusal toasts and still closes: the list shows
			* what did not switch on.
			*/
			async enableInstalled() {
				const install = this.getSnapshot().install;
				if (install.phase !== "done" || install.enabling) return;
				const name = install.installed;
				this.patchInstall({ enabling: true });
				if (name !== null) try {
					const result = await this.ctx.remote.pluginManager.setBundleEnabled(name, true);
					if (this.disposed) return;
					this.applied(result, name);
				} catch (error) {
					this.patch({ notice: failedNotice(error, {
						packageName: name,
						action: "enable"
					}, ++this.noticeSeq) });
					this.patchInstall({ enabling: false });
					await this.load();
					return;
				}
				this.patch({
					install: IDLE_INSTALL,
					highlight: name
				});
				await this.load();
			}
			/**
			* Run one action under a busy key, turn its failure into the notice, and
			* re-read the Host afterwards whatever happened.
			*/
			async run(key, subject, action) {
				if (this.disposed || this.getSnapshot().busy.includes(key)) return;
				this.patch({
					busy: [...this.getSnapshot().busy, key],
					notice: null
				});
				try {
					await action();
				} catch (error) {
					this.patch({ notice: failedNotice(error, subject, ++this.noticeSeq) });
				} finally {
					this.patch({ busy: this.getSnapshot().busy.filter((entry) => entry !== key) });
				}
				await this.load();
			}
			/**
			* Publish a change's outcome: a refused answer or a change the Host could
			* not apply throws for {@link run} to report; a change that waits for the
			* next start, that a higher layer overrides, or that the Host stopped is
			* said in passing.
			*/
			applied(answer, packageName) {
				if (!answer.ok) throw new RemoteAnswerError(answer.error.message);
				const result = answer.value;
				switch (result.application) {
					case "failed": throw new RemoteAnswerError(result.error?.diagnostic ?? "", result.error?.code, result.error?.incompatible);
					case "cancelled":
						this.patch({ notice: {
							kind: "cancelled",
							seq: ++this.noticeSeq
						} });
						return;
					case "restart-required":
						this.patch({ notice: {
							kind: "restart",
							packageName,
							seq: ++this.noticeSeq
						} });
						return;
					case "overridden":
						this.patch({ notice: {
							kind: "overridden",
							packageName,
							seq: ++this.noticeSeq
						} });
						return;
					case "applied": return;
				}
			}
			patch(next) {
				if (this.disposed) return;
				this.store.set({
					...this.getSnapshot(),
					...next
				});
			}
			patchInstall(next) {
				this.patch({ install: {
					...this.getSnapshot().install,
					...next
				} });
			}
		};
		/** What a thrown failure said: a refused answer's reason, else the error's message. */
		function reasonOf(error) {
			return error instanceof Error ? error.message : String(error);
		}
		//#endregion
		//#region \0dsh-css:D:\git\AI\dsh-zq\sources\plugins\dsh-plugins\bkms-plugin-center\src\client\PluginManagerPage.module.css.mjs
		const css$2 = ".Yf8bJW_page{box-sizing:border-box;height:100%;color:var(--dsw-alias-label-primary);flex-direction:column;align-items:center;gap:32px;padding:28px clamp(24px,4vw,48px) 48px;display:flex;overflow:auto}.Yf8bJW_page>*{width:100%;max-width:960px}.Yf8bJW_pageHead{box-sizing:border-box;justify-content:space-between;align-items:flex-start;gap:16px;display:flex}[data-platform=darwin] .Yf8bJW_pageHead{padding-top:var(--dsh-frame-top-clearance,0px)}.Yf8bJW_pageTitle{margin:0;font-size:20px;font-weight:500;line-height:28px}.Yf8bJW_pageIntro{color:var(--dsw-alias-label-secondary);margin:4px 0 0;font-size:13px;line-height:20px}.Yf8bJW_toolbar{justify-content:flex-end;align-items:center;gap:16px;display:flex}.Yf8bJW_status,.Yf8bJW_failure p,.Yf8bJW_empty{color:var(--dsw-alias-label-tertiary);margin:0;font-size:13px;line-height:20px}.Yf8bJW_failure{color:var(--dsw-alias-state-error-primary);align-items:center;gap:10px;display:flex}.Yf8bJW_statusWithDot{align-items:center;gap:6px;display:inline-flex}.Yf8bJW_banner{background:color-mix(in srgb, var(--dsw-alias-state-warning-primary,var(--dsw-alias-state-business-primary)) 12%, transparent);color:var(--dsw-alias-label-primary);border-radius:10px;margin:0;padding:8px 12px;font-size:12px;line-height:18px}.Yf8bJW_group{flex-direction:column;gap:8px;display:flex}.Yf8bJW_groupHead{align-items:baseline;gap:8px;display:flex}.Yf8bJW_groupTitle{margin:0;font-size:14px;font-weight:500;line-height:22px}.Yf8bJW_count{color:var(--dsw-alias-label-caption);font-variant-numeric:tabular-nums;font-size:14px}.Yf8bJW_groupInfo{color:var(--dsw-alias-label-caption);align-self:center;align-items:center;display:inline-flex}.Yf8bJW_groupInfo:hover,.Yf8bJW_groupInfo:focus-visible{color:var(--dsw-alias-label-secondary)}.Yf8bJW_statusTag{height:18px;padding:0 7px;font-size:10px;line-height:1}.Yf8bJW_card[data-plugin-highlight]{animation:2.4s ease-out Yf8bJW_dsh-plugin-highlight}@keyframes Yf8bJW_dsh-plugin-highlight{0%,55%{box-shadow:0 0 0 2px var(--dsw-alias-state-business-primary)}to{box-shadow:0 0 #0000}}@media (prefers-reduced-motion:reduce){.Yf8bJW_card[data-plugin-highlight]{box-shadow:0 0 0 2px var(--dsw-alias-state-business-primary);animation:none}}.Yf8bJW_iconButton:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}.Yf8bJW_cards{flex-direction:column;gap:2px;margin:0;padding:0;list-style:none;display:flex}.Yf8bJW_card{--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2);border-radius:12px;min-width:0;margin:0 -8px}.Yf8bJW_cardHead{align-items:center;gap:14px;padding:8px;display:flex}.Yf8bJW_cardIcon{border:.5px solid var(--dsw-alias-border-l3);width:48px;height:48px;color:var(--dsw-alias-label-secondary);border-radius:10px;flex:none;justify-content:center;align-items:center;display:inline-flex}.Yf8bJW_packageImage{object-fit:contain}.Yf8bJW_cardMain{flex-direction:column;flex:1;gap:4px;min-width:0;display:flex}.Yf8bJW_titleRow{flex-wrap:wrap;align-items:center;gap:8px;min-width:0;display:flex}.Yf8bJW_cardTitle{text-overflow:ellipsis;white-space:nowrap;font-size:14px;font-weight:500;line-height:20px;overflow:hidden}.Yf8bJW_cardLink{position:relative}.Yf8bJW_cardLink:hover{background:var(--dsw-alias-interactive-bg-hover)}.Yf8bJW_cardOpen{max-width:100%;color:inherit;font:inherit;text-align:left;cursor:pointer;background:0 0;border:0;padding:0;font-size:14px;font-weight:500;line-height:20px}.Yf8bJW_cardOpen:after{content:\"\";border-radius:12px;position:absolute;inset:0}.Yf8bJW_cardOpen:focus-visible{outline:none}.Yf8bJW_cardOpen:focus-visible:after{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}.Yf8bJW_cardDesc{color:var(--dsw-alias-label-tertiary);-webkit-line-clamp:1;-webkit-box-orient:vertical;font-size:13px;line-height:18px;display:-webkit-box;overflow:hidden}.Yf8bJW_cardEnd{z-index:1;flex:none;align-items:center;gap:8px;display:inline-flex;position:relative}.Yf8bJW_iconButton{width:28px;height:28px;color:var(--dsw-alias-label-caption);cursor:pointer;background:0 0;border:0;border-radius:28px;justify-content:center;align-items:center;display:inline-flex}.Yf8bJW_iconButton:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}.Yf8bJW_iconButton:disabled{opacity:.5;cursor:default}.Yf8bJW_addButton{border-radius:16px;height:32px;padding:0 12px;font-size:13px;line-height:20px}.Yf8bJW_iconWrap{display:inline-flex}.Yf8bJW_danger{color:var(--dsw-alias-state-error-primary);border-color:color-mix(in srgb, var(--dsw-alias-state-error-primary) 30%, transparent);--dsw-alias-interactive-bg-hover:color-mix(in srgb, var(--dsw-alias-state-error-primary) 8%, transparent)}.Yf8bJW_detailActions{flex:none;align-items:center;gap:16px;display:flex}.Yf8bJW_actions{align-items:center;gap:16px;display:flex}.Yf8bJW_deleteButton{width:28px;height:28px;color:var(--dsw-alias-state-error-primary);cursor:pointer;background:0 0;border:0;border-radius:8px;justify-content:center;align-items:center;display:inline-flex}.Yf8bJW_deleteButton:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-danger,var(--dsw-alias-interactive-bg-hover))}.Yf8bJW_deleteButton:disabled{opacity:.5;cursor:default}.Yf8bJW_deleteButton:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}.Yf8bJW_reason{color:var(--dsw-alias-state-error-primary);overflow-wrap:anywhere;white-space:pre-wrap;margin:0;font-size:12px;line-height:18px}.Yf8bJW_partsHead .Yf8bJW_subLabel{margin:0}.Yf8bJW_partsFilter{width:200px}.Yf8bJW_partsFilter:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}.Yf8bJW_installDialog{width:min(560px,100%);max-height:min(800px,100%)}.Yf8bJW_installContent{min-height:0;overflow-y:auto}.Yf8bJW_installBody{flex-direction:column;gap:12px;min-width:0;display:flex}.Yf8bJW_installLocation{color:var(--dsw-alias-label-tertiary);overflow-wrap:anywhere;margin:0;font-size:12px;line-height:18px}.Yf8bJW_installField{flex-direction:column;gap:6px;font-size:13px;display:flex}.Yf8bJW_installField input[type=text]{border:.5px solid var(--dsw-alias-border-l4);background:var(--dsw-alias-bg-layer-3);height:40px;font:inherit;color:var(--dsw-alias-label-primary);border-radius:14px;outline:none;padding:0 14px;font-size:13px}.Yf8bJW_installField input[type=text]:focus{border-color:var(--dsw-alias-brand-primary);box-shadow:inset 0 0 0 .5px var(--dsw-alias-brand-primary)}.Yf8bJW_installField input[aria-invalid=true]{border-color:var(--dsw-alias-state-error-primary)}.Yf8bJW_guideToggle{font:inherit;color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:0;align-self:flex-start;align-items:center;gap:4px;margin-top:4px;padding:0;font-size:12.5px;display:inline-flex}.Yf8bJW_guideToggle:hover{color:var(--dsw-alias-label-primary)}.Yf8bJW_guideChevron{transition:transform .16s}.Yf8bJW_guideToggle[aria-expanded=true] .Yf8bJW_guideChevron{transform:rotate(180deg)}.Yf8bJW_guide{border:.5px solid var(--dsw-alias-border-l4);background:var(--dsw-alias-bg-layer-1);border-radius:14px;flex-direction:column;gap:10px;padding:8px 14px 14px;display:flex}.Yf8bJW_guideHint{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:18px}.Yf8bJW_guideSafety{background:color-mix(in srgb, var(--dsw-alias-state-warning-primary,var(--dsw-alias-state-business-primary)) 12%, transparent);color:var(--dsw-alias-state-warning-primary,var(--dsw-alias-state-business-primary));border-radius:10px;align-items:flex-start;gap:8px;margin:0;padding:10px 12px;font-size:12px;line-height:18px;display:flex}.Yf8bJW_guideSafety>svg{flex:none;margin-top:2px}.Yf8bJW_guideList{flex-direction:column;gap:2px;margin:0;padding:0;list-style:none;display:flex}.Yf8bJW_guideItem{align-items:flex-start;gap:10px;padding:8px 0;display:flex}.Yf8bJW_guideIndex{corner-shape:round;background:var(--dsw-alias-bg-module-platform);width:20px;height:20px;color:var(--dsw-alias-label-secondary);border-radius:999px;flex:none;justify-content:center;align-items:center;font-size:11px;font-weight:500;display:inline-flex}.Yf8bJW_guideMain{flex-direction:column;flex:1;gap:0;min-width:0;display:flex}.Yf8bJW_guideTitle{color:var(--dsw-alias-label-primary);font-size:13px;font-weight:500;line-height:20px}.Yf8bJW_guideExample{color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere;font-size:12px;line-height:20px}.Yf8bJW_guideExample code{font-family:var(--dsw-font-mono,ui-monospace, SFMono-Regular, Menlo, monospace)}.Yf8bJW_guideExampleLabel{color:var(--dsw-alias-label-tertiary)}.Yf8bJW_optionsRow{flex-wrap:wrap;justify-content:space-between;align-items:center;gap:8px 12px;display:flex}.Yf8bJW_registryToggle{border:.5px solid var(--dsw-alias-border-l4);background:var(--dsw-alias-bg-layer-2);height:26px;font:inherit;color:var(--dsw-alias-label-secondary);cursor:pointer;border-radius:8px;align-items:center;gap:6px;padding:0 8px 0 10px;font-size:12.5px;display:inline-flex}.Yf8bJW_registryToggle:hover:not(:disabled){color:var(--dsw-alias-label-primary)}.Yf8bJW_registryToggle:disabled{cursor:default;opacity:.6}.Yf8bJW_registryToggle[aria-expanded=true]{border-color:var(--dsw-alias-border-l3);background:var(--dsw-alias-bg-layer-3)}.Yf8bJW_registryToggle[aria-expanded=true] .Yf8bJW_guideChevron{transform:rotate(180deg)}.Yf8bJW_registryChosen{color:var(--dsw-alias-label-primary);font-weight:500}.Yf8bJW_registry{z-index:1100;box-sizing:border-box;background:var(--dsw-alias-bg-layer-2);--dsw-elevation-stroke-color:var(--dsw-alias-border-l3);width:min(440px,100vw - 24px);box-shadow:var(--dsw-elevation-prominent);border:0;border-radius:12px;flex-direction:column;gap:4px;min-width:0;margin:0;padding:8px 10px 12px;display:flex;position:fixed}.Yf8bJW_registryOption{cursor:pointer;border:.5px solid #0000;border-radius:10px;flex-direction:column;gap:4px;padding:8px 10px;display:flex}.Yf8bJW_registryOption[data-checked=true]{border-color:color-mix(in srgb, var(--dsw-alias-brand-primary) 40%, transparent);background:var(--dsw-alias-bg-layer-2)}label.Yf8bJW_registryOption{flex-direction:row;align-items:flex-start;gap:10px}.Yf8bJW_registryOption input[type=radio]{width:16px;height:16px;accent-color:var(--dsw-alias-brand-primary);flex:none;margin:2px 0 0}.Yf8bJW_registryTitle{color:var(--dsw-alias-label-primary);flex-wrap:wrap;align-items:center;gap:8px;font-size:13px;line-height:20px;display:flex}.Yf8bJW_registryHint{color:var(--dsw-alias-label-tertiary);overflow-wrap:anywhere;font-size:12px;line-height:18px}.Yf8bJW_registryCustomPick{cursor:pointer;align-items:flex-start;gap:10px;display:flex}.Yf8bJW_registryCustomField{border:.5px solid var(--dsw-alias-border-l4);background:var(--dsw-alias-bg-layer-3);height:32px;font:inherit;color:var(--dsw-alias-label-primary);border-radius:8px;margin-left:26px;padding:0 10px;font-size:13px}.Yf8bJW_registryCustomField[aria-invalid=true]{border-color:var(--dsw-alias-state-error-primary)}.Yf8bJW_registryOption>.Yf8bJW_inputError,.Yf8bJW_registryOption>.Yf8bJW_registryHint{margin-left:26px}.Yf8bJW_inputError{color:var(--dsw-alias-state-error-primary);margin:-4px 0 0;font-size:12px;line-height:18px}.Yf8bJW_wide{border-radius:14px;justify-content:center;width:100%;height:40px}.Yf8bJW_wizard{flex-direction:column;flex:auto;gap:16px;min-width:0;min-height:0;padding:16px 20px 0;display:flex}.Yf8bJW_wizardScroll{flex-direction:column;flex:auto;gap:16px;min-height:0;display:flex;overflow-y:auto}.Yf8bJW_wizardHead{justify-content:space-between;align-items:center;min-height:24px;display:flex}.Yf8bJW_wizardBack{font:inherit;color:var(--dsw-alias-label-primary);cursor:pointer;background:0 0;border:0;align-items:center;gap:4px;padding:0;font-size:15px;font-weight:600;display:inline-flex}.Yf8bJW_wizardClose{width:24px;height:24px;color:var(--dsw-alias-label-tertiary);cursor:pointer;background:0 0;border:0;border-radius:6px;justify-content:center;align-items:center;padding:0;display:inline-flex}.Yf8bJW_wizardClose:hover{background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary)}.Yf8bJW_wizardHero{text-align:center;flex-direction:column;align-items:center;gap:10px;padding:8px 0 4px;display:flex}.Yf8bJW_wizardIcon{width:44px;height:44px;color:var(--dsw-alias-label-secondary);justify-content:center;align-items:center;display:inline-flex}.Yf8bJW_wizardIcon[data-state=done]{color:var(--dsw-alias-state-success-secondary)}.Yf8bJW_wizardIcon[data-state=error]{color:var(--dsw-alias-state-warn-label)}.Yf8bJW_wizardTitle{margin:0;font-size:18px;font-weight:600;line-height:26px}.Yf8bJW_wizardSub{color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere;margin:0;font-size:13px;line-height:20px}.Yf8bJW_subject{border:.5px solid var(--dsw-alias-border-l3);text-align:center;border-radius:12px;flex-direction:column;align-items:center;gap:6px;padding:16px;display:flex}.Yf8bJW_subjectName{overflow-wrap:anywhere;margin:0;font-size:15px;font-weight:600;line-height:22px}.Yf8bJW_subjectDesc,.Yf8bJW_subjectMeta{color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere;margin:0;font-size:13px;line-height:20px}.Yf8bJW_wizardFoot{justify-content:space-between;align-items:center;gap:12px;display:flex}.Yf8bJW_footAction{border-radius:16px;height:32px}.Yf8bJW_detailsToggle{font:inherit;color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:0;align-items:center;gap:4px;padding:0;font-size:13px;display:inline-flex}.Yf8bJW_detailsChevron{transition:transform .16s}.Yf8bJW_detailsToggle[aria-expanded=true] .Yf8bJW_detailsChevron{transform:rotate(180deg)}.Yf8bJW_detailsBody{flex-direction:column;gap:8px;min-width:0;display:flex}.Yf8bJW_wizardActions{align-items:center;gap:8px;display:flex}.Yf8bJW_run{flex-direction:column;gap:4px;min-width:0;display:flex}.Yf8bJW_attemptBadge{background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-secondary);border-radius:6px;align-self:flex-start;margin:0;padding:0 6px;font-size:11px;line-height:18px}@media (prefers-reduced-motion:reduce){.Yf8bJW_detailsChevron{transition:none}}.Yf8bJW_result,.Yf8bJW_resultWarn{background:color-mix(in srgb, var(--dsw-alias-state-success-primary) 10%, transparent);color:var(--dsw-alias-label-primary);border-radius:10px;margin:0;padding:8px 12px;font-size:13px;line-height:20px}.Yf8bJW_resultWarn{background:color-mix(in srgb, var(--dsw-alias-state-warning-primary,var(--dsw-alias-state-business-primary)) 12%, transparent)}.Yf8bJW_approval{border:.5px solid color-mix(in srgb, var(--dsw-alias-state-warning-primary,var(--dsw-alias-state-business-primary)) 40%, transparent);background:color-mix(in srgb, var(--dsw-alias-state-warning-primary,var(--dsw-alias-state-business-primary)) 8%, transparent);border-radius:12px;flex-direction:column;gap:8px;padding:12px 14px;display:flex}.Yf8bJW_approvalTitle{color:var(--dsw-alias-label-primary);margin:0;font-size:13px;font-weight:600}.Yf8bJW_approvalText{color:var(--dsw-alias-label-secondary);margin:0;font-size:12.5px;line-height:18px}.Yf8bJW_approvalCaution{color:var(--dsw-alias-state-warning-primary,var(--dsw-alias-state-business-primary));margin:0;font-size:12.5px;font-weight:600;line-height:18px}.Yf8bJW_approvalList{flex-wrap:wrap;gap:6px;margin:0;padding:0;list-style:none;display:flex}.Yf8bJW_approvalList code{background:var(--dsw-alias-bg-layer-3);font-family:var(--dsw-font-mono,ui-monospace, SFMono-Regular, Menlo, monospace);color:var(--dsw-alias-label-primary);border-radius:6px;padding:2px 8px;font-size:12px;display:inline-block}.Yf8bJW_terminal{--dsl-terminal-font:var(--dsw-font-markdown-code-block-small);--dsl-terminal-line-height:18px;--dsl-terminal-output-max-height:240px;border:.5px solid var(--dsw-alias-border-l1);margin:4px 0 0}.Yf8bJW_dependents{color:var(--dsw-alias-label-secondary);margin:8px 0 0;padding-left:18px;font-size:13px;line-height:20px}.Yf8bJW_dangerButton{--dsw-alias-button-primary-fill:var(--dsw-alias-state-error-primary);--dsw-alias-button-primary-hover:var(--dsw-alias-state-error-primary)}.Yf8bJW_detail{flex-direction:column;display:flex}[data-platform=darwin] .Yf8bJW_detail{padding-top:var(--dsh-frame-top-clearance,0px)}.Yf8bJW_crumb{color:var(--dsw-alias-label-tertiary);font:inherit;cursor:pointer;background:0 0;border:0;align-items:center;gap:6px;padding:0;font-size:12.5px;display:inline-flex}.Yf8bJW_crumb:hover{color:var(--dsw-alias-label-primary)}.Yf8bJW_crumb:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}.Yf8bJW_crumbIcon{transform:rotate(90deg)}.Yf8bJW_detailHead{justify-content:space-between;align-items:center;gap:12px;margin:32px 0 0;display:flex}.Yf8bJW_detailMain{flex-direction:column;gap:8px;min-width:0;margin-top:20px;display:flex}.Yf8bJW_detailTitle{margin:0;font-size:20px;font-weight:500;line-height:28px}.Yf8bJW_versionTag{font-variant-numeric:tabular-nums;flex:none}.Yf8bJW_detailDesc{color:var(--dsw-alias-label-secondary);margin:0;font-size:14px;line-height:22px}.Yf8bJW_detailName{color:var(--dsw-alias-label-tertiary);overflow-wrap:anywhere;margin:0;font-size:12px;line-height:18px}.Yf8bJW_detailName code{font-family:var(--dsw-font-mono,ui-monospace, SFMono-Regular, Menlo, monospace)}.Yf8bJW_detail>.Yf8bJW_detailDesc{margin-top:12px}.Yf8bJW_detailSections{flex-direction:column;gap:32px;margin-top:32px;display:flex}.Yf8bJW_detailSection{flex-direction:column;gap:12px;display:flex}.Yf8bJW_sectionHead{align-items:baseline;gap:10px;display:flex}.Yf8bJW_sectionTitle{margin:0;font-size:14px;font-weight:500;line-height:20px}.Yf8bJW_sectionCount{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}.Yf8bJW_cardArrow{color:var(--dsw-alias-label-tertiary);flex:none}.Yf8bJW_rows{flex-direction:column;margin:0;padding:0;list-style:none;display:flex}.Yf8bJW_row{border-bottom:.5px solid var(--dsw-alias-border-l2);padding:12px 2px}.Yf8bJW_row:last-child{border-bottom:0}.Yf8bJW_rowLine{align-items:center;gap:16px;min-width:0;display:flex}.Yf8bJW_rowIcon{border:.5px solid var(--dsw-alias-border-l3);width:40px;height:40px;color:var(--dsw-alias-label-secondary);border-radius:10px;flex:none;justify-content:center;align-items:center;display:inline-flex}.Yf8bJW_rowMain{flex-direction:column;flex:1;gap:2px;min-width:0;display:flex}.Yf8bJW_rowId{color:var(--dsw-alias-label-primary);overflow-wrap:anywhere;font-size:13.5px;font-weight:500;line-height:20px}.Yf8bJW_row[data-state=off] .Yf8bJW_rowId{color:var(--dsw-alias-label-secondary)}.Yf8bJW_rowModule{font-family:var(--dsw-font-mono,ui-monospace, SFMono-Regular, Menlo, monospace);color:var(--dsw-alias-label-tertiary);overflow-wrap:anywhere;font-size:11.5px;line-height:16px}.Yf8bJW_rowOpen{color:inherit;font:inherit;text-align:left;cursor:pointer;background:0 0;border:0;align-items:center;gap:2px;padding:0;display:inline-flex}.Yf8bJW_rowOpen:hover .Yf8bJW_rowId{text-underline-offset:3px;text-decoration:underline}.Yf8bJW_rowOpenIcon{color:var(--dsw-alias-label-tertiary);flex:none}.Yf8bJW_rowOpen:hover .Yf8bJW_rowOpenIcon{color:var(--dsw-alias-label-primary)}.Yf8bJW_rowState{color:var(--dsw-alias-label-secondary);white-space:nowrap;flex:none;align-items:center;gap:6px;font-size:12.5px;line-height:18px;display:inline-flex}.Yf8bJW_row[data-state=failed] .Yf8bJW_rowState{color:var(--dsw-alias-state-error-primary)}.Yf8bJW_rowFailure{color:var(--dsw-alias-state-error-primary);overflow-wrap:anywhere;margin:4px 0 0 56px;font-size:12px;line-height:18px}";
		const tagId$2 = "@bkms/plugin-center/PluginManagerPage.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId$2) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@bkms/plugin-center";
			tag.dataset.pluginCss = tagId$2;
			tag.textContent = css$2;
			document.head.appendChild(tag);
		}
		var PluginManagerPage_module_css_default = {
			"partsHead": "Yf8bJW_partsHead",
			"crumb": "Yf8bJW_crumb",
			"attemptBadge": "Yf8bJW_attemptBadge",
			"installBody": "Yf8bJW_installBody",
			"registryChosen": "Yf8bJW_registryChosen",
			"wizardActions": "Yf8bJW_wizardActions",
			"packageImage": "Yf8bJW_packageImage",
			"actions": "Yf8bJW_actions",
			"detailTitle": "Yf8bJW_detailTitle",
			"registryOption": "Yf8bJW_registryOption",
			"versionTag": "Yf8bJW_versionTag",
			"sectionHead": "Yf8bJW_sectionHead",
			"rowId": "Yf8bJW_rowId",
			"detailActions": "Yf8bJW_detailActions",
			"guideTitle": "Yf8bJW_guideTitle",
			"subjectMeta": "Yf8bJW_subjectMeta",
			"resultWarn": "Yf8bJW_resultWarn",
			"wizardBack": "Yf8bJW_wizardBack",
			"rows": "Yf8bJW_rows",
			"partsFilter": "Yf8bJW_partsFilter",
			"crumbIcon": "Yf8bJW_crumbIcon",
			"subjectName": "Yf8bJW_subjectName",
			"registryToggle": "Yf8bJW_registryToggle",
			"subject": "Yf8bJW_subject",
			"danger": "Yf8bJW_danger",
			"guideExample": "Yf8bJW_guideExample",
			"installLocation": "Yf8bJW_installLocation",
			"wizardSub": "Yf8bJW_wizardSub",
			"detailsChevron": "Yf8bJW_detailsChevron",
			"reason": "Yf8bJW_reason",
			"dsh-plugin-highlight": "Yf8bJW_dsh-plugin-highlight",
			"guide": "Yf8bJW_guide",
			"iconWrap": "Yf8bJW_iconWrap",
			"wizardScroll": "Yf8bJW_wizardScroll",
			"subjectDesc": "Yf8bJW_subjectDesc",
			"approvalText": "Yf8bJW_approvalText",
			"detailName": "Yf8bJW_detailName",
			"approval": "Yf8bJW_approval",
			"rowFailure": "Yf8bJW_rowFailure",
			"wizardIcon": "Yf8bJW_wizardIcon",
			"groupTitle": "Yf8bJW_groupTitle",
			"dangerButton": "Yf8bJW_dangerButton",
			"installDialog": "Yf8bJW_installDialog",
			"detailsToggle": "Yf8bJW_detailsToggle",
			"empty": "Yf8bJW_empty",
			"installContent": "Yf8bJW_installContent",
			"wide": "Yf8bJW_wide",
			"wizardClose": "Yf8bJW_wizardClose",
			"detailsBody": "Yf8bJW_detailsBody",
			"optionsRow": "Yf8bJW_optionsRow",
			"footAction": "Yf8bJW_footAction",
			"registryHint": "Yf8bJW_registryHint",
			"banner": "Yf8bJW_banner",
			"terminal": "Yf8bJW_terminal",
			"cardLink": "Yf8bJW_cardLink",
			"page": "Yf8bJW_page",
			"result": "Yf8bJW_result",
			"cardIcon": "Yf8bJW_cardIcon",
			"cardTitle": "Yf8bJW_cardTitle",
			"rowIcon": "Yf8bJW_rowIcon",
			"card": "Yf8bJW_card",
			"pageTitle": "Yf8bJW_pageTitle",
			"failure": "Yf8bJW_failure",
			"guideChevron": "Yf8bJW_guideChevron",
			"rowMain": "Yf8bJW_rowMain",
			"guideItem": "Yf8bJW_guideItem",
			"detailSections": "Yf8bJW_detailSections",
			"deleteButton": "Yf8bJW_deleteButton",
			"cards": "Yf8bJW_cards",
			"guideToggle": "Yf8bJW_guideToggle",
			"detailMain": "Yf8bJW_detailMain",
			"rowState": "Yf8bJW_rowState",
			"wizardTitle": "Yf8bJW_wizardTitle",
			"guideExampleLabel": "Yf8bJW_guideExampleLabel",
			"guideList": "Yf8bJW_guideList",
			"run": "Yf8bJW_run",
			"rowLine": "Yf8bJW_rowLine",
			"row": "Yf8bJW_row",
			"addButton": "Yf8bJW_addButton",
			"subLabel": "Yf8bJW_subLabel",
			"wizard": "Yf8bJW_wizard",
			"detailDesc": "Yf8bJW_detailDesc",
			"pageHead": "Yf8bJW_pageHead",
			"statusTag": "Yf8bJW_statusTag",
			"registryCustomPick": "Yf8bJW_registryCustomPick",
			"registryTitle": "Yf8bJW_registryTitle",
			"detailSection": "Yf8bJW_detailSection",
			"inputError": "Yf8bJW_inputError",
			"statusWithDot": "Yf8bJW_statusWithDot",
			"cardDesc": "Yf8bJW_cardDesc",
			"toolbar": "Yf8bJW_toolbar",
			"approvalCaution": "Yf8bJW_approvalCaution",
			"approvalList": "Yf8bJW_approvalList",
			"dependents": "Yf8bJW_dependents",
			"detail": "Yf8bJW_detail",
			"guideSafety": "Yf8bJW_guideSafety",
			"sectionTitle": "Yf8bJW_sectionTitle",
			"sectionCount": "Yf8bJW_sectionCount",
			"cardOpen": "Yf8bJW_cardOpen",
			"rowOpenIcon": "Yf8bJW_rowOpenIcon",
			"wizardHero": "Yf8bJW_wizardHero",
			"installField": "Yf8bJW_installField",
			"registryCustomField": "Yf8bJW_registryCustomField",
			"wizardFoot": "Yf8bJW_wizardFoot",
			"detailHead": "Yf8bJW_detailHead",
			"rowModule": "Yf8bJW_rowModule",
			"wizardHead": "Yf8bJW_wizardHead",
			"guideIndex": "Yf8bJW_guideIndex",
			"guideMain": "Yf8bJW_guideMain",
			"cardArrow": "Yf8bJW_cardArrow",
			"status": "Yf8bJW_status",
			"groupInfo": "Yf8bJW_groupInfo",
			"rowOpen": "Yf8bJW_rowOpen",
			"cardEnd": "Yf8bJW_cardEnd",
			"approvalTitle": "Yf8bJW_approvalTitle",
			"registry": "Yf8bJW_registry",
			"cardHead": "Yf8bJW_cardHead",
			"titleRow": "Yf8bJW_titleRow",
			"groupHead": "Yf8bJW_groupHead",
			"cardMain": "Yf8bJW_cardMain",
			"count": "Yf8bJW_count",
			"group": "Yf8bJW_group",
			"pageIntro": "Yf8bJW_pageIntro",
			"guideHint": "Yf8bJW_guideHint",
			"iconButton": "Yf8bJW_iconButton"
		};
		//#endregion
		//#region src/client/PluginManagerPage.tsx
		/**
		* Global plugin management: the Official group's cards for the bundles the
		* installation ships switched off and for the official plugins that register
		* their configuration, the Installed group's cards for the profile's bundles,
		* their row switches, the install dialog with its guide and folded pnpm
		* output, the uninstall confirmation, and the toasts an action's outcome
		* becomes. A bundle's page lists the rows it contributes as the Host runs
		* them; a plugin's configuration renders on its own page through the slots
		* the page declares.
		*/
		/** How long the list marks a package an install just enabled. */
		const HIGHLIGHT_MS = 2400;
		/** Built-in profile bundles stay out of this page even when the profile declares them as dependencies. */
		const BUILTIN_PROFILE_BUNDLES = new Set([
			"@deepseek-ai/dsh-base",
			"@deepseek-ai/dsh-web-app",
			"@deepseek-ai/dsh-headless",
			"@deepseek-ai/dsh-sdk-app",
			"@deepseek-ai/dsh-acp-app",
			"@deepseek-ai/dsh-sdk-minimal"
		]);
		/** How long a toast holds: long enough to read a failure that names what broke. */
		function toastHoldMs(text) {
			return Math.min(8e3, Math.max(3e3, text.length * 80));
		}
		const PHASE_KEYS = {
			pending: "rowPhasePending",
			loading: "rowPhaseLoading",
			active: "rowPhaseActive",
			failed: "rowPhaseFailed",
			unloading: "rowPhaseUnloading"
		};
		/** Status dot naming a root-fiber phase; loading and unloading are live transitions. */
		const PHASE_STATES = {
			pending: "idle",
			loading: "ongoing",
			active: "done",
			failed: "error",
			unloading: "ongoing"
		};
		/** The count line over a pack's components: the total, then only the states that occur. */
		function partsSummary(rows, t) {
			const failed = rows.filter((row) => row.phase === "failed").length;
			const off = rows.filter((row) => !row.enabled).length;
			const running = rows.filter((row) => row.enabled && row.phase === "active").length;
			return [
				t("partsCountTotal", { count: String(rows.length) }),
				...running > 0 ? [t("partsCountRunning", { count: String(running) })] : [],
				...off > 0 ? [t("partsCountOff", { count: String(off) })] : [],
				...failed > 0 ? [t("partsCountFailed", { count: String(failed) })] : []
			].join(" · ");
		}
		/** Rows beyond this count get a filter box above the list. */
		const ROW_FILTER_THRESHOLD = 10;
		/** The size the 36-viewBox plugin artwork renders at inside a card's 48px frame. */
		const CARD_ARTWORK_SIZE = 36;
		/** The size the artwork renders at inside a row's 40px frame. */
		const ROW_ARTWORK_SIZE = 30;
		/** The artwork of the official plugins that registered their configuration, by registration id. */
		const ITEM_ARTWORK = new Map([
			["shell", _deepseek_ai_dsh_client_ui_primitives.PluginArtworkTerminal],
			["agent-loop", _deepseek_ai_dsh_client_ui_primitives.PluginArtworkLoop],
			["subagent", _deepseek_ai_dsh_client_ui_primitives.PluginArtworkSubagent],
			["web-search", _deepseek_ai_dsh_client_ui_primitives.PluginArtworkSearch]
		]);
		/** An official plugin's card and page artwork; plugins without their own get the default. */
		function itemArtwork(id) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ITEM_ARTWORK.get(id) ?? _deepseek_ai_dsh_client_ui_primitives.PluginArtworkDefault, { size: CARD_ARTWORK_SIZE });
		}
		/** Manifest images remain isolated from the page DOM; a failed decode keeps the position's default artwork. */
		function PackageArtwork({ src, row = false, size = row ? ROW_ARTWORK_SIZE : CARD_ARTWORK_SIZE }) {
			const [failedSource, setFailedSource] = (0, react.useState)();
			return src === void 0 || src === failedSource ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(row ? _deepseek_ai_dsh_client_ui_primitives.PluginArtworkSubagent : _deepseek_ai_dsh_client_ui_primitives.PluginArtworkDefault, { size }) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("img", {
				className: PluginManagerPage_module_css_default.packageImage,
				src,
				width: size,
				height: size,
				alt: "",
				onError: () => {
					setFailedSource(src);
				}
			});
		}
		/** A row's switch: locked, saying why, when the Host refuses to address the row through the profile patch. */
		function RowSwitch({ row, title, t, busy, onChange }) {
			const locked = row.readOnlyReason !== void 0 || row.entryId === void 0;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Switch, {
				checked: row.enabled,
				label: t("partToggle", { name: title }),
				disabled: busy || locked,
				...row.readOnlyReason === void 0 ? {} : { title: managementText({ code: row.readOnlyReason }, t) },
				onChange
			});
		}
		/** What a row's state line says: off, or the phase its fiber is in. */
		function rowStateText(row, t) {
			if (!row.enabled) return t("partOff");
			return row.phase === null ? t("rowStateIdle") : t(PHASE_KEYS[row.phase]);
		}
		/** The dot beside a row: its fiber phase, or idle. */
		function rowDotState(row) {
			if (!row.enabled || row.phase === null) return "idle";
			return PHASE_STATES[row.phase];
		}
		/** A Host metadata diagnostic does not change the package's management permissions. */
		function MetadataError({ error, t }) {
			return error === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
				className: PluginManagerPage_module_css_default.reason,
				role: "status",
				"data-package-meta-error": true,
				children: t("metadataError", { error })
			});
		}
		/**
		* A pack's rows as a list in the order the pack declares them: a state dot,
		* the row id, one line saying its state, a configure control for a row that
		* registered a page, and, when the pack is on, a switch. A pack like base
		* carries close to a hundred rows, so a long list gets a filter.
		*/
		function RowsSection({ rows, t, resolveText, toggle, configure }) {
			const [filter, setFilter] = (0, react.useState)("");
			const query = filter.trim().toLowerCase();
			const localized = rows.map((row) => ({
				row,
				...rowText(row, resolveText)
			}));
			const shown = query === "" ? localized : localized.filter(({ row, title, description }) => [
				title,
				description,
				row.rowId,
				row.moduleName
			].some((value) => value?.toLowerCase().includes(query)));
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: PluginManagerPage_module_css_default.detailSection,
				"data-plugin-rows": true,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: PluginManagerPage_module_css_default.sectionHead,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h4", {
							className: PluginManagerPage_module_css_default.sectionTitle,
							children: t("partsLabel")
						}), rows.length === 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: PluginManagerPage_module_css_default.sectionCount,
							children: partsSummary(rows, t)
						})]
					}),
					rows.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: PluginManagerPage_module_css_default.status,
						children: t("partsEmpty")
					}) : null,
					rows.length > ROW_FILTER_THRESHOLD ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Input, {
						type: "search",
						className: PluginManagerPage_module_css_default.partsFilter,
						placeholder: t("partsFilter"),
						"aria-label": t("partsFilter"),
						value: filter,
						onChange: (event) => {
							setFilter(event.target.value);
						}
					}) : null,
					rows.length > 0 && shown.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: PluginManagerPage_module_css_default.status,
						children: t("partsFilterEmpty")
					}) : null,
					shown.length === 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
						className: PluginManagerPage_module_css_default.rows,
						children: shown.map(({ row, title, description }) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
							className: PluginManagerPage_module_css_default.row,
							"data-plugin-row": row.entryId ?? row.rowId,
							...row.phase === "failed" ? { "data-state": "failed" } : row.enabled ? {} : { "data-state": "off" },
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: PluginManagerPage_module_css_default.rowLine,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: PluginManagerPage_module_css_default.rowIcon,
										"aria-hidden": "true",
										children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(PackageArtwork, {
											src: row.meta?.icon,
											row: true
										}, row.meta?.icon)
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: PluginManagerPage_module_css_default.rowMain,
										children: [
											configure?.has(row) === true ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
												type: "button",
												className: PluginManagerPage_module_css_default.rowOpen,
												"aria-label": t("configureRow", { name: title }),
												onClick: () => {
													configure.open(row);
												},
												children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													className: PluginManagerPage_module_css_default.rowId,
													children: title
												}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconChevronRightOutlineRegular, {
													className: PluginManagerPage_module_css_default.rowOpenIcon,
													"aria-hidden": "true"
												})]
											}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: PluginManagerPage_module_css_default.rowId,
												children: title
											}),
											description === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: PluginManagerPage_module_css_default.rowModule,
												children: description
											}),
											title === row.rowId ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", {
												className: PluginManagerPage_module_css_default.rowModule,
												children: row.rowId
											}),
											title === row.moduleName ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", {
												className: PluginManagerPage_module_css_default.rowModule,
												children: row.moduleName
											})
										]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
										className: PluginManagerPage_module_css_default.rowState,
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.StateDot, { state: rowDotState(row) }), rowStateText(row, t)]
									}),
									toggle === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(RowSwitch, {
										row,
										title,
										t,
										busy: toggle.busy(row),
										onChange: (enabled) => {
											toggle.onSetEnabled(row, enabled);
										}
									})
								]
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(MetadataError, {
								error: row.meta?.error,
								t
							})]
						}, row.rowId))
					})
				]
			});
		}
		/**
		* A bundle's enable switch on its card and its page: locked, saying why, for
		* one the Host protects; off and locked for one it cannot read.
		*/
		function EnableSwitch({ pkg, title, t, busy, onSetEnabled }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Switch, {
				checked: pkg.enabled,
				label: t("enableToggle", { name: title }),
				disabled: busy || pkg.readOnlyReason !== void 0 || !pkg.enabled && pkg.error !== void 0,
				...pkg.readOnlyReason === void 0 ? {} : { title: managementText({ code: pkg.readOnlyReason }, t) },
				onChange: onSetEnabled
			});
		}
		/** The status one card carries: running, off, or a problem the Host reported. */
		function packageStatus(pkg) {
			if (pkg.error !== void 0) return "problem";
			return pkg.enabled ? "running" : "disabled";
		}
		/** The head every card shares: the artwork, the name that opens the page beside its tags, its one-liner, and what sits at the end. */
		function CardHead({ title, t, onOpen, icon, tags, description, end }) {
			const descriptionId = (0, react.useId)();
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: PluginManagerPage_module_css_default.cardHead,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: PluginManagerPage_module_css_default.cardIcon,
						"aria-hidden": "true",
						children: icon
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: PluginManagerPage_module_css_default.cardMain,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: PluginManagerPage_module_css_default.titleRow,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: `${PluginManagerPage_module_css_default.cardTitle} ${PluginManagerPage_module_css_default.cardOpen}`,
								"aria-label": t("openDetail", { name: title }),
								"aria-describedby": description === void 0 ? void 0 : descriptionId,
								onClick: onOpen,
								children: title
							}), tags]
						}), description === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: PluginManagerPage_module_css_default.cardDesc,
							id: descriptionId,
							children: description
						})]
					}),
					end === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: PluginManagerPage_module_css_default.cardEnd,
						children: end
					})
				]
			});
		}
		/** The top every page shares: the crumb that leads back, then the icon with the page's actions at its right. */
		function DetailTop({ crumbLabel, crumbText, onBack, icon, actions }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
				type: "button",
				className: PluginManagerPage_module_css_default.crumb,
				"aria-label": crumbLabel,
				onClick: onBack,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconChevronDownOutlineRegular, {
					className: PluginManagerPage_module_css_default.crumbIcon,
					"aria-hidden": "true"
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: crumbText })]
			}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: PluginManagerPage_module_css_default.detailHead,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: PluginManagerPage_module_css_default.cardIcon,
					"aria-hidden": "true",
					children: icon
				}), actions]
			})] });
		}
		/** One package as a card that opens its page: its name, its one-liner, its tags, and its bundle switch. */
		function PackageCard({ pkg, t, resolveText, busy, highlighted, onOpen, onSetEnabled }) {
			const { title, description, beta } = packageText(pkg, resolveText);
			const status = packageStatus(pkg);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
				className: `${PluginManagerPage_module_css_default.card} ${PluginManagerPage_module_css_default.cardLink}`,
				"data-plugin-package": pkg.name,
				"data-plugin-status": status,
				...highlighted ? { "data-plugin-highlight": "" } : {},
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(CardHead, {
					title,
					t,
					onOpen,
					icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(PackageArtwork, { src: pkg.meta?.icon }, pkg.meta?.icon),
					tags: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [beta ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tag, {
						className: PluginManagerPage_module_css_default.statusTag,
						tone: "info",
						children: t("statusBeta")
					}) : null, status === "problem" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tag, {
						className: PluginManagerPage_module_css_default.statusTag,
						tone: "danger",
						children: t("statusProblem")
					}) : null] }),
					description,
					end: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(EnableSwitch, {
						pkg,
						title,
						t,
						busy,
						onSetEnabled
					})
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(MetadataError, {
					error: pkg.meta?.error,
					t
				})]
			});
		}
		/**
		* One official plugin as a card that opens its page: its icon, its title from
		* the registration, and the one-liner the entry renders in its summary view.
		*/
		function ItemCard({ item, t, onOpen, renderSlot }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("li", {
				className: `${PluginManagerPage_module_css_default.card} ${PluginManagerPage_module_css_default.cardLink}`,
				"data-plugin-item": item.id,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(CardHead, {
					title: item.label,
					t,
					onOpen,
					icon: itemArtwork(item.id),
					description: renderSlot("bkmsPlugins.item", { view: "summary" }, { only: item.id })
				})
			});
		}
		/** One row as the detail slots see it. */
		function rowRef(row) {
			return {
				rowId: row.rowId,
				moduleName: row.moduleName,
				enabled: row.enabled
			};
		}
		/** One bundle as the detail slots see it. */
		function packageRef(pkg) {
			return {
				name: pkg.name,
				...pkg.version === void 0 ? {} : { version: pkg.version },
				installed: pkg.installed,
				enabled: pkg.enabled,
				rows: pkg.rows.map(rowRef)
			};
		}
		/**
		* An official plugin's page: the crumb back to the cards, its icon with the
		* contributed actions, its title with the contributed badges over its
		* one-liner, the form the entry renders, and the contributed sections.
		*/
		function ItemDetail({ item, t, onBack, renderSlot, form }) {
			const subject = {
				kind: "item",
				id: item.id
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: PluginManagerPage_module_css_default.detail,
				"data-plugin-item-detail": item.id,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(DetailTop, {
						crumbLabel: t("backToList"),
						crumbText: t("crumbRoot"),
						onBack,
						icon: itemArtwork(item.id),
						actions: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: PluginManagerPage_module_css_default.detailActions,
							children: renderSlot("bkmsPlugins.detail.actions", { subject })
						})
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: PluginManagerPage_module_css_default.detailMain,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: PluginManagerPage_module_css_default.titleRow,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
								className: PluginManagerPage_module_css_default.detailTitle,
								children: item.label
							}), renderSlot("bkmsPlugins.detail.badge", { subject })]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: PluginManagerPage_module_css_default.detailDesc,
							children: renderSlot("bkmsPlugins.item", { view: "summary" }, { only: item.id })
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: PluginManagerPage_module_css_default.detailSections,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("section", {
							className: PluginManagerPage_module_css_default.detailSection,
							"data-plugin-config": true,
							children: renderSlot("bkmsPlugins.item", {
								view: "page",
								form
							}, { only: item.id })
						}), renderSlot("bkmsPlugins.detail.section", { subject })]
					})
				]
			});
		}
		/**
		* A row's configuration page keeps its technical identity beside local package
		* text and the form supplied by its configuration entry.
		*/
		function RowDetail({ pkg, row, t, resolveText, onBack, renderSlot, form }) {
			const { title } = packageText(pkg, resolveText);
			const { title: rowTitle, description } = rowText(row, resolveText);
			const key = rowConfigKey(pkg.name, row.rowId);
			const subject = {
				kind: "row",
				pkg: packageRef(pkg),
				row: rowRef(row)
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: PluginManagerPage_module_css_default.detail,
				"data-plugin-row-detail": key,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(DetailTop, {
						crumbLabel: t("backToPackage", { name: title }),
						crumbText: title,
						onBack,
						icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(PackageArtwork, {
							src: row.meta?.icon,
							row: true,
							size: CARD_ARTWORK_SIZE
						}, row.meta?.icon),
						actions: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: PluginManagerPage_module_css_default.detailActions,
							children: renderSlot("bkmsPlugins.detail.actions", { subject })
						})
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: PluginManagerPage_module_css_default.detailMain,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: PluginManagerPage_module_css_default.titleRow,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
									className: PluginManagerPage_module_css_default.detailTitle,
									children: rowTitle
								}), renderSlot("bkmsPlugins.detail.badge", { subject })]
							}),
							rowTitle === row.rowId ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: PluginManagerPage_module_css_default.detailName,
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", { children: row.rowId })
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: PluginManagerPage_module_css_default.detailName,
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", { children: row.moduleName })
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: PluginManagerPage_module_css_default.detailDesc,
								children: description ?? renderSlot("bkmsPlugins.row.config", { view: "summary" }, { entryKey: key })
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(MetadataError, {
						error: row.meta?.error,
						t
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: PluginManagerPage_module_css_default.detailSections,
						"data-plugin-config": true,
						children: [renderSlot("bkmsPlugins.row.config", {
							view: "page",
							form
						}, { entryKey: key }), renderSlot("bkmsPlugins.detail.section", { subject })]
					})
				]
			});
		}
		/**
		* One package's page: the crumb back to the list; its icon with its switch
		* and, for a package the profile installed, uninstall; its title beside its
		* version tag, its beta tag, and its problem tag; the package name the title
		* stands for, which is what installs it elsewhere; its one-liner; the Host's
		* problem when it reports one; the configuration the bundle registered for
		* itself; and its rows with their switches and configure controls.
		*/
		function PackageDetail({ pkg, t, resolveText, busy, rowBusy, configured, configure, renderSlot, onBack, onSetEnabled, onUninstall, onSetRowEnabled }) {
			const { title, description, beta } = packageText(pkg, resolveText);
			const status = packageStatus(pkg);
			const subject = {
				kind: "bundle",
				pkg: packageRef(pkg)
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: PluginManagerPage_module_css_default.detail,
				"data-plugin-detail": pkg.name,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(DetailTop, {
						crumbLabel: t("backToList"),
						crumbText: t("crumbRoot"),
						onBack,
						icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(PackageArtwork, { src: pkg.meta?.icon }, pkg.meta?.icon),
						actions: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: PluginManagerPage_module_css_default.detailActions,
							children: [
								renderSlot("bkmsPlugins.detail.actions", { subject }),
								pkg.installed ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
									variant: "outline",
									size: "sm",
									className: PluginManagerPage_module_css_default.danger,
									icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconTrashOutlineRegular, { size: 13 }),
									"aria-label": t("uninstallLabel", { name: title }),
									disabled: busy || pkg.readOnlyReason !== void 0,
									onClick: onUninstall,
									children: t("uninstall")
								}) : null,
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(EnableSwitch, {
									pkg,
									title,
									t,
									busy,
									onSetEnabled
								})
							]
						})
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: PluginManagerPage_module_css_default.detailMain,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: PluginManagerPage_module_css_default.titleRow,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
										className: PluginManagerPage_module_css_default.detailTitle,
										children: title
									}),
									pkg.version === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tag, {
										className: PluginManagerPage_module_css_default.versionTag,
										tone: "neutral",
										children: t("versionTag", { version: pkg.version })
									}),
									beta ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tag, {
										className: PluginManagerPage_module_css_default.statusTag,
										tone: "info",
										children: t("statusBeta")
									}) : null,
									status === "problem" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tag, {
										className: PluginManagerPage_module_css_default.statusTag,
										tone: "danger",
										children: t("statusProblem")
									}) : null,
									renderSlot("bkmsPlugins.detail.badge", { subject })
								]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: PluginManagerPage_module_css_default.detailName,
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", {
									"data-plugin-name": true,
									children: pkg.name
								})
							}),
							description === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: PluginManagerPage_module_css_default.detailDesc,
								children: description
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(MetadataError, {
						error: pkg.meta?.error,
						t
					}),
					pkg.error === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
						className: PluginManagerPage_module_css_default.reason,
						role: "status",
						children: [
							t("reasonLabel"),
							": ",
							managementText(pkg.error, t)
						]
					}),
					pkg.readOnlyReason === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: PluginManagerPage_module_css_default.reason,
						role: "status",
						children: managementText({ code: pkg.readOnlyReason }, t)
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: PluginManagerPage_module_css_default.detailSections,
						children: [
							configured ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("section", {
								className: PluginManagerPage_module_css_default.detailSection,
								"data-plugin-config": true,
								children: renderSlot("bkmsPlugins.bundle.config", { view: "page" }, { entryKey: pkg.name })
							}) : null,
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(RowsSection, {
								rows: pkg.rows,
								t,
								resolveText,
								toggle: pkg.enabled ? {
									busy: (row) => busy || rowBusy(row),
									onSetEnabled: onSetRowEnabled
								} : void 0,
								configure
							}),
							renderSlot("bkmsPlugins.detail.section", { subject })
						]
					})
				]
			});
		}
		/** Output lines an install run's terminal shows before its middle folds: the first and last six of a long pnpm log. */
		const INSTALL_TERMINAL_LINES = 12;
		/** The install terminal's display copy, from the tab's dictionary. */
		function terminalLabels(t) {
			return {
				/* v8 ignore next -- the Host reports a killed pnpm as a null exit code, never a signal name; the label interface needs one */
				signal: (signal) => t("terminalSignal", { signal }),
				exitCode: (code) => t("terminalExitCode", { code: String(code) }),
				noExitCode: t("terminalNoExitCode"),
				running: t("terminalRunning"),
				failed: t("terminalFailed"),
				done: t("terminalDone"),
				copy: t("terminalCopy"),
				copied: t("terminalCopied"),
				noOutput: t("terminalNoOutput"),
				collapseAria: t("terminalCollapseAria"),
				collapse: t("terminalCollapse"),
				expandAria: (hidden) => t("terminalExpandAria", { n: String(hidden) }),
				expand: (hidden) => t("terminalExpand", { n: String(hidden) })
			};
		}
		/** The sentence under the field for a spec the check refused. */
		const INPUT_PROBLEM_KEYS = {
			"invalid-spec": "installProblemInvalid",
			"already-installed": "installProblemInstalled",
			"not-found": "installProblemNotFound",
			"not-a-package": "installProblemNotPackage",
			"not-a-bundle": "installProblemNotBundle",
			"network": "installProblemNetwork",
			"unknown": "installProblemUnknown"
		};
		/** The spec forms the install guide shows, each with an example the person can drop into the field. */
		const GUIDE_EXAMPLES = [
			{
				key: "id",
				titleKey: "installGuideIdTitle",
				exampleKey: "installGuideIdExample",
				hintKey: "installGuideIdHint"
			},
			{
				key: "git",
				titleKey: "installGuideGitTitle",
				exampleKey: "installGuideGitExample",
				hintKey: "installGuideGitHint"
			},
			{
				key: "path",
				titleKey: "installGuidePathTitle",
				exampleKey: "installGuidePathExample",
				hintKey: "installGuidePathHint"
			}
		];
		/** The one-line reading of a classified pnpm failure. */
		const FAILURE_KIND_KEYS = {
			"pnpm-missing": "installFailurePnpmMissing",
			"timeout": "installFailureTimeout",
			"not-found": "installFailureNotFound",
			"no-matching-version": "installFailureNoMatchingVersion",
			"network": "installFailureNetwork",
			"disk-full": "installFailureDiskFull",
			"permission": "installFailurePermission",
			"build-blocked": "installFailureBuildBlocked",
			"integrity": "installFailureIntegrity",
			"unknown": "installFailureGeneric"
		};
		/** The heading of each screen past the spec. */
		const SCREEN_TITLE_KEYS = {
			starting: "installStarting",
			running: "installingTitle",
			cancelling: "installCancelling",
			applying: "installApplying",
			unconfirmed: "installUnconfirmedTitle",
			unknown: "installUnknownTitle",
			done: "installedTitle",
			failed: "installFailedTitle"
		};
		/** What the spec's kind reads as when the package carries no description of its own. */
		const SUBJECT_KIND_KEYS = {
			registry: void 0,
			path: "installSubjectPath",
			git: "installSubjectGit",
			tarball: "installSubjectTarball"
		};
		/** The registries asked, by name, in the dictionary's list form. */
		function registryList(registries, t, resolved) {
			return registries.map((registry) => registryText(registry, t, resolved).name).join(t("registryListSeparator"));
		}
		/** An option's label: the registry's name with the host it names, unless the host is the name. */
		function registryOption(registry, t, resolved) {
			const { name, host } = registryText(registry, t, resolved);
			return name === host ? name : t("registryWithHost", {
				name,
				host
			});
		}
		/**
		* The failed screen's one line: a pnpm failure by its kind, a refusal by its
		* code, any other failure in the Host's words; the run's output stays behind the details.
		* A run the Host laid at the spec's own host says so; one it laid at a registry
		* names every registry asked when there were several.
		*/
		function failureText(failure, t, install) {
			if (failure === null) return t("installFailureGeneric");
			if (failure.code === "incompatible-version") return managementText({
				code: failure.code,
				...failure.incompatible === void 0 ? {} : { incompatible: failure.incompatible }
			}, t);
			if (failure.kind === "build-blocked" && !failure.pendingBuilds?.length) return t("installFailureBuildBlockedManual");
			const host = install?.subject?.host;
			if (failure.failedAt === "spec-host" && host !== void 0) return t("installFailureNetworkHost", { host });
			const asked = install?.attempts?.registries ?? [];
			if (failure.failedAt === "registry" && (failure.kind === "network" || failure.kind === "timeout") && asked.length > 1) return t("installFailureNetworkAll", { registries: registryList(asked, t, install?.registries?.resolved ?? null) });
			if (failure.kind !== void 0) return t(FAILURE_KIND_KEYS[failure.kind]);
			if (failure.code !== void 0) return managementText({
				code: failure.code,
				diagnostic: failure.reason
			}, t);
			return failure.reason === "" ? t("installFailureGeneric") : failure.reason;
		}
		/** The package the install is about: its name, one-liner, and version, as the Host read them before installing. */
		function SubjectCard({ subject, t }) {
			const title = subject.name ?? subject.spec;
			const kindKey = SUBJECT_KIND_KEYS[subject.kind];
			const description = subject.description ?? (kindKey === void 0 ? void 0 : t(kindKey));
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: PluginManagerPage_module_css_default.subject,
				"data-install-subject": subject.spec,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: PluginManagerPage_module_css_default.subjectName,
						children: title
					}),
					description === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: PluginManagerPage_module_css_default.subjectDesc,
						children: description
					}),
					subject.version === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: PluginManagerPage_module_css_default.subjectMeta,
						children: t("installVersion", { version: subject.version })
					})
				]
			});
		}
		/**
		* The install dialog: the spec and its check, then the installing, installed,
		* and failed screens over the same subject card. A failed run that left
		* install scripts undecided shows them for approval in place of plain retry.
		*/
		function InstallDialog({ install, t, onClose, onEditSpec, onRun, onCancel, onReconcile, onToggleDetails, onEnableNow, onApproveBuilds, onToggleRegistry, onChooseRegistry, onChangeRegistry, onUseGithubMirror }) {
			const errorId = (0, react.useId)();
			const guideId = (0, react.useId)();
			const approvalId = (0, react.useId)();
			const registryId = (0, react.useId)();
			const registryErrorId = (0, react.useId)();
			const [guideOpen, setGuideOpen] = (0, react.useState)(false);
			const { phase } = install;
			const registryToggleRef = (0, react.useRef)(null);
			const registryPanelRef = (0, react.useRef)(null);
			const registryShown = install.registryOpen && phase === "idle";
			const registryPosition = (0, _deepseek_ai_dsh_client_ui_primitives.useAnchoredPosition)({
				open: registryShown,
				anchorRef: registryToggleRef,
				panelRef: registryPanelRef,
				align: "end",
				gap: 6,
				margin: 12
			});
			(0, _deepseek_ai_dsh_client_ui_primitives.useDismissOnOutsidePointer)(registryToggleRef, registryShown, onToggleRegistry, registryPanelRef);
			(0, react.useEffect)(() => {
				if (!registryShown) return;
				const onKeyDown = (event) => {
					if (event.key !== "Escape") return;
					event.stopPropagation();
					onToggleRegistry();
				};
				document.addEventListener("keydown", onKeyDown, true);
				return () => {
					document.removeEventListener("keydown", onKeyDown, true);
				};
			}, [registryShown, onToggleRegistry]);
			const archive = /^file:.*\.(?:tgz|tar\.gz)$/i.test(install.spec);
			if (githubRecoveryRegistry(install) !== void 0) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Modal, {
				open: install.open,
				onClose,
				title: t(install.failure?.kind === "timeout" ? "installGithubTimeoutTitle" : "installGithubFailedTitle"),
				closeLabel: t("close"),
				description: t("installGithubFailedDescription"),
				footer: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
					variant: "outline",
					onClick: onClose,
					children: t("cancel")
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
					variant: "primary",
					autoFocus: true,
					onClick: onUseGithubMirror,
					children: t("installUseGithubMirror")
				})] })
			});
			if (phase === "idle" || phase === "checking") {
				const checking = phase === "checking";
				const empty = install.spec.trim() === "";
				const choice = install.registry;
				const resolved = install.registries?.resolved ?? null;
				const chosenTitle = choice.kind === "custom" ? t("registryCustom") : registryText(choice.registry, t, resolved).name;
				const inputProblem = install.inputError;
				const askedByCheck = inputProblem?.registries ?? [];
				const inputSentence = inputProblem === null ? null : inputProblem.problem === "network" && askedByCheck.length > 1 ? t("installProblemNetworkAll", { registries: registryList(askedByCheck, t, resolved) }) : t(INPUT_PROBLEM_KEYS[inputProblem.problem], { reason: inputProblem.reason });
				return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Modal, {
					open: install.open,
					onClose,
					title: t(archive ? "installArchiveTitle" : "installTitle"),
					closeLabel: t("close"),
					...install.mirrorRecovery ? {} : { description: t(archive ? "installArchiveDescription" : "installDescription") },
					className: PluginManagerPage_module_css_default.installDialog,
					contentClassName: PluginManagerPage_module_css_default.installContent,
					footer: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(_deepseek_ai_dsh_client_ui_primitives.Button, {
						variant: "primary",
						className: PluginManagerPage_module_css_default.wide,
						disabled: checking || empty,
						"aria-busy": checking,
						onClick: onRun,
						children: [checking ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.StateDot, { state: "ongoing" }) : null, t(checking ? "installChecking" : "installRun")]
					}),
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: PluginManagerPage_module_css_default.installBody,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: PluginManagerPage_module_css_default.installField,
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									type: "text",
									autoFocus: install.mirrorRecovery === true,
									value: install.spec,
									placeholder: t("installSpecPlaceholder"),
									disabled: checking,
									"aria-label": t(install.mirrorRecovery ? "installPackageLabel" : "installSpecLabel"),
									"aria-invalid": install.inputError !== null,
									"aria-describedby": install.inputError === null ? void 0 : errorId,
									onChange: (event) => {
										onEditSpec(event.currentTarget.value);
									},
									onKeyDown: (event) => {
										if (event.key === "Enter" && !empty && !checking) onRun();
									}
								})
							}),
							inputSentence === null ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								id: errorId,
								className: PluginManagerPage_module_css_default.inputError,
								role: "alert",
								children: inputSentence
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: PluginManagerPage_module_css_default.optionsRow,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
									type: "button",
									className: PluginManagerPage_module_css_default.guideToggle,
									"aria-expanded": guideOpen,
									"aria-controls": guideId,
									onClick: () => {
										setGuideOpen((open) => !open);
									},
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconChevronDownOutlineRegular, {
										className: PluginManagerPage_module_css_default.guideChevron,
										"aria-hidden": "true"
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t(guideOpen ? "installGuideHide" : "installGuideToggle") })]
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
									ref: registryToggleRef,
									type: "button",
									className: PluginManagerPage_module_css_default.registryToggle,
									"aria-expanded": install.registryOpen,
									"aria-controls": registryId,
									"aria-haspopup": "dialog",
									disabled: checking,
									onClick: onToggleRegistry,
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("registryToggle") }),
										" ",
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: PluginManagerPage_module_css_default.registryChosen,
											children: chosenTitle
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconChevronDownOutlineRegular, {
											className: PluginManagerPage_module_css_default.guideChevron,
											"aria-hidden": "true"
										})
									]
								})]
							}),
							guideOpen ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								id: guideId,
								className: PluginManagerPage_module_css_default.guide,
								"data-install-guide": true,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("ol", {
									className: PluginManagerPage_module_css_default.guideList,
									children: GUIDE_EXAMPLES.map(({ key, titleKey, exampleKey, hintKey }, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
										className: PluginManagerPage_module_css_default.guideItem,
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: PluginManagerPage_module_css_default.guideIndex,
												"aria-hidden": "true",
												children: index + 1
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
												className: PluginManagerPage_module_css_default.guideMain,
												children: [
													/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
														className: PluginManagerPage_module_css_default.guideTitle,
														children: t(titleKey)
													}),
													/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
														className: PluginManagerPage_module_css_default.guideHint,
														children: t(hintKey)
													}),
													/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
														className: PluginManagerPage_module_css_default.guideExample,
														children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
															className: PluginManagerPage_module_css_default.guideExampleLabel,
															children: t("installGuideExampleLabel")
														}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", { children: t(exampleKey) })]
													})
												]
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
												variant: "outline",
												size: "sm",
												"aria-label": t("installGuideFillAria", { example: t(exampleKey) }),
												disabled: checking,
												onClick: () => {
													onEditSpec(t(exampleKey));
												},
												children: t("installGuideFill")
											})
										]
									}, key))
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
									className: PluginManagerPage_module_css_default.guideSafety,
									role: "note",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconWarningOutlineRegular, {
										size: 14,
										"aria-hidden": "true"
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("installGuideSafety") })]
								})]
							}) : null,
							registryShown ? (0, react_dom.createPortal)(/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("fieldset", {
								ref: registryPanelRef,
								id: registryId,
								className: PluginManagerPage_module_css_default.registry,
								style: registryPosition ?? {
									visibility: "hidden",
									left: 0,
									top: 0
								},
								"data-install-registry": true,
								"aria-label": t("registryLegend"),
								children: [offeredRegistries(install.registries).map((registry) => {
									const checked = choice.kind === "offered" && choice.registry === registry;
									return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
										className: PluginManagerPage_module_css_default.registryOption,
										"data-checked": checked,
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
											type: "radio",
											name: registryId,
											checked,
											onChange: () => {
												onChooseRegistry({
													kind: "offered",
													registry
												});
											}
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: PluginManagerPage_module_css_default.registryTitle,
											children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: registryOption(registry, t, resolved) })
										})]
									}, registry ?? "");
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: PluginManagerPage_module_css_default.registryOption,
									"data-checked": choice.kind === "custom",
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
											className: PluginManagerPage_module_css_default.registryCustomPick,
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
												type: "radio",
												name: registryId,
												checked: choice.kind === "custom",
												onChange: () => {
													onChooseRegistry({
														kind: "custom",
														url: ""
													});
												}
											}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: PluginManagerPage_module_css_default.registryTitle,
												children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("registryCustom") })
											})]
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
											type: "text",
											className: PluginManagerPage_module_css_default.registryCustomField,
											"aria-label": t("registryCustom"),
											placeholder: t("registryCustomPlaceholder"),
											value: choice.kind === "custom" ? choice.url : "",
											disabled: choice.kind !== "custom",
											"aria-invalid": install.registryError,
											"aria-describedby": install.registryError ? registryErrorId : void 0,
											onChange: (event) => {
												onChooseRegistry({
													kind: "custom",
													url: event.currentTarget.value
												});
											},
											onKeyDown: (event) => {
												if (event.key === "Enter" && !empty) onRun();
											}
										}),
										install.registryError ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
											id: registryErrorId,
											className: PluginManagerPage_module_css_default.inputError,
											role: "alert",
											children: t("registryCustomInvalid")
										}) : null,
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: PluginManagerPage_module_css_default.registryHint,
											children: t("registryCustomHint")
										})
									]
								})]
							}), document.body) : null
						]
					})
				});
			}
			const heading = t(SCREEN_TITLE_KEYS[phase]);
			const pending = isInstallPending(phase);
			const cancellable = phase === "starting" || phase === "running" || phase === "unconfirmed";
			const stoppable = cancellable || phase === "failed" || phase === "unknown";
			const failure = install.failure;
			const uncertainty = failure?.uncertainty;
			const uncertaintyText = failure?.uncertainty === void 0 ? null : t({
				result: "installResultUnconfirmed",
				cancellation: phase === "applying" ? "installApplyingCancellationError" : "installCancelUnconfirmed",
				acceptance: "installAwaitingAcceptance"
			}[failure.uncertainty], { reason: failure.reason });
			const pendingBuilds = phase === "failed" ? install.failure?.pendingBuilds ?? [] : [];
			const approvable = pendingBuilds.length > 0;
			const firstRun = install.runs[0];
			const asked = install.attempts !== null && install.attempts.registries.length > 1 ? install.attempts : null;
			const current = asked === null ? void 0 : asked.registries.at(-1);
			const previous = asked === null ? void 0 : asked.registries.at(-2);
			const resolved = install.registries?.resolved ?? null;
			const attemptLine = pending && asked !== null && current !== void 0 && previous !== void 0 ? t("installAttempt", {
				previous: registryText(previous, t, resolved).name,
				registry: registryText(current, t, resolved).name,
				index: String(asked.registries.length),
				total: String(asked.total)
			}) : null;
			const changeable = phase === "failed" && !approvable && install.failure?.failedAt === "registry";
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Modal, {
				open: install.open,
				onClose,
				title: heading,
				headless: true,
				className: PluginManagerPage_module_css_default.installDialog,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: PluginManagerPage_module_css_default.wizard,
					"data-install-phase": phase,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: PluginManagerPage_module_css_default.wizardHead,
						children: [phase === "done" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
							type: "button",
							className: PluginManagerPage_module_css_default.wizardBack,
							"aria-label": t(pending ? "installCancelAndEdit" : "installEditAria"),
							disabled: !stoppable,
							onClick: onCancel,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconChevronLeftOutlineMedium, { "aria-hidden": "true" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t(pending ? "installCancelAndEdit" : "installEdit") })]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: PluginManagerPage_module_css_default.wizardClose,
							"aria-label": t(cancellable ? "installCloseCancels" : "close"),
							onClick: onClose,
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconCloseOutlineMedium, { size: 14 })
						})]
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: PluginManagerPage_module_css_default.wizardScroll,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: PluginManagerPage_module_css_default.wizardHero,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: PluginManagerPage_module_css_default.wizardIcon,
										"data-state": pending ? "ongoing" : phase === "done" ? "done" : "error",
										"aria-hidden": "true",
										children: pending ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.StateDot, {
											state: "ongoing",
											size: 28
										}) : phase === "done" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconCheckCircleFillRegular, { size: 28 }) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconWarningOutlineRegular, { size: 28 })
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
										className: PluginManagerPage_module_css_default.wizardTitle,
										role: phase === "failed" ? "alert" : "status",
										children: heading
									}),
									phase === "failed" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
										className: PluginManagerPage_module_css_default.wizardSub,
										children: failureText(install.failure, t, install)
									}) : null,
									attemptLine === null ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
										className: PluginManagerPage_module_css_default.wizardSub,
										children: attemptLine
									}),
									uncertaintyText === null ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
										className: PluginManagerPage_module_css_default.wizardSub,
										role: "alert",
										children: uncertaintyText
									}),
									phase === "unknown" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
										className: PluginManagerPage_module_css_default.wizardSub,
										children: t("installUnknownDescription")
									}) : null
								]
							}),
							install.subject === null ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SubjectCard, {
								subject: install.subject,
								t
							}),
							approvable ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
								className: PluginManagerPage_module_css_default.approval,
								role: "group",
								"aria-labelledby": approvalId,
								"data-install-approval": true,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
										id: approvalId,
										className: PluginManagerPage_module_css_default.approvalTitle,
										children: t("installApprovalTitle")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
										className: PluginManagerPage_module_css_default.approvalText,
										children: t("installApprovalDescription")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
										className: PluginManagerPage_module_css_default.approvalList,
										children: pendingBuilds.map((name) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("li", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", { children: name }) }, name))
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
										className: PluginManagerPage_module_css_default.approvalText,
										children: t("installApprovalConsequence")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
										className: PluginManagerPage_module_css_default.approvalCaution,
										children: t("installApprovalCaution")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
										variant: "primary",
										className: PluginManagerPage_module_css_default.wide,
										onClick: onApproveBuilds,
										children: t("installApproveAndRetry")
									})
								]
							}) : null,
							phase === "done" && install.installed !== null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: PluginManagerPage_module_css_default.result,
								role: "status",
								children: t("installDoneEnable")
							}) : null,
							phase === "done" && install.installed === null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: PluginManagerPage_module_css_default.result,
								role: "status",
								children: t("installDoneNothing")
							}) : null,
							phase === "done" && install.restartRequired ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: PluginManagerPage_module_css_default.resultWarn,
								role: "status",
								children: t("installDoneRestart")
							}) : null,
							phase === "done" && install.approvedBuilds.length > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: PluginManagerPage_module_css_default.result,
								role: "status",
								children: t("installDoneApproved", { names: install.approvedBuilds.join(", ") })
							}) : null,
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: PluginManagerPage_module_css_default.wizardFoot,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
										type: "button",
										className: PluginManagerPage_module_css_default.detailsToggle,
										"aria-expanded": install.detailsOpen,
										onClick: onToggleDetails,
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t(install.detailsOpen ? "installDetailsHide" : "installDetailsShow") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconChevronDownOutlineRegular, {
											className: PluginManagerPage_module_css_default.detailsChevron,
											"aria-hidden": "true"
										})]
									}),
									uncertainty === "result" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
										variant: "outline",
										size: "sm",
										className: PluginManagerPage_module_css_default.footAction,
										onClick: onReconcile,
										children: t("installReconcile")
									}) : null,
									pending ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
										variant: "outline",
										size: "sm",
										className: PluginManagerPage_module_css_default.footAction,
										disabled: !cancellable,
										onClick: onCancel,
										children: t(phase === "cancelling" ? "installCancelling" : "installCancel")
									}) : null,
									phase === "failed" && !approvable ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
										className: PluginManagerPage_module_css_default.wizardActions,
										children: [changeable ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
											variant: "outline",
											size: "sm",
											className: PluginManagerPage_module_css_default.footAction,
											onClick: onChangeRegistry,
											children: t("installChangeRegistry")
										}) : null, /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
											variant: "primary",
											size: "sm",
											className: PluginManagerPage_module_css_default.footAction,
											onClick: onRun,
											children: t("installRetry")
										})]
									}) : null
								]
							}),
							install.detailsOpen ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: PluginManagerPage_module_css_default.detailsBody,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									className: PluginManagerPage_module_css_default.installLocation,
									children: firstRun === void 0 ? t("terminalNoOutput") : t("installLocation", { dir: firstRun.cwd })
								}), install.runs.map((run, index) => {
									const registry = asked?.registries[index];
									return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: PluginManagerPage_module_css_default.run,
										children: [registry === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
											className: PluginManagerPage_module_css_default.attemptBadge,
											children: t("installAttemptBadge", {
												index: String(index + 1),
												registry: registryText(registry, t, resolved).name
											})
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.TerminalBlock, {
											command: run.command,
											output: run.output,
											running: run.exitCode === void 0,
											exitCode: run.exitCode,
											maxLines: INSTALL_TERMINAL_LINES,
											labels: {
												...terminalLabels(t),
												...phase === "cancelling" ? { failed: t("installCancelledShort") } : {}
											},
											className: PluginManagerPage_module_css_default.terminal
										})]
									}, run.jobId);
								})]
							}) : null,
							phase !== "done" ? null : install.installed !== null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
								variant: "primary",
								className: PluginManagerPage_module_css_default.wide,
								disabled: install.enabling,
								"aria-busy": install.enabling,
								onClick: onEnableNow,
								children: t("installEnableNow")
							}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
								variant: "primary",
								className: PluginManagerPage_module_css_default.wide,
								onClick: onClose,
								children: t("installClose")
							})
						]
					})]
				})
			});
		}
		/** The confirmation an uninstall waits on. */
		function ConfirmDialog({ name, t, onConfirm, onCancel }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Modal, {
				open: true,
				onClose: onCancel,
				title: t("confirmUninstallTitle", { name }),
				closeLabel: t("close"),
				description: t("confirmUninstallDescription"),
				footer: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
					variant: "outline",
					onClick: onCancel,
					children: t("cancel")
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
					variant: "primary",
					className: PluginManagerPage_module_css_default.dangerButton,
					onClick: onConfirm,
					children: t("confirmUninstall")
				})] })
			});
		}
		/** Render the plugin manager: the official plugins and installed bundles, their pages, the install dialog, and the confirmation. */
		function PluginManagerPage(props) {
			const { t, ensure, renderSlot, resolveText } = props;
			const configurations = props.useConfigurations((snapshot) => snapshot.view?.namespaces);
			const formFor = (id) => {
				if (!configurations?.some((view) => view.ns === id)) return void 0;
				const form = props.configForm(id);
				return {
					state: form.getSnapshot(),
					mutate: (ops, revision) => form.mutate(ops, revision)
				};
			};
			const state = props.usePluginManager((snapshot) => snapshot);
			const ledger = props.useConfigLedger((snapshot) => snapshot);
			const [view, setView] = (0, react.useState)({ kind: "list" });
			const [activation, setActivation] = (0, react.useState)(null);
			(0, react.useEffect)(() => {
				ensure();
			}, [ensure]);
			const { highlight, clearHighlight } = {
				highlight: state.highlight,
				clearHighlight: props.clearHighlight
			};
			(0, react.useEffect)(() => {
				if (highlight === null) return;
				const card = document.querySelector(`[data-plugin-package="${highlight}"]`);
				if (card !== null && typeof card.scrollIntoView === "function") card.scrollIntoView({
					block: "center",
					behavior: "smooth"
				});
				const timer = setTimeout(clearHighlight, HIGHLIGHT_MS);
				return () => {
					clearTimeout(timer);
				};
			}, [highlight, clearHighlight]);
			const noticeLine = state.notice === null ? null : noticeText(state.notice, t);
			const listed = state.packages.filter((pkg) => !BUILTIN_PROFILE_BUNDLES.has(pkg.name) && (pkg.installed || pkg.optional || pkg.error !== void 0));
			const mine = listed.filter((pkg) => pkg.installed || !pkg.optional);
			const official = listed.filter((pkg) => pkg.optional && !pkg.installed);
			const loaded = state.status === "ready" || state.status === "error";
			const openPkg = view.kind === "package" || view.kind === "row" ? listed.find((pkg) => pkg.name === view.name) : void 0;
			const openItem = view.kind === "item" ? ledger.items.find((item) => item.id === view.id) : void 0;
			const openRow = view.kind === "row" && openPkg !== void 0 ? openPkg.rows.find((row) => row.rowId === view.rowId) : void 0;
			const showsCards = openPkg === void 0 && openItem === void 0;
			const activated = listed.find((pkg) => pkg.name === activation && pkg.enabled && !state.busy.includes(pkg.name));
			const setRowEnabled = (row, enabled) => {
				/* v8 ignore next -- a row without a live entry has its switch disabled */
				if (row.entryId !== void 0) props.setRowEnabled(row.entryId, enabled);
			};
			const configure = (pkg) => ({
				has: (row) => ledger.rows.has(rowConfigKey(pkg.name, row.rowId)),
				open: (row) => {
					setView({
						kind: "row",
						name: pkg.name,
						rowId: row.rowId
					});
				}
			});
			const packageCard = (pkg) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(PackageCard, {
				pkg,
				t,
				resolveText,
				busy: state.busy.includes(pkg.name),
				highlighted: state.highlight === pkg.name,
				onOpen: () => {
					setActivation(null);
					setView({
						kind: "package",
						name: pkg.name
					});
				},
				onSetEnabled: (enabled) => {
					setActivation(enabled ? pkg.name : null);
					props.setEnabled(pkg.name, enabled);
				}
			}, pkg.name);
			const officialCards = [...official.map(packageCard), ...ledger.items.map((item) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ItemCard, {
				item,
				t,
				renderSlot,
				onOpen: () => {
					setView({
						kind: "item",
						id: item.id
					});
				}
			}, `item:${item.id}`))];
			const renderGroup = (id, heading, cards) => cards.length === 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: PluginManagerPage_module_css_default.group,
				"data-plugin-scope": "global",
				"data-plugin-group": id,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: PluginManagerPage_module_css_default.groupHead,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
						className: PluginManagerPage_module_css_default.groupTitle,
						children: heading
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: PluginManagerPage_module_css_default.count,
						"data-plugin-count": cards.length,
						children: cards.length
					})]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
					className: PluginManagerPage_module_css_default.cards,
					children: cards
				})]
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: PluginManagerPage_module_css_default.page,
				"data-plugin-panel": true,
				"aria-busy": state.status === "loading",
				children: [
					showsCards ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", {
						className: PluginManagerPage_module_css_default.pageHead,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h1", {
							className: PluginManagerPage_module_css_default.pageTitle,
							children: t("title")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: PluginManagerPage_module_css_default.pageIntro,
							children: t("intro")
						})] }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: PluginManagerPage_module_css_default.toolbar,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: PluginManagerPage_module_css_default.iconButton,
								"aria-label": t("refresh"),
								title: t("refresh"),
								disabled: !loaded,
								onClick: props.refresh,
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: PluginManagerPage_module_css_default.iconWrap,
									"aria-hidden": "true",
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconRefreshOutlineRegular, {})
								})
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
								variant: "primary",
								size: "sm",
								className: PluginManagerPage_module_css_default.addButton,
								icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconPlusOutlineRegular, { size: 13 }),
								disabled: !loaded,
								onClick: props.openInstall,
								children: t(state.install.requestId === void 0 ? "addPlugin" : "installViewTask")
							})]
						})]
					}) : null,
					showsCards && state.status === "loading" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
						className: `${PluginManagerPage_module_css_default.status} ${PluginManagerPage_module_css_default.statusWithDot}`,
						role: "status",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.StateDot, { state: "ongoing" }), t("loading")]
					}) : null,
					showsCards && state.status === "unavailable" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
						className: `${PluginManagerPage_module_css_default.status} ${PluginManagerPage_module_css_default.statusWithDot}`,
						role: "status",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.StateDot, { state: "idle" }), t("unavailable")]
					}) : null,
					state.notice === null || noticeLine === null ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Toast, {
						text: noticeLine,
						icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconWarningOutlineRegular, {}),
						holdMs: toastHoldMs(noticeLine),
						onDone: props.dismissNotice
					}, state.notice.seq),
					!showsCards && state.status === "error" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: PluginManagerPage_module_css_default.failure,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
							className: PluginManagerPage_module_css_default.statusWithDot,
							role: "alert",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.StateDot, { state: "error" }), t("error")]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
							variant: "outline",
							size: "sm",
							onClick: props.refresh,
							children: t("retry")
						})]
					}) : null,
					loaded && openPkg !== void 0 && openRow !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(RowDetail, {
						pkg: openPkg,
						row: openRow,
						form: formFor(openRow.rowId),
						t,
						resolveText,
						renderSlot,
						onBack: () => {
							setView({
								kind: "package",
								name: openPkg.name
							});
						}
					}) : null,
					loaded && openPkg !== void 0 && openRow === void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(PackageDetail, {
						pkg: openPkg,
						t,
						resolveText,
						busy: state.busy.includes(openPkg.name),
						rowBusy: (row) => row.entryId !== void 0 && state.busy.includes(rowKey(row.entryId)),
						configured: ledger.bundles.has(openPkg.name),
						configure: configure(openPkg),
						renderSlot,
						onBack: () => {
							setView({ kind: "list" });
						},
						onSetEnabled: (enabled) => {
							props.setEnabled(openPkg.name, enabled);
						},
						onUninstall: () => {
							props.uninstall(openPkg.name);
						},
						onSetRowEnabled: setRowEnabled
					}) : null,
					loaded && openItem !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ItemDetail, {
						form: formFor(openItem.id),
						item: openItem,
						t,
						renderSlot,
						onBack: () => {
							setView({ kind: "list" });
						}
					}) : null,
					loaded && showsCards ? officialCards.length === 0 && mine.length === 0 && state.status !== "error" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: PluginManagerPage_module_css_default.empty,
						children: t("empty")
					}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
						renderGroup("official", t("officialTitle"), officialCards),
						renderGroup("bundles", t("bundlesTitle"), mine.map(packageCard)),
						state.status === "error" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: PluginManagerPage_module_css_default.failure,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
								className: PluginManagerPage_module_css_default.statusWithDot,
								role: "alert",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.StateDot, { state: "error" }), t("error")]
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
								variant: "outline",
								size: "sm",
								onClick: props.refresh,
								children: t("retry")
							})]
						}) : null
					] }) : null,
					showsCards && activated !== void 0 && !state.install.open ? renderSlot("bkmsPlugins.bundle.activation", {
						packageName: activated.name,
						onDismiss: () => {
							setActivation(null);
						},
						onOpenDetails: () => {
							setActivation(null);
							setView({
								kind: "package",
								name: activated.name
							});
						}
					}, { entryKey: activated.name }) : null,
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(InstallDialog, {
						install: state.install,
						t,
						onClose: props.closeInstall,
						onEditSpec: props.editInstallSpec,
						onRun: props.runInstall,
						onCancel: props.cancelInstall,
						onReconcile: props.reconcileInstall,
						onToggleDetails: props.toggleInstallDetails,
						onEnableNow: () => {
							setActivation(state.install.installed);
							props.enableInstalled();
						},
						onApproveBuilds: props.approveBuildsAndRetry,
						onToggleRegistry: props.toggleRegistryOptions,
						onChooseRegistry: props.chooseRegistry,
						onChangeRegistry: props.changeRegistry,
						onUseGithubMirror: props.useGithubMirror
					}),
					state.confirm === null ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ConfirmDialog, {
						name: packageText(state.packages.find((pkg) => pkg.name === state.confirm?.packageName) ?? { name: state.confirm.packageName }, resolveText).title,
						t,
						onConfirm: props.confirm,
						onCancel: props.cancelConfirm
					})
				]
			});
		}
		//#endregion
		//#region \0dsh-css:D:\git\AI\dsh-zq\sources\plugins\dsh-plugins\bkms-plugin-center\src\client\CenterPage.module.css.mjs
		const css$1 = ".vX7ura_shell{height:100%;min-height:0;color:var(--dsw-alias-label-primary);flex-direction:column;display:flex}.vX7ura_topbar{border-bottom:.5px solid var(--dsw-alias-border-l2);flex-wrap:wrap;justify-content:space-between;align-items:center;gap:16px;padding:14px clamp(24px,4vw,48px);display:flex}[data-platform=darwin] .vX7ura_topbar{padding-top:calc(14px + var(--dsh-frame-top-clearance,0px))}.vX7ura_brand{align-items:center;gap:10px;font-size:15px;font-weight:600;display:flex}.vX7ura_brandMark{color:#fff;background:var(--dsw-alias-state-business-primary,#4f6bed);border-radius:8px;place-items:center;width:28px;height:28px;display:grid}.vX7ura_segment{background:var(--dsw-alias-bg-layer-2);border-radius:10px;gap:2px;padding:3px;display:inline-flex}.vX7ura_segmentItem{height:30px;font:inherit;color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:0;border-radius:8px;align-items:center;gap:6px;padding:0 14px;font-size:13px;transition:background .12s,color .12s;display:inline-flex}.vX7ura_segmentItem:hover{color:var(--dsw-alias-label-primary)}.vX7ura_segmentItem[aria-selected=true]{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1);font-weight:500;box-shadow:0 1px 2px #0000001f}.vX7ura_count{text-align:center;color:#fff;background:var(--dsw-alias-state-business-primary);border-radius:9px;min-width:18px;padding:0 5px;font-size:11px;line-height:18px}.vX7ura_body{flex:1;min-height:0;overflow:auto}.vX7ura_catalog{box-sizing:border-box;max-width:1040px;margin:0 auto;padding:28px clamp(24px,4vw,48px) 48px}.vX7ura_head{flex-wrap:wrap;justify-content:space-between;align-items:flex-end;gap:16px;margin-bottom:20px;display:flex}.vX7ura_title{margin:0;font-size:20px;font-weight:500;line-height:28px}.vX7ura_intro{color:var(--dsw-alias-label-secondary);word-break:break-all;margin:4px 0 0;font-size:13px;line-height:20px}.vX7ura_tools{align-items:center;gap:8px;display:flex}.vX7ura_search{width:220px}.vX7ura_filters{flex-wrap:wrap;gap:6px;margin-bottom:16px;display:flex}.vX7ura_alert{color:var(--dsw-alias-state-error-primary);background:var(--dsw-alias-bg-layer-2);border-radius:10px;align-items:flex-start;gap:8px;margin:0 0 16px;padding:10px 12px;font-size:13px;line-height:20px;display:flex}.vX7ura_grid{grid-template-columns:repeat(auto-fill,minmax(min(100%,280px),1fr));gap:12px;margin:0;padding:0;list-style:none;display:grid}.vX7ura_card{border:.5px solid var(--dsw-alias-border-l3);background:var(--dsw-alias-bg-layer-1);border-radius:14px;flex-direction:column;gap:10px;min-width:0;padding:16px;transition:border-color .12s,box-shadow .12s;display:flex}.vX7ura_card:hover{border-color:var(--dsw-alias-border-l4);box-shadow:0 4px 16px #0000000f}.vX7ura_cardHead{align-items:center;gap:12px;min-width:0;display:flex}.vX7ura_avatar{color:#fff;border-radius:10px;flex:none;place-items:center;width:40px;height:40px;font-size:17px;font-weight:600;display:grid}.vX7ura_nameBlock{min-width:0}.vX7ura_name{white-space:nowrap;text-overflow:ellipsis;margin:0;font-size:14px;font-weight:500;line-height:20px;overflow:hidden}.vX7ura_pkg{font-family:var(--dsw-font-mono);white-space:nowrap;text-overflow:ellipsis;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px;overflow:hidden}.vX7ura_desc{min-height:40px;color:var(--dsw-alias-label-secondary);-webkit-line-clamp:2;-webkit-box-orient:vertical;margin:0;font-size:13px;line-height:20px;display:-webkit-box;overflow:hidden}.vX7ura_badges{flex-wrap:wrap;gap:6px;display:flex}.vX7ura_badge{height:20px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-2);border-radius:10px;align-items:center;gap:4px;padding:0 8px;font-size:11px;display:inline-flex}.vX7ura_badge[data-tone=success]{color:var(--dsw-alias-state-success-primary)}.vX7ura_badge[data-tone=update]{color:var(--dsw-alias-state-business-primary)}.vX7ura_badge[data-tone=warning]{color:var(--dsw-alias-state-warning-primary)}.vX7ura_cardFoot{border-top:.5px solid var(--dsw-alias-border-l2);justify-content:flex-end;align-items:center;gap:8px;margin-top:auto;padding-top:10px;display:flex}.vX7ura_version{color:var(--dsw-alias-label-tertiary);margin-right:auto;font-size:12px}.vX7ura_empty{text-align:center;color:var(--dsw-alias-label-tertiary);flex-direction:column;align-items:center;gap:8px;padding:64px 16px;font-size:13px;display:flex}.vX7ura_emptyIcon{color:var(--dsw-alias-label-caption)}.vX7ura_skeleton{background:var(--dsw-alias-bg-layer-2);border-radius:14px;height:168px;animation:1.2s ease-in-out infinite vX7ura_bkms-pulse}@keyframes vX7ura_bkms-pulse{50%{opacity:.55}}.vX7ura_hint{color:var(--dsw-alias-label-tertiary);margin:20px 0 0;font-size:12px;line-height:18px}.vX7ura_progress{background:var(--dsw-alias-bg-layer-2);border-radius:10px;flex-direction:column;gap:6px;padding:10px 12px;display:flex}.vX7ura_progressHead{color:var(--dsw-alias-label-secondary);justify-content:space-between;gap:8px;font-size:12px;line-height:16px;display:flex}.vX7ura_track{background:var(--dsw-alias-border-l3);border-radius:2px;height:4px;position:relative;overflow:hidden}.vX7ura_bar{background:var(--dsw-alias-state-business-primary,#4f6bed);border-radius:2px;height:100%;transition:width .3s}.vX7ura_barIndeterminate{background:var(--dsw-alias-state-business-primary,#4f6bed);border-radius:2px;width:40%;height:100%;animation:1.2s ease-in-out infinite vX7ura_bkms-indeterminate;position:absolute;top:0;left:-40%}@keyframes vX7ura_bkms-indeterminate{to{left:100%}}.vX7ura_progressDetail{font-family:var(--dsw-font-mono);white-space:nowrap;text-overflow:ellipsis;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px;overflow:hidden}.vX7ura_cardError{color:var(--dsw-alias-state-error-primary);-webkit-line-clamp:3;overflow-wrap:anywhere;-webkit-box-orient:vertical;margin:0;font-size:12px;line-height:18px;display:-webkit-box;overflow:hidden}.vX7ura_cardError svg{vertical-align:-3px;margin-right:4px}.vX7ura_percent{font-variant-numeric:tabular-nums;flex:none}";
		const tagId$1 = "@bkms/plugin-center/CenterPage.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId$1) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@bkms/plugin-center";
			tag.dataset.pluginCss = tagId$1;
			tag.textContent = css$1;
			document.head.appendChild(tag);
		}
		var CenterPage_module_css_default = {
			"cardHead": "vX7ura_cardHead",
			"badges": "vX7ura_badges",
			"skeleton": "vX7ura_skeleton",
			"track": "vX7ura_track",
			"bkms-indeterminate": "vX7ura_bkms-indeterminate",
			"progressDetail": "vX7ura_progressDetail",
			"topbar": "vX7ura_topbar",
			"percent": "vX7ura_percent",
			"desc": "vX7ura_desc",
			"search": "vX7ura_search",
			"name": "vX7ura_name",
			"badge": "vX7ura_badge",
			"filters": "vX7ura_filters",
			"progress": "vX7ura_progress",
			"body": "vX7ura_body",
			"version": "vX7ura_version",
			"card": "vX7ura_card",
			"catalog": "vX7ura_catalog",
			"shell": "vX7ura_shell",
			"cardFoot": "vX7ura_cardFoot",
			"segment": "vX7ura_segment",
			"head": "vX7ura_head",
			"brandMark": "vX7ura_brandMark",
			"alert": "vX7ura_alert",
			"tools": "vX7ura_tools",
			"grid": "vX7ura_grid",
			"pkg": "vX7ura_pkg",
			"progressHead": "vX7ura_progressHead",
			"empty": "vX7ura_empty",
			"bar": "vX7ura_bar",
			"barIndeterminate": "vX7ura_barIndeterminate",
			"cardError": "vX7ura_cardError",
			"avatar": "vX7ura_avatar",
			"intro": "vX7ura_intro",
			"emptyIcon": "vX7ura_emptyIcon",
			"nameBlock": "vX7ura_nameBlock",
			"hint": "vX7ura_hint",
			"brand": "vX7ura_brand",
			"segmentItem": "vX7ura_segmentItem",
			"count": "vX7ura_count",
			"bkms-pulse": "vX7ura_bkms-pulse",
			"title": "vX7ura_title"
		};
		//#endregion
		//#region src/client/CenterPage.tsx
		const filters = [
			{
				key: "all",
				label: "全部"
			},
			{
				key: "updates",
				label: "可更新"
			},
			{
				key: "installed",
				label: "已安装"
			},
			{
				key: "available",
				label: "未安装"
			}
		];
		const palette = [
			"#4f6bed",
			"#0f9d8a",
			"#d9822b",
			"#9b51e0",
			"#e04f6b",
			"#2d9cdb",
			"#6c8a2b"
		];
		/** 简单语义版本比较，只用于提示是否有更新。 */
		function newer(target, current) {
			const parse = (v) => /^(\d+)\.(\d+)\.(\d+)(?:-(.+))?/.exec(v ?? "");
			const a = parse(target), b = parse(current);
			if (!a || !b) return false;
			for (let i = 1; i <= 3; i++) if (Number(a[i]) !== Number(b[i])) return Number(a[i]) > Number(b[i]);
			return !a[4] && !!b[4];
		}
		function initial(name) {
			return (name.replace(/^@[^/]+\//, "").replace(/^(dsh|bkms)[-_]/i, "").match(/[\p{L}\p{N}]/u)?.[0] ?? "?").toUpperCase();
		}
		function colorOf(name) {
			let hash = 0;
			for (const ch of name) hash = hash * 31 + ch.charCodeAt(0) >>> 0;
			return palette[hash % palette.length];
		}
		const phaseText = {
			queued: "排队中",
			downloading: "正在下载",
			installing: "正在安装依赖",
			applying: "正在启用",
			done: "已完成",
			failed: "失败"
		};
		const size = (bytes) => bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
		/** 卡片上的安装进度：下载阶段按字节显示百分比，其余阶段为不确定进度并显示官方安装器的最新输出。 */
		function InstallProgress({ progress }) {
			const percent = progress.phase === "downloading" && progress.total > 0 ? Math.min(100, Math.round(progress.received / progress.total * 100)) : null;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: CenterPage_module_css_default.progress,
				role: "status",
				"aria-live": "polite",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: CenterPage_module_css_default.progressHead,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [
							progress.source === "auto" ? "自动" : "",
							progress.action === "upgrade" ? "更新" : "安装",
							" v",
							progress.version,
							" · ",
							phaseText[progress.phase]
						] }), percent !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: CenterPage_module_css_default.percent,
							children: [percent, "%"]
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: CenterPage_module_css_default.track,
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: percent === null ? CenterPage_module_css_default.barIndeterminate : CenterPage_module_css_default.bar,
							style: percent === null ? void 0 : { width: `${percent}%` }
						})
					}),
					percent !== null ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: CenterPage_module_css_default.progressDetail,
						children: [
							size(progress.received),
							" / ",
							size(progress.total)
						]
					}) : progress.detail && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: CenterPage_module_css_default.progressDetail,
						title: progress.detail,
						children: progress.detail
					})
				]
			});
		}
		function CenterPage(props) {
			const inventory = props.usePluginManager((snapshot) => snapshot);
			const preferences = (0, react.useSyncExternalStore)(centerSettings.subscribe, centerSettings.getSnapshot);
			const [tab, setTab] = (0, react.useState)("installed");
			const [items, setItems] = (0, react.useState)([]), [loadedCenter, setLoadedCenter] = (0, react.useState)(""), [busy, setBusy] = (0, react.useState)(false), [error, setError] = (0, react.useState)("");
			const [working, setWorking] = (0, react.useState)(""), [query, setQuery] = (0, react.useState)(""), [filter, setFilter] = (0, react.useState)("all");
			const [cardError, setCardError] = (0, react.useState)({});
			const progressOf = (name) => preferences.sync?.progress?.[name];
			const center = preferences.address;
			const loaded = loadedCenter === center;
			async function request(path, extra = {}) {
				const url = new URL("api/bkms-plugin-center/" + path, document.baseURI);
				url.search = new URLSearchParams({
					center,
					...extra
				}).toString();
				const response = await fetch(url.pathname + url.search);
				const text = await response.text();
				if (!text.trim()) throw new Error("BKMS 中心接口未加载，请完全退出 DSH 后重启");
				let result;
				try {
					result = JSON.parse(text);
				} catch {
					throw new Error("接口返回内容不正确，请检查客户端版本");
				}
				if (!response.ok) throw new Error(result.error || "操作失败，请重试");
				return result;
			}
			async function load() {
				setLoadedCenter("");
				setBusy(true);
				setError("");
				try {
					setItems((await request("catalog")).plugins);
					setLoadedCenter(center);
				} catch (e) {
					setError(String(e instanceof Error ? e.message : e));
				} finally {
					setBusy(false);
				}
			}
			/** 直接在 DSH 后台下载、校验并安装，进度显示在卡片上；不弹出原生安装窗口。 */
			async function install(item) {
				setWorking(item.url);
				setCardError((errors) => ({
					...errors,
					[item.url]: ""
				}));
				try {
					if (!item.artifact) throw new Error("该插件尚未上传并发布 .tgz 包，请先在服务端上传");
					await centerSettings.installPlugin(item.url);
				} catch (e) {
					setCardError((errors) => ({
						...errors,
						[item.url]: String(e instanceof Error ? e.message : e)
					}));
				} finally {
					setWorking("");
				}
			}
			function open(next) {
				setTab(next);
				if (next === "catalog" && !loaded && !busy) load();
			}
			const rows = (0, react.useMemo)(() => (loaded ? items : []).map((item) => {
				const installed = inventory.packages.find((pkg) => pkg.name === (item.packageName || item.npm || item.name) && pkg.installed);
				return {
					item,
					installed,
					update: !!installed && newer(item.version, installed.version)
				};
			}), [
				items,
				loaded,
				inventory.packages
			]);
			const updates = rows.filter((row) => row.update).length;
			const q = query.trim().toLowerCase();
			const visible = rows.filter(({ item, installed, update }) => (!q || `${item.name} ${item.packageName ?? ""} ${item.description?.zh ?? ""}`.toLowerCase().includes(q)) && (filter === "all" || filter === "installed" && installed || filter === "updates" && update || filter === "available" && !installed));
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: CenterPage_module_css_default.shell,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: CenterPage_module_css_default.topbar,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: CenterPage_module_css_default.brand,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: CenterPage_module_css_default.brandMark,
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconPluginPinwheelOutlineRegular, {})
						}), "BKMS 插件中心"]
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: CenterPage_module_css_default.segment,
						role: "tablist",
						"aria-label": "插件视图",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							role: "tab",
							className: CenterPage_module_css_default.segmentItem,
							"aria-selected": tab === "installed",
							onClick: () => open("installed"),
							children: "已安装插件"
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
							type: "button",
							role: "tab",
							className: CenterPage_module_css_default.segmentItem,
							"aria-selected": tab === "catalog",
							onClick: () => open("catalog"),
							children: ["BKMS 插件", updates > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: CenterPage_module_css_default.count,
								"aria-label": `${updates} 个可更新`,
								children: updates
							})]
						})]
					})]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: CenterPage_module_css_default.body,
					children: tab === "installed" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(PluginManagerPage, { ...props }) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
						className: CenterPage_module_css_default.catalog,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: CenterPage_module_css_default.head,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
									className: CenterPage_module_css_default.title,
									children: "BKMS 插件"
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
									className: CenterPage_module_css_default.intro,
									children: [
										"来自 ",
										center,
										loaded ? ` · 共 ${items.length} 个` : ""
									]
								})] }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: CenterPage_module_css_default.tools,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Input, {
										className: CenterPage_module_css_default.search,
										icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconSearchOutlineRegular, {}),
										placeholder: "搜索插件",
										"aria-label": "搜索 BKMS 插件",
										value: query,
										onChange: (e) => setQuery(e.target.value)
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
										variant: "outline",
										icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconRefreshOutlineRegular, {}),
										disabled: busy,
										onClick: () => void load(),
										children: busy ? "正在刷新…" : "刷新"
									})]
								})]
							}),
							loaded && items.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: CenterPage_module_css_default.filters,
								children: filters.map((f) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(_deepseek_ai_dsh_client_ui_primitives.Pill, {
									active: filter === f.key,
									onClick: () => setFilter(f.key),
									children: [f.label, f.key === "updates" && updates ? ` ${updates}` : ""]
								}, f.key))
							}),
							error && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
								role: "alert",
								className: CenterPage_module_css_default.alert,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconWarningOutlineRegular, {}),
									error,
									"。请在“DSH 设置 → BKMS 插件中心”检查中心地址后刷新。"
								]
							}),
							busy && !loaded ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
								className: CenterPage_module_css_default.grid,
								"aria-busy": "true",
								children: [
									0,
									1,
									2
								].map((i) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("li", { className: CenterPage_module_css_default.skeleton }, i))
							}) : loaded && !items.length ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: CenterPage_module_css_default.empty,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: CenterPage_module_css_default.emptyIcon,
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconPluginPinwheelOutlineRegular, {})
								}), "中心暂无已上架插件"]
							}) : loaded && !visible.length ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: CenterPage_module_css_default.empty,
								children: "没有符合条件的插件"
							}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
								className: CenterPage_module_css_default.grid,
								children: visible.map(({ item, installed, update }) => {
									const name = item.packageName || item.name;
									const progress = progressOf(name);
									const active = !!progress && progress.phase !== "done" && progress.phase !== "failed";
									const finished = progress?.phase === "done" && progress.version === item.version;
									const current = finished || !!installed && !update && installed.version === item.version;
									const failure = cardError[item.url] || (progress?.phase === "failed" ? progress.error : "");
									return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
										className: CenterPage_module_css_default.card,
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
												className: CenterPage_module_css_default.cardHead,
												children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													className: CenterPage_module_css_default.avatar,
													style: { background: colorOf(name) },
													"aria-hidden": "true",
													children: initial(item.name)
												}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
													className: CenterPage_module_css_default.nameBlock,
													children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
														className: CenterPage_module_css_default.name,
														title: item.name,
														children: item.name
													}), item.packageName && item.packageName !== item.name && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
														className: CenterPage_module_css_default.pkg,
														title: item.packageName,
														children: item.packageName
													})]
												})]
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
												className: CenterPage_module_css_default.desc,
												children: item.description?.zh || "暂无简介"
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
												className: CenterPage_module_css_default.badges,
												children: [
													!installed && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
														className: CenterPage_module_css_default.badge,
														children: "未安装"
													}),
													installed && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
														className: CenterPage_module_css_default.badge,
														"data-tone": installed.enabled ? "success" : "warning",
														children: installed.enabled ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconCheckCircleFillRegular, {}), "已启用"] }) : "已安装，未启用"
													}),
													update && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
														className: CenterPage_module_css_default.badge,
														"data-tone": "update",
														children: [
															"可更新：",
															installed.version,
															" → ",
															item.version
														]
													}),
													!item.artifact && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
														className: CenterPage_module_css_default.badge,
														"data-tone": "warning",
														children: "缺少发布包"
													}),
													finished && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
														className: CenterPage_module_css_default.badge,
														"data-tone": "success",
														children: [
															/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconCheckCircleFillRegular, {}),
															progress.action === "upgrade" ? "已更新" : "已安装",
															" v",
															progress.version
														]
													})
												]
											}),
											active && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(InstallProgress, { progress }),
											failure && !active && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
												role: "alert",
												className: CenterPage_module_css_default.cardError,
												title: failure,
												children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconWarningOutlineRegular, {}), failure]
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
												className: CenterPage_module_css_default.cardFoot,
												children: [
													/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
														className: CenterPage_module_css_default.version,
														children: [item.version ? `v${item.version}` : "", installed && !update && !finished && installed.version !== item.version ? ` · 本机 v${installed.version}` : ""]
													}),
													installed && !installed.enabled && !active && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
														size: "sm",
														disabled: inventory.busy.length > 0,
														onClick: () => {
															props.setEnabled(installed.name, true);
															setTab("installed");
														},
														children: "启用"
													}),
													/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
														size: "sm",
														variant: current ? "ghost" : "primary",
														icon: current || active ? void 0 : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconDownloadOutlineRegular, {}),
														disabled: !!working || active || current || !item.artifact,
														onClick: () => void install(item),
														children: active ? progress.action === "upgrade" ? "正在更新…" : "正在安装…" : working === item.url ? "正在开始…" : !item.artifact ? "不可安装" : current ? "已是最新" : failure ? "重试" : update ? "更新" : "安装"
													})
												]
											})
										]
									}, item.url);
								})
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: CenterPage_module_css_default.hint,
								children: "点击安装或更新后，DSH 在后台下载、校验中心发布的 .tgz 并安装启用，进度显示在卡片上；需要刷新界面或重启时会另行提示。中心按分发规则推送的插件也会自动安装，设置见“DSH 设置 → BKMS 插件中心”。"
							})
						]
					})
				})]
			});
		}
		//#endregion
		//#region \0dsh-css:D:\git\AI\dsh-zq\sources\plugins\dsh-plugins\bkms-plugin-center\src\client\CenterSettingsPage.module.css.mjs
		const css = "._5PBkqG_page{max-width:760px;color:var(--dsw-alias-label-primary);flex-direction:column;gap:24px;padding:4px 0 32px;display:flex}._5PBkqG_title{margin:0;font-size:18px;font-weight:500;line-height:26px}._5PBkqG_group{flex-direction:column;gap:8px;display:flex}._5PBkqG_groupTitle{color:var(--dsw-alias-label-secondary);margin:0;padding:0 4px;font-size:13px;font-weight:500}._5PBkqG_card{border:.5px solid var(--dsw-alias-border-l3);background:var(--dsw-alias-bg-layer-1);border-radius:14px}._5PBkqG_row{justify-content:space-between;align-items:center;gap:16px;padding:14px 16px;display:flex}._5PBkqG_row+._5PBkqG_row,._5PBkqG_row+._5PBkqG_list,._5PBkqG_list+._5PBkqG_row{border-top:.5px solid var(--dsw-alias-border-l2)}._5PBkqG_rowText{min-width:0}._5PBkqG_rowLabel{font-size:14px;line-height:20px}._5PBkqG_rowHint{color:var(--dsw-alias-label-tertiary);margin-top:2px;font-size:12px;line-height:18px}._5PBkqG_addressRow{flex-wrap:wrap}._5PBkqG_addressControl{flex:320px;gap:8px;max-width:440px;display:flex}._5PBkqG_addressInput{flex:1;min-width:0}._5PBkqG_message{color:var(--dsw-alias-label-secondary);margin:0;padding:0 16px 12px;font-size:12px}._5PBkqG_alert{color:var(--dsw-alias-state-error-primary);background:var(--dsw-alias-bg-layer-2);overflow-wrap:anywhere;border-radius:8px;margin:0 16px 12px;padding:8px 12px;font-size:12px;line-height:18px}._5PBkqG_list{margin:0;padding:4px 0;list-style:none}._5PBkqG_item{align-items:center;gap:12px;padding:10px 16px;display:flex}._5PBkqG_itemMain{flex:1;min-width:0}._5PBkqG_itemName{white-space:nowrap;text-overflow:ellipsis;font-size:13px;line-height:20px;overflow:hidden}._5PBkqG_itemMeta{white-space:nowrap;text-overflow:ellipsis;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;overflow:hidden}._5PBkqG_itemError{color:var(--dsw-alias-state-error-primary);overflow-wrap:anywhere;font-size:12px;line-height:18px}._5PBkqG_badge{height:22px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-2);white-space:nowrap;border-radius:11px;flex:none;padding:0 8px;font-size:12px;line-height:22px}._5PBkqG_badge[data-tone=success]{color:var(--dsw-alias-state-success-primary)}._5PBkqG_badge[data-tone=active]{color:var(--dsw-alias-state-business-primary)}._5PBkqG_badge[data-tone=error]{color:var(--dsw-alias-state-error-primary)}._5PBkqG_empty{color:var(--dsw-alias-label-tertiary);padding:16px;font-size:13px}._5PBkqG_history{color:var(--dsw-alias-label-secondary);padding:0 4px;font-size:12px}._5PBkqG_history summary{cursor:pointer;padding:4px 0}._5PBkqG_history ul{margin:4px 0 0;padding:0;list-style:none}._5PBkqG_history li{border-bottom:.5px solid var(--dsw-alias-border-l2);gap:8px;padding:6px 0;line-height:18px;display:flex}._5PBkqG_history time{color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;flex:none}._5PBkqG_failed{color:var(--dsw-alias-state-error-primary)}";
		const tagId = "@bkms/plugin-center/CenterSettingsPage.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@bkms/plugin-center";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		var CenterSettingsPage_module_css_default = {
			"groupTitle": "_5PBkqG_groupTitle",
			"addressRow": "_5PBkqG_addressRow",
			"addressInput": "_5PBkqG_addressInput",
			"rowHint": "_5PBkqG_rowHint",
			"row": "_5PBkqG_row",
			"failed": "_5PBkqG_failed",
			"title": "_5PBkqG_title",
			"group": "_5PBkqG_group",
			"page": "_5PBkqG_page",
			"history": "_5PBkqG_history",
			"message": "_5PBkqG_message",
			"itemName": "_5PBkqG_itemName",
			"itemMain": "_5PBkqG_itemMain",
			"rowText": "_5PBkqG_rowText",
			"empty": "_5PBkqG_empty",
			"alert": "_5PBkqG_alert",
			"rowLabel": "_5PBkqG_rowLabel",
			"item": "_5PBkqG_item",
			"itemMeta": "_5PBkqG_itemMeta",
			"itemError": "_5PBkqG_itemError",
			"badge": "_5PBkqG_badge",
			"card": "_5PBkqG_card",
			"addressControl": "_5PBkqG_addressControl",
			"list": "_5PBkqG_list"
		};
		//#endregion
		//#region src/client/CenterSettingsPage.tsx
		/** 每个插件的状态：文字与徽标颜色。 */
		const states = {
			current: ["已是最新", "success"],
			done: ["已完成", "success"],
			install: ["待安装", "active"],
			upgrade: ["待升级", "active"],
			queued: ["排队中", "active"],
			running: ["正在安装", "active"],
			failed: ["失败", "error"],
			"waiting-retry": ["等待重试", "error"],
			paused: ["已暂停", "error"],
			conflict: ["已暂停", "error"],
			"user-removed": ["已卸载", void 0],
			manual: ["手工管理", void 0],
			outdated: ["有新版本", void 0],
			builtin: ["内置", void 0],
			scheduled: ["等待检查", void 0],
			unsupported: ["暂不支持", void 0],
			"unknown-version": ["版本未知", "error"]
		};
		const modes = {
			manual: "手工管理",
			automatic: "自动维护",
			required: "强制维护"
		};
		const clock = (value) => {
			if (!value) return "—";
			const date = new Date(value);
			return (/* @__PURE__ */ new Date()).toDateString() === date.toDateString() ? date.toLocaleTimeString([], {
				hour: "2-digit",
				minute: "2-digit"
			}) : date.toLocaleString([], {
				month: "numeric",
				day: "numeric",
				hour: "2-digit",
				minute: "2-digit"
			});
		};
		function PluginItem({ row, busy }) {
			const [label, tone] = states[row.state] ?? [row.state, void 0];
			const version = !row.installed ? `未安装 · 目标 ${row.target}` : row.installed === row.target ? `v${row.installed}` : `v${row.installed} → ${row.target}`;
			const retry = row.state === "paused" || row.state === "failed" || row.state === "waiting-retry";
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
				className: CenterSettingsPage_module_css_default.item,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: CenterSettingsPage_module_css_default.itemMain,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: CenterSettingsPage_module_css_default.itemName,
								title: row.packageName,
								children: row.name
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: CenterSettingsPage_module_css_default.itemMeta,
								children: [
									version,
									" · ",
									modes[row.installMode] ?? row.installMode,
									row.autoUpgrade ? " · 自动升级" : ""
								]
							}),
							row.lastError && retry && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: CenterSettingsPage_module_css_default.itemError,
								title: row.lastError,
								children: row.lastError.length > 160 ? row.lastError.slice(0, 160) + "…" : row.lastError
							})
						]
					}),
					retry && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
						size: "sm",
						disabled: busy,
						onClick: () => void centerSettings.syncAction("sync/retry", { name: row.packageName }),
						children: "重试"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: CenterSettingsPage_module_css_default.badge,
						"data-tone": tone,
						children: label
					})
				]
			});
		}
		function SyncSection({ sync, busy, error }) {
			const [message, setMessage] = (0, react.useState)("");
			async function toggle(enabled) {
				try {
					await centerSettings.setAutoSync(enabled);
					setMessage("");
				} catch (e) {
					setMessage(e instanceof Error ? e.message : String(e));
				}
			}
			const schedule = sync.running ? "正在检查…" : `上次 ${clock(sync.lastCheck)}${sync.autoSync ? ` · 下次 ${clock(sync.nextCheckAt)}` : ""}${sync.revision !== null ? ` · 规则第 ${sync.revision} 版` : ""}`;
			const problem = message || error || sync.lastError && `读取规则失败：${sync.lastError}` || sync.conflict;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: CenterSettingsPage_module_css_default.group,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
						className: CenterSettingsPage_module_css_default.groupTitle,
						children: "自动更新"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: CenterSettingsPage_module_css_default.card,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: CenterSettingsPage_module_css_default.row,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: CenterSettingsPage_module_css_default.rowText,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										className: CenterSettingsPage_module_css_default.rowLabel,
										children: "自动安装和升级"
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										className: CenterSettingsPage_module_css_default.rowHint,
										children: "按中心发布的分发规则在后台执行，需要刷新或重启时会提示"
									})]
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Switch, {
									checked: sync.autoSync,
									disabled: busy,
									label: "自动安装和升级",
									onChange: (next) => void toggle(next)
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: CenterSettingsPage_module_css_default.row,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: CenterSettingsPage_module_css_default.rowText,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										className: CenterSettingsPage_module_css_default.rowLabel,
										children: "检查更新"
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										className: CenterSettingsPage_module_css_default.rowHint,
										children: schedule
									})]
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
									size: "sm",
									variant: "outline",
									icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconRefreshOutlineRegular, {}),
									disabled: busy || sync.running,
									onClick: () => void centerSettings.syncAction("sync/check"),
									children: busy ? "检查中…" : "立即检查"
								})]
							}),
							problem && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								role: "alert",
								className: CenterSettingsPage_module_css_default.alert,
								children: problem
							}),
							sync.plugins.length > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
								className: CenterSettingsPage_module_css_default.list,
								"aria-label": "分发规则中的插件",
								children: sync.plugins.map((row) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(PluginItem, {
									row,
									busy
								}, row.packageName))
							}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: CenterSettingsPage_module_css_default.empty,
								children: sync.lastCheck ? "中心暂未发布分发规则" : "尚未检查"
							})
						]
					}),
					sync.history.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("details", {
						className: CenterSettingsPage_module_css_default.history,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("summary", { children: [
							"最近执行记录（",
							sync.history.length,
							"）"
						] }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", { children: sync.history.map((h, i) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("time", { children: clock(h.at) }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: h.ok ? void 0 : CenterSettingsPage_module_css_default.failed,
							children: [
								h.source === "manual" ? "手动" : "自动",
								h.action === "install" ? "安装" : "升级",
								" ",
								h.name || h.packageName,
								" ",
								h.from ? `${h.from} → ` : "",
								h.to,
								h.ok ? "" : " · 失败"
							]
						})] }, i)) })]
					})
				]
			});
		}
		function CenterSettingsPage() {
			const state = (0, react.useSyncExternalStore)(centerSettings.subscribe, centerSettings.getSnapshot);
			const [address, setAddress] = (0, react.useState)(state.address), [message, setMessage] = (0, react.useState)("");
			(0, react.useEffect)(() => {
				setAddress(state.address);
			}, [state.address]);
			(0, react.useEffect)(() => {
				centerSettings.refreshSync();
			}, []);
			async function save() {
				try {
					await centerSettings.setAddress(address);
					setMessage("已保存");
				} catch (error) {
					setMessage(error instanceof Error ? error.message : String(error));
				}
			}
			const sync = state.sync;
			const changed = address.trim() !== state.address;
			const source = state.source === "profile" ? "来自 Profile 预置" : state.source === "default" ? "默认地址" : state.source === "browser" ? "仅保存在本浏览器" : "";
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: CenterSettingsPage_module_css_default.page,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
						className: CenterSettingsPage_module_css_default.title,
						children: "BKMS 插件中心"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
						className: CenterSettingsPage_module_css_default.group,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
							className: CenterSettingsPage_module_css_default.groupTitle,
							children: "常规"
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: CenterSettingsPage_module_css_default.card,
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: CenterSettingsPage_module_css_default.row,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: CenterSettingsPage_module_css_default.rowText,
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
											className: CenterSettingsPage_module_css_default.rowLabel,
											children: "在侧栏显示入口"
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
											className: CenterSettingsPage_module_css_default.rowHint,
											children: "隐藏后插件仍正常使用"
										})]
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Switch, {
										checked: state.visible,
										label: "在侧栏显示 BKMS 插件中心入口",
										onChange: (next) => {
											try {
												centerSettings.setVisible(next);
											} catch {
												setMessage("设置无法保存，请检查浏览器存储");
											}
										}
									})]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: `${CenterSettingsPage_module_css_default.row} ${CenterSettingsPage_module_css_default.addressRow}`,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: CenterSettingsPage_module_css_default.rowText,
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
											className: CenterSettingsPage_module_css_default.rowLabel,
											children: "中心地址"
										}), source && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
											className: CenterSettingsPage_module_css_default.rowHint,
											children: source
										})]
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: CenterSettingsPage_module_css_default.addressControl,
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Input, {
											className: CenterSettingsPage_module_css_default.addressInput,
											"aria-label": "BKMS 中心目录地址",
											value: address,
											onChange: (e) => {
												setAddress(e.target.value);
												setMessage("");
											},
											onKeyDown: (e) => {
												if (e.key === "Enter") save();
											}
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
											size: "sm",
											variant: changed ? "primary" : "outline",
											disabled: !changed,
											onClick: () => void save(),
											children: "保存"
										})]
									})]
								}),
								message && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									role: "status",
									className: CenterSettingsPage_module_css_default.message,
									children: message
								})
							]
						})]
					}),
					!sync ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: CenterSettingsPage_module_css_default.empty,
						children: state.syncError || "正在读取自动更新状态…"
					}) : !sync.available ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						role: "alert",
						className: CenterSettingsPage_module_css_default.alert,
						children: sync.reason
					}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SyncSection, {
						sync,
						busy: state.syncBusy,
						error: state.syncError
					})
				]
			});
		}
		//#endregion
		//#region src/client/mirror-slots.tsx
		const roots = [
			"item",
			"bundle.activation",
			"bundle.config",
			"row.config",
			"detail.actions",
			"detail.badge",
			"detail.section"
		];
		function mirrorPluginSlots(ctx) {
			const mapKey = (key) => key.startsWith("plugins.") ? key.replace(/^plugins\./, "bkmsPlugins.") : "bkmsMirror." + key;
			function watch(source, destination) {
				const copies = /* @__PURE__ */ new Map();
				let stopped = false;
				function update() {
					if (stopped) return;
					const entries = ctx.slots.entries(source);
					for (const [entry, dispose] of copies) if (!entries.includes(entry)) {
						dispose();
						copies.delete(entry);
					}
					for (const entry of entries) {
						if (copies.has(entry)) continue;
						const children = Object.fromEntries(Object.entries(entry.children ?? {}).map(([key, spec]) => [mapKey(key), spec]));
						function Contribution(props) {
							return (0, react.createElement)(entry.component, {
								...props,
								renderSlot: (key, ...args) => props.renderSlot(mapKey(key), ...args),
								renderSlotChain: (key, ...args) => props.renderSlotChain(mapKey(key), ...args)
							});
						}
						const unregister = ctx.slots.register({
							name: destination,
							...entry.options,
							...entry.inject ? { inject: entry.inject } : {},
							...entry.select ? { select: entry.select } : {},
							...entry.store ? { store: entry.store } : {},
							...entry.locale ? { locale: entry.locale } : {},
							...Object.keys(children).length ? { children } : {}
						}, Contribution);
						const descendants = Object.keys(entry.children ?? {}).map((key) => watch(key, mapKey(key)));
						copies.set(entry, () => {
							descendants.forEach((dispose) => dispose());
							unregister();
						});
					}
				}
				const unsubscribe = ctx.slots.subscribe(source, update);
				update();
				return () => {
					stopped = true;
					unsubscribe();
					copies.forEach((dispose) => dispose());
					copies.clear();
				};
			}
			const disposers = roots.map((key) => watch("plugins." + key, "bkmsPlugins." + key));
			return () => disposers.forEach((dispose) => dispose());
		}
		//#endregion
		//#region src/client/SyncNotice.tsx
		/** 自动更新的全局提示：插件安装完成后需要刷新界面或重启客户端。挂在 shell.overlay，不依赖插件中心页面。 */
		const dismissedKey = "bkms-plugin-center.dismissed-notices";
		function readDismissed() {
			try {
				return JSON.parse(sessionStorage.getItem(dismissedKey) || "[]");
			} catch {
				return [];
			}
		}
		const names = (items) => items.map((item) => `${item.name} ${item.version}`).join("、");
		const notes = (items) => [...new Set(items.map((item) => item.note).filter(Boolean))].join("；");
		const card = {
			pointerEvents: "auto",
			width: 360,
			maxWidth: "calc(100vw - 32px)",
			boxSizing: "border-box",
			padding: "12px 16px",
			borderRadius: "var(--dsw-radius-lg, 12px)",
			background: "var(--dsw-alias-toast-bg, #1f2329)",
			color: "var(--dsw-alias-toast-label, #fff)",
			boxShadow: "var(--dsw-shadow-lv3, 0 8px 24px #0004)",
			fontSize: 13,
			lineHeight: 1.5
		};
		function SyncNotice() {
			const state = (0, react.useSyncExternalStore)(centerSettings.subscribe, centerSettings.getSnapshot);
			const [dismissed, setDismissed] = (0, react.useState)(readDismissed);
			const dismiss = (id) => {
				const next = [...dismissed, id].slice(-50);
				setDismissed(next);
				try {
					sessionStorage.setItem(dismissedKey, JSON.stringify(next));
				} catch {}
			};
			const sync = state.sync;
			if (!sync?.available) return null;
			const cards = [];
			for (const notice of sync.notices) {
				if (dismissed.includes(notice.id)) continue;
				const restart = notice.kind === "restart";
				cards.push(/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					role: "status",
					style: card,
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: restart ? "插件已更新，需要重启 DSH" : "插件已更新，刷新界面后生效" }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { children: names(notice.items) }),
						notes(notice.items) && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							style: { opacity: .8 },
							children: notes(notice.items)
						}),
						restart && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							style: { opacity: .8 },
							children: "请保存工作后完全退出 DSH（包括托盘），再重新打开。"
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: {
								display: "flex",
								gap: 8,
								marginTop: 8,
								justifyContent: "flex-end"
							},
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
								size: "sm",
								onClick: () => dismiss(notice.id),
								children: restart ? "知道了" : "稍后"
							}), !restart && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
								size: "sm",
								variant: "primary",
								onClick: () => location.reload(),
								children: "刷新界面"
							})]
						})
					]
				}, notice.id));
			}
			if (!cards.length) return null;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				style: {
					position: "fixed",
					right: 16,
					bottom: 16,
					zIndex: 1e3,
					display: "flex",
					flexDirection: "column",
					gap: 8,
					pointerEvents: "none"
				},
				children: cards
			});
		}
		//#endregion
		//#region src/client/PluginsPanelIcon.tsx
		/**
		* Render the plugin glyph at the size the sidebar asks for.
		* @param props - the sidebar's icon share: the requested edge and whether the panel is selected.
		* @returns the icon element.
		*/
		function PluginsPanelIcon({ size }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconPluginPinwheelOutlineRegular, { size });
		}
		//#endregion
		//#region src/client/locales.ts
		/** Plugin management interface copy. */
		/** Simplified Chinese dictionary and key source of truth. */
		const zh = {
			panel: "BKMS 插件中心",
			title: "已安装插件",
			intro: "添加和管理插件",
			loading: "正在读取插件…",
			error: "可能由于网络问题，无法读取全部插件",
			unavailable: "本部署没有可管理的 profile，无法安装或启停插件。",
			retry: "重试",
			refresh: "刷新",
			empty: "还没有安装任何插件。",
			addPlugin: "添加插件",
			restartNotice: "更改将在下次启动生效",
			overriddenNotice: "{name} 已保存，但被更高优先级的配置覆盖，当前未生效",
			bundlesTitle: "已安装",
			officialTitle: "官方",
			statusProblem: "异常",
			statusBeta: "实验性",
			reasonLabel: "原因",
			metadataError: "包元信息错误：{error}",
			versionTag: "v{version}",
			partsLabel: "包含的组件",
			partsEmpty: "这个插件包不包含任何组件。",
			partsCountTotal: "共 {count} 个",
			partsCountRunning: "{count} 运行中",
			partsCountOff: "{count} 已停用",
			partOff: "已关闭",
			partsCountFailed: "{count} 异常",
			partsFilter: "筛选组件",
			partsFilterEmpty: "没有匹配的组件。",
			partToggle: "启用组件 {name}",
			rowPhasePending: "等待依赖",
			rowPhaseLoading: "加载中",
			rowPhaseActive: "运行中",
			rowPhaseFailed: "异常",
			rowPhaseUnloading: "卸载中",
			enableToggle: "启用 {name}",
			openDetail: "查看 {name}",
			backToList: "返回插件列表",
			crumbRoot: "插件列表",
			backToPackage: "返回 {name}",
			configureRow: "配置 {name}",
			rowStateIdle: "未运行",
			uninstall: "卸载",
			uninstallLabel: "卸载 {name}",
			installTitle: "添加插件",
			installArchiveTitle: "安装插件包（TGZ）",
			installArchiveDescription: "安装下面的本地插件包。中心发布包已下载并校验；依赖安装仍由官方管理器处理。",
			installDescription: "输入插件的包名、GitHub 仓库地址或本地目录路径。",
			installSpecLabel: "包名或地址",
			installSpecPlaceholder: "例如 @deepseek-ai/dsh-experimental-auto-review",
			installGuideToggle: "插件安装引导和示例",
			installGuideHide: "收起引导",
			installGuideIdTitle: "包名",
			installGuideIdExample: "@deepseek-ai/dsh-experimental-auto-review",
			installGuideIdHint: "插件包名即 npm 包名（如 dsh-xxx 或 @作者/插件名），社区插件的 README 安装命令中 dsh plugin add 或 pnpm add 之后的部分。",
			installGuideGitTitle: "GitHub 仓库地址",
			installGuideGitExample: "https://github.com/author/dsh-plugin",
			installGuideGitHint: "插件在 GitHub 上的开源仓库地址，也支持其他 Git 仓库。",
			installGuidePathTitle: "本地插件目录",
			installGuidePathExample: "/Users/name/my-plugin",
			installGuidePathHint: "本机上插件目录的绝对路径，适用于自行开发或已下载的插件。",
			installGuideExampleLabel: "示例：",
			installGuideFill: "填入示例",
			installGuideFillAria: "填入示例 {example}",
			installGuideSafety: "请确认插件来源可信。插件在本机以你的权限运行，来源不明的插件可能损坏 DeepSeek Harness，或读取和泄露你的数据。",
			registryToggle: "安装源",
			registryLegend: "从哪个 npm 源下载插件",
			registryDefault: "默认安装源",
			registryNpmmirror: "中国大陆镜像源",
			registryWithHost: "{name}（{host}）",
			registryCustom: "自定义地址",
			registryCustomPlaceholder: "https://npm.example.com/",
			registryCustomHint: "公司内网或私有 npm 源；需要登录的源，把凭据放在本机的 ~/.npmrc 里",
			registryCustomInvalid: "请输入以 http:// 或 https:// 开头的地址",
			registryListSeparator: "、",
			installRun: "安装",
			installChecking: "正在检查…",
			installProblemInvalid: "无法识别这个包名或地址：{reason}",
			installProblemInstalled: "该插件已安装",
			installProblemNotFound: "未找到相关插件",
			installProblemNotPackage: "该路径不存在或不是有效的插件包",
			installProblemNotBundle: "这个包没有声明组合包，无法作为插件安装：{reason}",
			installProblemNetwork: "无法连接插件源，请检查网络后重试",
			installProblemNetworkAll: "所有安装源都无法连接（已尝试：{registries}），请检查网络或代理设置，或更换安装源",
			installProblemUnknown: "无法获取插件信息：{reason}",
			installingTitle: "插件安装中…",
			installedTitle: "已安装",
			installFailedTitle: "插件安装失败",
			installGithubFailedTitle: "无法访问 GitHub",
			installGithubTimeoutTitle: "连接 GitHub 超时",
			installGithubFailedDescription: "请尝试其他安装来源。",
			installUseGithubMirror: "改用国内镜像",
			installPackageLabel: "插件包名",
			installEdit: "编辑",
			installEditAria: "返回编辑",
			installCancelAndEdit: "取消安装并返回编辑",
			installApplyingCancellationError: "取消请求未得到确认；安装已进入收尾阶段，请等待结果。{reason}",
			installReconcile: "核对安装状态",
			installUnknownTitle: "未能获取安装结果",
			installUnknownDescription: "后端当前没有此安装任务。请检查插件列表后再尝试安装。",
			installResultUnconfirmed: "未收到安装结果，请核对安装状态。{reason}",
			installAwaitingAcceptance: "正在等待后端接收安装任务，收到确认后会自动重试取消。",
			installBackgroundUnknown: "未能获取安装结果，请检查插件列表。",
			installCancel: "取消安装",
			installCloseCancels: "取消安装并关闭",
			installViewTask: "查看安装任务",
			installUnconfirmedTitle: "安装状态尚未确认",
			installBackgroundDone: "插件安装已完成，可查看安装结果。",
			installBackgroundFailed: "插件安装失败，可查看安装详情。",
			installBackgroundUnconfirmed: "安装状态暂未确认，请查看安装任务了解详情。",
			installBackgroundApplying: "安装已进入收尾阶段，无法取消，可查看安装进度。",
			installStarting: "正在准备安装…",
			installCancelling: "正在停止安装…",
			installApplying: "正在应用配置，请稍候…",
			installCancelledShort: "已取消",
			installCancelled: "已取消安装，插件未启用，下载的文件可能保留",
			installCancelUnconfirmed: "尚未确认安装已停止，请重试取消或等待安装结果。{reason}",
			installEnableNow: "立即启用",
			installDetailsShow: "查看安装详情",
			installDetailsHide: "收起安装详情",
			installVersion: "版本 {version}",
			installSubjectPath: "本地目录",
			installSubjectGit: "Git 仓库",
			installSubjectTarball: "压缩包",
			installLocation: "安装位置：{dir}",
			installRetry: "重试",
			installChangeRegistry: "更换安装源",
			installAttempt: "{previous} 不可用，正在改用 {registry} 重试（第 {index} 个源，共 {total} 个）",
			installAttemptBadge: "第 {index} 次 · {registry}",
			installFailureNetwork: "网络连接失败",
			installFailureNetworkAll: "所有安装源都无法连接（已尝试：{registries}）。请检查网络或代理设置，或更换安装源后重试。",
			installFailureNetworkHost: "无法连接 {host}。GitHub 地址和 .tgz 直链不经过安装源，需要本机能直接访问它或配置代理；如果这个插件也发布到了 npm，请改填包名。",
			installFailureNotFound: "未找到相关插件",
			installFailureNoMatchingVersion: "没有匹配的版本",
			installFailureDiskFull: "磁盘空间不足，安装已停止",
			installFailurePermission: "没有写入权限，无法安装",
			installFailureBuildBlocked: "有依赖的安装脚本需要你允许后才能继续",
			installFailureBuildBlockedManual: "有依赖的安装脚本被 pnpm 拦下，请在 profile 的 pnpm-workspace.yaml 的 allowBuilds 中放行后重试",
			installFailureIntegrity: "下载的安装包校验失败",
			installFailureTimeout: "安装超时",
			installFailurePnpmMissing: "没有找到 pnpm，无法安装",
			installFailureGeneric: "安装过程中出错，原因见安装详情",
			terminalRunning: "运行中",
			terminalFailed: "失败",
			terminalDone: "已完成",
			terminalCopy: "复制",
			terminalCopied: "复制成功",
			terminalNoOutput: "无输出",
			terminalCollapseAria: "收起输出",
			terminalCollapse: "收起",
			terminalExpandAria: "展开其余 {n} 行输出",
			terminalExpand: "… 其余 {n} 行",
			terminalExitCode: "退出码 {code}",
			terminalSignal: "信号 {signal}",
			terminalNoExitCode: "未正常退出",
			installDoneNothing: "安装完成，没有新增依赖。",
			installDoneEnable: "包已安装到当前 Profile，尚未启用。请点击“立即启用”完成安装。",
			installDoneRestart: "包已安装。请点击“立即启用”，需要时完全退出并重启 DSH 后加载。",
			installDoneApproved: "已允许运行安装脚本：{names}",
			installApprovalTitle: "需要允许安装脚本",
			installApprovalDescription: "以下包声明了安装脚本，pnpm 默认不运行。",
			installApprovalConsequence: "允许后，脚本会以你的权限在本机运行，授权保存在当前 profile，之后不再询问。",
			installApprovalCaution: "只在信任这些包时允许。",
			installApproveAndRetry: "允许这些脚本并重试",
			installClose: "完成",
			close: "关闭",
			cancel: "取消",
			confirmUninstallTitle: "卸载「{name}」？",
			confirmUninstallDescription: "卸载后它提供的功能会消失。",
			confirmUninstall: "卸载",
			failedEnable: "启用失败：{reason}",
			failedDisable: "停用失败：{reason}",
			failedUninstall: "卸载失败：{reason}",
			failedRowEnable: "组件启用失败：{reason}",
			failedRowDisable: "组件停用失败：{reason}",
			reasonManagementRequired: "插件管理所需，不能停用或卸载",
			reasonUnaddressable: "当前 profile 的 patch 无法唯一定位这一项",
			reasonUnknownPlugin: "找不到该插件",
			reasonInvalidSpec: "请输入有效的包名或地址",
			reasonAmbiguousInstall: "无法从依赖变更中确定安装了哪一个包",
			reasonNotBundle: "这个包没有声明组合包，不能作为插件管理",
			reasonNotRemovable: "这个包不属于当前 profile，或者是插件管理所需的组件",
			reasonStopProfile: "这个 profile 没有启用 HMR，正在使用的包要停止后用 dsh plugin 卸载",
			reasonBundleInUse: "其他配置仍在使用这个组合包的组件，请先停用它们",
			reasonStaleApproval: "待允许的安装脚本列表已变化，请重新安装以刷新",
			reasonIncompatibleVersion: "{plugin} 与 DSH {runtime} 不兼容（要求 {peers}），运行它可能导致崩溃或数据丢失。请安装与当前 DSH 兼容的插件版本。",
			reasonIncompatibleVersionUnnamed: "这个插件与当前 DSH 版本不兼容，运行它可能导致崩溃或数据丢失",
			reasonOperationError: "Host 报告了一个错误"
		};
		/** English dictionary checked against the Chinese key set. */
		const en = {
			panel: "BKMS Plugin Center",
			title: "Installed plugins",
			intro: "Add and manage plugins",
			loading: "Reading plugins…",
			error: "Could not read all plugins, possibly due to a network problem",
			unavailable: "This deployment runs without a manageable profile, so plugins cannot be installed or switched here.",
			retry: "Retry",
			refresh: "Refresh",
			empty: "No plugins are installed yet.",
			addPlugin: "Add plugin",
			restartNotice: "The change takes effect at the next start",
			overriddenNotice: "{name} was saved, but a higher-priority configuration overrides it, so it is not in effect",
			bundlesTitle: "Installed",
			officialTitle: "Official",
			statusProblem: "Problem",
			statusBeta: "Experimental",
			reasonLabel: "Reason",
			metadataError: "Package metadata error: {error}",
			versionTag: "v{version}",
			partsLabel: "Components",
			partsEmpty: "This plugin pack contains no components.",
			partsCountTotal: "{count} total",
			partsCountRunning: "{count} running",
			partsCountOff: "{count} off",
			partOff: "Off",
			partsCountFailed: "{count} failed",
			partsFilter: "Filter components",
			partsFilterEmpty: "No component matches.",
			partToggle: "Enable component {name}",
			rowPhasePending: "Waiting for dependencies",
			rowPhaseLoading: "Loading",
			rowPhaseActive: "Running",
			rowPhaseFailed: "Problem",
			rowPhaseUnloading: "Unloading",
			enableToggle: "Enable {name}",
			openDetail: "View {name}",
			backToList: "Back to plugins",
			crumbRoot: "Plugins",
			backToPackage: "Back to {name}",
			configureRow: "Configure {name}",
			rowStateIdle: "Not running",
			uninstall: "Uninstall",
			uninstallLabel: "Uninstall {name}",
			installTitle: "Add plugin",
			installArchiveTitle: "Install plugin package (TGZ)",
			installArchiveDescription: "Install the local package below. Center packages are downloaded and verified; the native manager handles dependencies.",
			installDescription: "Enter the plugin's package name, GitHub repository address, or local directory path.",
			installSpecLabel: "Package name or address",
			installSpecPlaceholder: "for example @deepseek-ai/dsh-experimental-auto-review",
			installGuideToggle: "Install guide and examples",
			installGuideHide: "Hide the guide",
			installGuideIdTitle: "Package name",
			installGuideIdExample: "@deepseek-ai/dsh-experimental-auto-review",
			installGuideIdHint: "The plugin package name is the npm package name (like dsh-xxx or @author/plugin): the part after dsh plugin add or pnpm add in a community plugin's README install command.",
			installGuideGitTitle: "GitHub repository address",
			installGuideGitExample: "https://github.com/author/dsh-plugin",
			installGuideGitHint: "The address of the plugin's open-source repository on GitHub; other Git hosts work too.",
			installGuidePathTitle: "Local plugin directory",
			installGuidePathExample: "/Users/name/my-plugin",
			installGuidePathHint: "The absolute path of a plugin directory on this machine, developed here or downloaded.",
			installGuideExampleLabel: "Example: ",
			installGuideFill: "Use example",
			installGuideFillAria: "Use the example {example}",
			installGuideSafety: "Install only plugins you trust: they run with your permissions and can damage DeepSeek Harness or leak your data.",
			registryToggle: "Registry",
			registryLegend: "The npm registry the plugin is downloaded from",
			registryDefault: "Default registry",
			registryNpmmirror: "Mainland China mirror",
			registryWithHost: "{name} ({host})",
			registryCustom: "Custom address",
			registryCustomPlaceholder: "https://npm.example.com/",
			registryCustomHint: "A company or private npm registry; for one that needs a login, keep the credentials in ~/.npmrc on this machine",
			registryCustomInvalid: "Enter an address starting with http:// or https://",
			registryListSeparator: ", ",
			installRun: "Install",
			installChecking: "Checking…",
			installProblemInvalid: "This is not a package name or address that can be installed: {reason}",
			installProblemInstalled: "This plugin is already installed",
			installProblemNotFound: "No such plugin was found",
			installProblemNotPackage: "The path does not exist or is not a valid plugin package",
			installProblemNotBundle: "This package declares no bundle, so it cannot be installed as a plugin: {reason}",
			installProblemNetwork: "The plugin registry could not be reached; check the network and try again",
			installProblemNetworkAll: "No registry could be reached (tried: {registries}); check the network or proxy settings, or change the registry",
			installProblemUnknown: "The plugin could not be looked up: {reason}",
			installingTitle: "Installing the plugin…",
			installedTitle: "Installed",
			installFailedTitle: "The plugin could not be installed",
			installGithubFailedTitle: "Cannot access GitHub",
			installGithubTimeoutTitle: "GitHub connection timed out",
			installGithubFailedDescription: "Try another installation source.",
			installUseGithubMirror: "Use mainland China mirror",
			installPackageLabel: "Plugin package name",
			installEdit: "Edit",
			installEditAria: "Back to editing",
			installCancelAndEdit: "Cancel installation and return to editing",
			installApplyingCancellationError: "Cancellation was not confirmed. Installation is being applied; wait for its result. {reason}",
			installReconcile: "Check installation status",
			installUnknownTitle: "Installation result unavailable",
			installUnknownDescription: "The Host has no active installation with this request id. Check the plugin list before trying again.",
			installResultUnconfirmed: "The installation result was not received. Check installation status. {reason}",
			installAwaitingAcceptance: "Waiting for the Host to accept installation. Cancellation will retry automatically after confirmation.",
			installBackgroundUnknown: "Installation result unavailable. Check the plugin list.",
			installCancel: "Cancel install",
			installCloseCancels: "Cancel install and close",
			installViewTask: "View installation",
			installUnconfirmedTitle: "Installation status unconfirmed",
			installBackgroundDone: "Installation finished. View installation details.",
			installBackgroundFailed: "Installation failed. View installation details.",
			installBackgroundUnconfirmed: "Installation status is unconfirmed. View the installation for details.",
			installBackgroundApplying: "Installation is being applied and cannot be cancelled. View installation progress.",
			installStarting: "Preparing installation…",
			installCancelling: "Stopping installation…",
			installApplying: "Applying configuration, please wait…",
			installCancelledShort: "Cancelled",
			installCancelled: "Installation cancelled; the plugin is not enabled, and downloaded files may remain",
			installCancelUnconfirmed: "Installation has not been confirmed stopped. Retry cancellation or wait for the installation result. {reason}",
			installEnableNow: "Enable now",
			installDetailsShow: "Show install details",
			installDetailsHide: "Hide install details",
			installVersion: "Version {version}",
			installSubjectPath: "Local directory",
			installSubjectGit: "Git repository",
			installSubjectTarball: "Tarball",
			installLocation: "Installs into {dir}",
			installRetry: "Retry",
			installChangeRegistry: "Change registry",
			installAttempt: "{previous} could not serve the package; retrying through {registry} (registry {index} of {total})",
			installAttemptBadge: "Attempt {index} · {registry}",
			installFailureNetwork: "The network connection failed",
			installFailureNetworkAll: "No registry could be reached (tried: {registries}). Check the network or proxy settings, or change the registry and retry.",
			installFailureNetworkHost: "{host} could not be reached. A GitHub address or a .tgz link is not fetched through the registry: this machine must reach it directly or through a proxy. If the plugin is also published to npm, enter its package name instead.",
			installFailureNotFound: "No such plugin was found",
			installFailureNoMatchingVersion: "No version matches the request",
			installFailureDiskFull: "The disk is full; the install stopped",
			installFailurePermission: "No write permission; the plugin cannot be installed",
			installFailureBuildBlocked: "A dependency's install scripts need your permission before the install can continue",
			installFailureBuildBlockedManual: "pnpm blocked install scripts; allow them under allowBuilds in pnpm-workspace.yaml and retry",
			installFailureIntegrity: "The downloaded package failed its integrity check",
			installFailureTimeout: "The install timed out",
			installFailurePnpmMissing: "pnpm was not found, so nothing can be installed",
			installFailureGeneric: "Something went wrong during the install; the details say what",
			terminalRunning: "Running",
			terminalFailed: "Failed",
			terminalDone: "Done",
			terminalCopy: "Copy",
			terminalCopied: "Copied",
			terminalNoOutput: "No output",
			terminalCollapseAria: "Collapse output",
			terminalCollapse: "Collapse",
			terminalExpandAria: "Expand the remaining {n} output lines",
			terminalExpand: "… {n} more lines",
			terminalExitCode: "exit code {code}",
			terminalSignal: "signal {signal}",
			terminalNoExitCode: "no exit code",
			installDoneNothing: "Install finished with no new dependency.",
			installDoneEnable: "The package is installed in this Profile but is not enabled. Click Enable now to finish.",
			installDoneRestart: "Installed; it loads at the next start.",
			installDoneApproved: "Install scripts allowed for {names}",
			installApprovalTitle: "Install scripts need permission",
			installApprovalDescription: "These packages have install scripts that pnpm did not run.",
			installApprovalConsequence: "Once allowed, the scripts run here with your permissions, and the permission is saved in this profile.",
			installApprovalCaution: "Allow only packages you trust.",
			installApproveAndRetry: "Allow these scripts and retry",
			installClose: "Done",
			close: "Close",
			cancel: "Cancel",
			confirmUninstallTitle: "Uninstall \"{name}\"?",
			confirmUninstallDescription: "What it provides goes away once it is uninstalled.",
			confirmUninstall: "Uninstall",
			failedEnable: "Could not enable: {reason}",
			failedDisable: "Could not disable: {reason}",
			failedUninstall: "Could not uninstall: {reason}",
			failedRowEnable: "Could not enable the component: {reason}",
			failedRowDisable: "Could not disable the component: {reason}",
			reasonManagementRequired: "Plugin management needs it; it cannot be switched off or uninstalled.",
			reasonUnaddressable: "The profile patch cannot address this one uniquely.",
			reasonUnknownPlugin: "No such plugin.",
			reasonInvalidSpec: "Enter a valid package name or address.",
			reasonAmbiguousInstall: "Which package was installed cannot be told from the dependency change.",
			reasonNotBundle: "This package declares no bundle, so it cannot be managed as a plugin.",
			reasonNotRemovable: "This package is not owned by the profile, or plugin management needs it.",
			reasonStopProfile: "This profile runs without HMR; stop it and uninstall the package with dsh plugin.",
			reasonBundleInUse: "Other configuration still uses this bundle's components; switch them off first.",
			reasonStaleApproval: "The pending script approvals changed; install again to refresh them.",
			reasonIncompatibleVersion: "{plugin} is incompatible with DSH {runtime} (requires {peers}); running it may cause crashes or data loss. Install a plugin version compatible with this DSH.",
			reasonIncompatibleVersionUnnamed: "This plugin is incompatible with the running DSH version; running it may cause crashes or data loss.",
			reasonOperationError: "The Host reported an error."
		};
		//#endregion
		//#region src/client/index.ts
		/** Dictionary namespace owned by this plugin. */
		const NS = "bkmsPluginCenter";
		/** The id shared by the sidebar entry and the main panel it opens. */
		const PANEL_ID = "bkms-plugin-center";
		/** Services required by the sidebar registration and the Remote methods; the inventory says whether the Host manages a profile. */
		const inject = [
			"slots",
			"locale",
			"remote",
			"remote.pluginManager",
			"remote.pluginInventory",
			"remote.pluginRegistryProbe",
			"configForms"
		];
		/**
		* Contribute the Plugins entry to the sidebar with the management page it
		* opens, and keep it current on the Host's change events.
		* @param ctx - the browser plugin context.
		*/
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, {
				zh,
				en
			}), "bkms-plugin-center: dictionaries");
			const t = ctx.locale.bind(NS);
			const controller = new PluginManagerController(ctx);
			ctx.effect(() => () => {
				controller.dispose();
			}, "bkms-plugin-center: controller");
			ctx.effect(() => {
				const refresh = () => {
					if (controller.getSnapshot().status !== "idle") controller.load();
				};
				const disposers = [
					ctx.remote.$on("plugin-manager/changed", refresh),
					ctx.remote.$on("plugin-manager/install-log", (chunk) => {
						controller.appendLog(chunk);
					}),
					ctx.remote.$on("plugin-manager/install-state", (progress) => {
						controller.installProgress(progress);
					}),
					ctx.on("connection/reset", refresh)
				];
				return () => {
					for (const dispose of disposers) dispose();
				};
			}, "bkms-plugin-center: host invalidations");
			const configLedger = configLedgerSource(ctx);
			ctx.slots.inject("main", () => ctx.slots.register({
				name: "main",
				key: PANEL_ID,
				locale: NS,
				inject: () => controller.inject(configLedger, (text) => ctx.locale.resolveText(text)),
				children: {
					"bkmsPlugins.item": {
						kind: "list",
						scope: "root"
					},
					"bkmsPlugins.bundle.activation": {
						kind: "keyed",
						scope: "root"
					},
					"bkmsPlugins.bundle.config": {
						kind: "keyed",
						scope: "root"
					},
					"bkmsPlugins.row.config": {
						kind: "keyed",
						scope: "root"
					},
					"bkmsPlugins.detail.actions": {
						kind: "list",
						scope: "root"
					},
					"bkmsPlugins.detail.badge": {
						kind: "list",
						scope: "root"
					},
					"bkmsPlugins.detail.section": {
						kind: "list",
						scope: "root"
					}
				}
			}, CenterPage));
			ctx.slots.inject("main", () => mirrorPluginSlots(ctx));
			ctx.slots.inject("shell.overlay", () => ctx.slots.register({
				name: "shell.overlay",
				id: "bkms-plugin-center.sync-notice",
				locale: NS
			}, SyncNotice));
			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "bkms-plugin-center-settings",
				order: 42,
				label: () => t("panel"),
				locale: NS
			}, CenterSettingsPage));
			ctx.slots.inject("sidebar.panellist", () => {
				let remove;
				const update = () => {
					if (centerSettings.getSnapshot().visible && !remove) remove = ctx.slots.register({
						name: "sidebar.panellist",
						id: PANEL_ID,
						order: 0,
						label: () => t("panel"),
						locale: NS
					}, PluginsPanelIcon);
					else if (!centerSettings.getSnapshot().visible && remove) {
						remove();
						remove = void 0;
					}
				};
				update();
				const unsubscribe = centerSettings.subscribe(update);
				return () => {
					unsubscribe();
					remove?.();
				};
			});
		}
		//#endregion
		exports.NS = NS;
		exports.PANEL_ID = PANEL_ID;
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map