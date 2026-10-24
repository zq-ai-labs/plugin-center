export type SyncNotice = { id: string; kind: 'reload' | 'restart'; at: number; items: { packageName: string; name: string; version: string; note: string }[] }
export type SyncProgress = { phase: 'queued' | 'downloading' | 'installing' | 'applying' | 'done' | 'failed'; received: number; total: number; detail: string; source: 'auto' | 'manual'; action: 'install' | 'upgrade'; version: string; error: string; effect?: string; at: number }
export type SyncRow = { packageName: string; name: string; target: string; installed: string | null; enabled: boolean; installMode: string; autoUpgrade: boolean; restart: string; state: string; message: string; failures: number; lastError: string }
export type SyncStatus = {
  available: boolean; reason?: string; autoSync: boolean; center: string; centerSource: string; running: boolean; nextCheckAt: number | null
  lastCheck: string | null; lastError: string; revision: number | null; conflict: string
  plugins: SyncRow[]; progress: Record<string, SyncProgress>
  history: { at: string; packageName: string; name?: string; action: string; from: string | null; to: string; ok: boolean; effect?: string; error?: string; source?: 'auto' | 'manual' }[]
  notices: SyncNotice[]
}
type State = { visible: boolean; address: string; source: string; autoSync: boolean; hostReady: boolean; sync: SyncStatus | null; syncBusy: boolean; syncError: string }
const storageKey = 'bkms-plugin-center.preferences'
const oldAddressKey = 'bkms-plugin-center.catalog-url'
const fallback = 'https://118.145.114.8/plugin-center/plugins.json'
/** 刷新提示只针对本次页面加载之前完成的更新。 */
const pageLoadedAt = Date.now()
export function normalizeCenterAddress(value: string): string {
  const url = new URL(value.trim())
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('请填写 HTTP 或 HTTPS 中心地址')
  if (!url.pathname.endsWith('/plugins.json')) url.pathname = url.pathname.replace(/\/$/, '') + '/plugins.json'
  url.search = ''; url.hash = ''
  return url.href
}
/** 旧版本只在浏览器保存地址；首次连接宿主时迁移到宿主配置。 */
function browserAddress(): string | null {
  try {
    const value = JSON.parse(localStorage.getItem(storageKey) || '{}')
    const saved = value.address || localStorage.getItem(oldAddressKey)
    return saved ? normalizeCenterAddress(saved) : null
  } catch { return null }
}
function initial(): State {
  let value: any = {}
  try { value = JSON.parse(localStorage.getItem(storageKey) || '{}') } catch { /* Use defaults for unavailable storage. */ }
  return { visible: value.visible !== false, address: browserAddress() ?? fallback, source: 'browser', autoSync: true, hostReady: false, sync: null, syncBusy: false, syncError: '' }
}
let state = initial()
const listeners = new Set<() => void>()
const patch = (next: Partial<State>) => { state = { ...state, ...next }; listeners.forEach(fn => fn()) }
function save(next: Partial<State>) {
  const value = { ...state, ...next }
  localStorage.setItem(storageKey, JSON.stringify({ visible: value.visible, address: value.address }))
  patch(next)
}
async function api(path: string, body?: unknown): Promise<any> {
  const url = new URL('api/bkms-plugin-center/' + path, document.baseURI)
  const response = await fetch(url.pathname + url.search, body === undefined ? { cache: 'no-store' } : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const text = await response.text()
  let result: any
  try { result = JSON.parse(text) } catch { throw new Error('插件中心接口未加载，请更新插件并完全退出 DSH 后重启') }
  if (!response.ok) throw new Error(result.error || '请求失败')
  return result
}
function applyConfig(config: any) {
  if (config?.available === false) return
  patch({ address: config.address, source: config.source, autoSync: config.autoSync, hostReady: true })
}
let started = false, pollTimer: ReturnType<typeof setTimeout> | undefined
/** 有安装进行中时每秒刷新进度，否则每 30 秒（窗口不可见时跳过）。 */
function schedulePoll() {
  if (pollTimer) clearTimeout(pollTimer)
  const active = Object.values(state.sync?.progress ?? {}).some(p => p.phase !== 'done' && p.phase !== 'failed')
  pollTimer = setTimeout(() => { if (active || document.visibilityState === 'visible') void centerSettings.refreshSync(); else schedulePoll() }, active ? 1000 : 30000)
}
async function connect() {
  try {
    let config = await api('config')
    const local = browserAddress()
    if (config.available !== false && config.source !== 'saved' && local && local !== config.address) config = await api('config', { address: local })
    applyConfig(config)
  } catch { /* 宿主未加载新接口时沿用浏览器地址。 */ }
  await centerSettings.refreshSync()
}
export const centerSettings = {
  getSnapshot: () => state,
  subscribe: (fn: () => void) => {
    listeners.add(fn)
    if (!started) {
      started = true
      void connect()
      // 后端自动更新的状态与提示：每次读取后按是否有安装进行中安排下次读取，回到窗口时立即读取。
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void centerSettings.refreshSync() })
    }
    return () => { listeners.delete(fn) }
  },
  setVisible: (visible: boolean) => save({ visible }),
  async setAddress(address: string) {
    address = normalizeCenterAddress(address)
    if (state.hostReady) applyConfig(await api('config', { address }))
    // 浏览器保留一份，作为宿主接口不可用时的回退。
    save({ address })
    void centerSettings.refreshSync()
  },
  async setAutoSync(autoSync: boolean) {
    applyConfig(await api('config', { autoSync }))
    await centerSettings.refreshSync()
  },
  async refreshSync() {
    try { patch({ sync: await api('sync?since=' + pageLoadedAt), syncError: '' }) }
    catch (error) { patch({ syncError: error instanceof Error ? error.message : String(error) }) }
    finally { schedulePoll() }
  },
  /** 在后台直接安装或更新 BKMS 插件（目录条目 url），立即返回；进度从同步状态读取。失败时抛出原因。 */
  async installPlugin(url: string) {
    patch({ sync: await api('sync/install', { plugin: url }) })
    schedulePoll()
  },
  /** 执行一次后端同步动作（立即检查 / 重试），完成后更新状态。 */
  async syncAction(path: 'sync/check' | 'sync/retry', body: unknown = {}) {
    patch({ syncBusy: true, syncError: '' })
    try { patch({ sync: await api(path, body) }); await centerSettings.refreshSync() }
    catch (error) { patch({ syncError: error instanceof Error ? error.message : String(error) }) }
    finally { patch({ syncBusy: false }) }
  },
}
