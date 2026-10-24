// 本地 UI 预览：用示例数据渲染真实的 CenterPage / CenterSettingsPage / SyncNotice，不连接真实中心或 DSH。
import { createRoot } from 'react-dom/client'
import { CenterPage } from '../../src/client/CenterPage.tsx'
import { CenterSettingsPage } from '../../src/client/CenterSettingsPage.tsx'
import { SyncNotice } from '../../src/client/SyncNotice.tsx'

const params = new URLSearchParams(location.search)
if (params.get('dark')) document.body.setAttribute('data-ds-dark-theme', '')
const artifact = { sha256: 'a'.repeat(64), size: 1 }
const catalog = [
  { name: 'BKMS 品牌主题', packageName: '@bkms/brand', version: '1.4.0', description: { zh: '统一 BKMS 客户端的品牌色、图标与登录页样式，适配浅色和深色主题。' }, artifact },
  { name: 'BKMS 工作台', packageName: '@bkms/workbench', version: '2.1.0', description: { zh: '邮件规则、任务审阅与草稿工作台，帮助团队在一个界面里处理日常事务。' }, artifact },
  { name: '标书编写助手', packageName: '@zq/dsh-bid-writer', version: '0.9.2', description: { zh: '从招标文件提取评分项，生成大纲、正文与资格证明，并导出受控 Word 文件。' }, artifact },
  { name: 'dsh-imagegen', packageName: '@dickpy/dsh-imagegen', version: '1.5.12', description: { zh: '在会话中生成和编辑图片。' }, artifact },
  { name: 'BKMS 知识库检索', packageName: '@bkms/kb-search', version: '0.3.0', description: { zh: '连接企业知识库，按权限检索文档并在回答中引用来源。' } },
  { name: 'Univer 办公套件', packageName: 'dsh-univer-office', version: '0.6.1', description: { zh: '' }, artifact },
].map((p, i) => ({ ...p, url: `http://center/plugins/${i}` }))
const packages = [
  { name: '@bkms/brand', version: '1.2.0', installed: true, enabled: true },
  { name: '@bkms/workbench', version: '2.1.0', installed: true, enabled: true },
  { name: '@dickpy/dsh-imagegen', version: '1.5.12', installed: true, enabled: false },
]
const now = Date.now()
const sync = {
  available: true, autoSync: true, center: 'http://127.0.0.1:8091/plugins.json', centerSource: 'saved', running: false, nextCheckAt: now + 240000,
  lastCheck: new Date(now - 60000).toISOString(), lastError: '', revision: 7, conflict: '',
  plugins: [
    { packageName: '@bkms/brand', name: 'BKMS 品牌主题', target: '1.4.0', installed: '1.2.0', enabled: true, installMode: 'automatic', autoUpgrade: true, restart: 'reload', state: 'running', message: '', failures: 0, lastError: '' },
    { packageName: '@bkms/workbench', name: 'BKMS 工作台', target: '2.1.0', installed: '2.1.0', enabled: true, installMode: 'required', autoUpgrade: true, restart: 'restart', state: 'current', message: '', failures: 0, lastError: '' },
    { packageName: '@bkms/kb-search', name: 'BKMS 知识库检索', target: '0.3.0', installed: null, enabled: false, installMode: 'automatic', autoUpgrade: false, restart: 'auto', state: 'paused', message: '连续失败 3 次，已暂停', failures: 3, lastError: 'install-failed：网络超时' },
  ],
  progress: {
    '@bkms/brand': { phase: 'downloading', received: 1887436, total: 4008556, detail: '', source: 'auto', action: 'upgrade', version: '1.4.0', error: '', at: now },
    '@zq/dsh-bid-writer': { phase: 'installing', received: 0, total: 0, detail: 'Progress: resolved 105, reused 6, downloaded 1, added 4', source: 'manual', action: 'install', version: '0.9.2', error: '', at: now },
    'dsh-univer-office': { phase: 'failed', received: 0, total: 0, detail: '', source: 'manual', action: 'install', version: '0.6.1', error: 'operation-error：[ERR_PNPM_EPERM] EPERM: operation not permitted, symlink …', at: now },
  },
  history: [{ at: new Date(now - 3600000).toISOString(), packageName: '@bkms/workbench', name: 'BKMS 工作台', action: 'upgrade', from: '2.0.3', to: '2.1.0', ok: true, effect: 'restart' }],
  notices: [{ id: 'n1', kind: 'restart', at: now - 3600000, items: [{ packageName: '@bkms/workbench', name: 'BKMS 工作台', version: '2.1.0', note: '包含新的后端服务' }] }],
}
const realFetch = window.fetch.bind(window)
window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const path = new URL(String(input), location.href).pathname
  const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } })
  await new Promise(r => setTimeout(r, 300))
  if (path.endsWith('/catalog')) return json({ center: sync.center, plugins: params.get('empty') ? [] : catalog })
  if (path.endsWith('/config')) return json({ address: sync.center, source: 'saved', autoSync: true })
  if (path.endsWith('/sync') || path.includes('/sync/')) return json(sync)
  return realFetch(input, init)
}
const state = { packages, busy: [] as string[] }
const props: any = {
  usePluginManager: (select: (s: typeof state) => unknown) => select(state),
  openInstall: () => alert('打开原生安装窗口'), editInstallSpec: () => {}, setEnabled: () => {},
}
;(window as any).__INSTALLED__ = () => <div style={{ padding: 32, color: 'var(--dsw-alias-label-secondary)' }}>（官方“已安装插件”页面，预览中省略）</div>
const view = params.get('view') ?? 'catalog'
createRoot(document.getElementById('root')!).render(view === 'settings' ? <CenterSettingsPage /> : <><CenterPage {...props} /><SyncNotice /></>)
