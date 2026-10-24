import { useMemo, useState, useSyncExternalStore } from 'react'
import {
  Button, IconCheckCircleFillRegular, IconDownloadOutlineRegular, IconPluginPinwheelOutlineRegular,
  IconRefreshOutlineRegular, IconSearchOutlineRegular, IconWarningOutlineRegular, Input, Pill,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { centerSettings, type SyncProgress } from './center-settings.ts'
import { PluginManagerPage, type PluginManagerPageProps } from './PluginManagerPage.tsx'
import css from './CenterPage.module.css'

type Item = { name: string; url: string; version?: string; description?: { zh?: string }; packageName?: string; artifact?: unknown; npm?: string; tarball?: string; category?: string }
type Filter = 'all' | 'installed' | 'updates' | 'available'
const filters: { key: Filter; label: string }[] = [{ key: 'all', label: '全部' }, { key: 'updates', label: '可更新' }, { key: 'installed', label: '已安装' }, { key: 'available', label: '未安装' }]
const palette = ['#4f6bed', '#0f9d8a', '#d9822b', '#9b51e0', '#e04f6b', '#2d9cdb', '#6c8a2b']

/** 简单语义版本比较，只用于提示是否有更新。 */
function newer(target?: string, current?: string): boolean {
  const parse = (v?: string) => /^(\d+)\.(\d+)\.(\d+)(?:-(.+))?/.exec(v ?? '')
  const a = parse(target), b = parse(current)
  if (!a || !b) return false
  for (let i = 1; i <= 3; i++) if (Number(a[i]) !== Number(b[i])) return Number(a[i]) > Number(b[i])
  return !a[4] && !!b[4]
}
function initial(name: string): string {
  const text = name.replace(/^@[^/]+\//, '').replace(/^(dsh|bkms)[-_]/i, '')
  return (text.match(/[\p{L}\p{N}]/u)?.[0] ?? '?').toUpperCase()
}
function colorOf(name: string): string {
  let hash = 0
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0
  return palette[hash % palette.length]!
}

const phaseText: Record<SyncProgress['phase'], string> = { queued: '排队中', downloading: '正在下载', installing: '正在安装依赖', applying: '正在启用', done: '已完成', failed: '失败' }
const size = (bytes: number) => bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`

/** 卡片上的安装进度：下载阶段按字节显示百分比，其余阶段为不确定进度并显示官方安装器的最新输出。 */
function InstallProgress({ progress }: { progress: SyncProgress }) {
  const percent = progress.phase === 'downloading' && progress.total > 0 ? Math.min(100, Math.round(progress.received / progress.total * 100)) : null
  return <div className={css.progress} role="status" aria-live="polite">
    <div className={css.progressHead}>
      <span>{progress.source === 'auto' ? '自动' : ''}{progress.action === 'upgrade' ? '更新' : '安装'} v{progress.version} · {phaseText[progress.phase]}</span>
      {percent !== null && <span className={css.percent}>{percent}%</span>}
    </div>
    <div className={css.track}><div className={percent === null ? css.barIndeterminate : css.bar} style={percent === null ? undefined : { width: `${percent}%` }} /></div>
    {percent !== null ? <div className={css.progressDetail}>{size(progress.received)} / {size(progress.total)}</div>
      : progress.detail && <div className={css.progressDetail} title={progress.detail}>{progress.detail}</div>}
  </div>
}

export function CenterPage(props: PluginManagerPageProps) {
  const inventory = props.usePluginManager(snapshot => snapshot)
  const preferences = useSyncExternalStore(centerSettings.subscribe, centerSettings.getSnapshot)
  const [tab, setTab] = useState<'installed' | 'catalog'>('installed')
  const [items, setItems] = useState<Item[]>([]), [loadedCenter, setLoadedCenter] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const [working, setWorking] = useState(''), [query, setQuery] = useState(''), [filter, setFilter] = useState<Filter>('all')
  const [cardError, setCardError] = useState<Record<string, string>>({})
  const progressOf = (name: string) => preferences.sync?.progress?.[name]
  const center = preferences.address
  const loaded = loadedCenter === center
  async function request(path: string, extra: Record<string, string> = {}) {
    const url = new URL('api/bkms-plugin-center/' + path, document.baseURI)
    url.search = new URLSearchParams({ center, ...extra }).toString()
    const response = await fetch(url.pathname + url.search)
    const text = await response.text()
    if (!text.trim()) throw new Error('BKMS 中心接口未加载，请完全退出 DSH 后重启')
    let result
    try { result = JSON.parse(text) } catch { throw new Error('接口返回内容不正确，请检查客户端版本') }
    if (!response.ok) throw new Error(result.error || '操作失败，请重试')
    return result
  }
  async function load() {
    setLoadedCenter(''); setBusy(true); setError('')
    try { const value = await request('catalog'); setItems(value.plugins); setLoadedCenter(center) }
    catch (e) { setError(String(e instanceof Error ? e.message : e)) }
    finally { setBusy(false) }
  }
  /** 直接在 DSH 后台下载、校验并安装，进度显示在卡片上；不弹出原生安装窗口。 */
  async function install(item: Item) {
    setWorking(item.url); setCardError(errors => ({ ...errors, [item.url]: '' }))
    try {
      if (!item.artifact) throw new Error('该插件尚未上传并发布 .tgz 包，请先在服务端上传')
      await centerSettings.installPlugin(item.url)
    } catch (e) { setCardError(errors => ({ ...errors, [item.url]: String(e instanceof Error ? e.message : e) })) }
    finally { setWorking('') }
  }
  function open(next: 'installed' | 'catalog') {
    setTab(next)
    if (next === 'catalog' && !loaded && !busy) void load()
  }

  const rows = useMemo(() => (loaded ? items : []).map(item => {
    const installed = inventory.packages.find(pkg => pkg.name === (item.packageName || item.npm || item.name) && pkg.installed)
    return { item, installed, update: !!installed && newer(item.version, installed.version) }
  }), [items, loaded, inventory.packages])
  const updates = rows.filter(row => row.update).length
  const q = query.trim().toLowerCase()
  const visible = rows.filter(({ item, installed, update }) =>
    (!q || `${item.name} ${item.packageName ?? ''} ${item.description?.zh ?? ''}`.toLowerCase().includes(q))
    && (filter === 'all' || (filter === 'installed' && installed) || (filter === 'updates' && update) || (filter === 'available' && !installed)))

  return <div className={css.shell}>
    <div className={css.topbar}>
      <div className={css.brand}><span className={css.brandMark}><IconPluginPinwheelOutlineRegular /></span>BKMS 插件中心</div>
      <div className={css.segment} role="tablist" aria-label="插件视图">
        <button type="button" role="tab" className={css.segmentItem} aria-selected={tab === 'installed'} onClick={() => open('installed')}>已安装插件</button>
        <button type="button" role="tab" className={css.segmentItem} aria-selected={tab === 'catalog'} onClick={() => open('catalog')}>BKMS 插件{updates > 0 && <span className={css.count} aria-label={`${updates} 个可更新`}>{updates}</span>}</button>
      </div>
    </div>
    <div className={css.body}>
      {tab === 'installed' ? <PluginManagerPage {...props} /> : <section className={css.catalog}>
        <div className={css.head}>
          <div>
            <h2 className={css.title}>BKMS 插件</h2>
            <p className={css.intro}>来自 {center}{loaded ? ` · 共 ${items.length} 个` : ''}</p>
          </div>
          <div className={css.tools}>
            <Input className={css.search} icon={<IconSearchOutlineRegular />} placeholder="搜索插件" aria-label="搜索 BKMS 插件" value={query} onChange={e => setQuery(e.target.value)} />
            <Button variant="outline" icon={<IconRefreshOutlineRegular />} disabled={busy} onClick={() => void load()}>{busy ? '正在刷新…' : '刷新'}</Button>
          </div>
        </div>
        {loaded && items.length > 0 && <div className={css.filters}>
          {filters.map(f => <Pill key={f.key} active={filter === f.key} onClick={() => setFilter(f.key)}>{f.label}{f.key === 'updates' && updates ? ` ${updates}` : ''}</Pill>)}
        </div>}
        {error && <p role="alert" className={css.alert}><IconWarningOutlineRegular />{error}。请在“DSH 设置 → BKMS 插件中心”检查中心地址后刷新。</p>}
        {busy && !loaded ? <ul className={css.grid} aria-busy="true">{[0, 1, 2].map(i => <li key={i} className={css.skeleton} />)}</ul>
          : loaded && !items.length ? <div className={css.empty}><span className={css.emptyIcon}><IconPluginPinwheelOutlineRegular /></span>中心暂无已上架插件</div>
          : loaded && !visible.length ? <div className={css.empty}>没有符合条件的插件</div>
          : <ul className={css.grid}>{visible.map(({ item, installed, update }) => {
            const name = item.packageName || item.name
            const progress = progressOf(name)
            const active = !!progress && progress.phase !== 'done' && progress.phase !== 'failed'
            const finished = progress?.phase === 'done' && progress.version === item.version
            const current = finished || (!!installed && !update && installed.version === item.version)
            const failure = cardError[item.url] || (progress?.phase === 'failed' ? progress.error : '')
            return <li key={item.url} className={css.card}>
              <div className={css.cardHead}>
                <span className={css.avatar} style={{ background: colorOf(name) }} aria-hidden="true">{initial(item.name)}</span>
                <div className={css.nameBlock}>
                  <h3 className={css.name} title={item.name}>{item.name}</h3>
                  {item.packageName && item.packageName !== item.name && <div className={css.pkg} title={item.packageName}>{item.packageName}</div>}
                </div>
              </div>
              <p className={css.desc}>{item.description?.zh || '暂无简介'}</p>
              <div className={css.badges}>
                {!installed && <span className={css.badge}>未安装</span>}
                {installed && <span className={css.badge} data-tone={installed.enabled ? 'success' : 'warning'}>{installed.enabled ? <><IconCheckCircleFillRegular />已启用</> : '已安装，未启用'}</span>}
                {update && <span className={css.badge} data-tone="update">可更新：{installed!.version} → {item.version}</span>}
                {!item.artifact && <span className={css.badge} data-tone="warning">缺少发布包</span>}
                {finished && <span className={css.badge} data-tone="success"><IconCheckCircleFillRegular />{progress!.action === 'upgrade' ? '已更新' : '已安装'} v{progress!.version}</span>}
              </div>
              {active && <InstallProgress progress={progress!} />}
              {failure && !active && <p role="alert" className={css.cardError} title={failure}><IconWarningOutlineRegular />{failure}</p>}
              <div className={css.cardFoot}>
                <span className={css.version}>{item.version ? `v${item.version}` : ''}{installed && !update && !finished && installed.version !== item.version ? ` · 本机 v${installed.version}` : ''}</span>
                {installed && !installed.enabled && !active && <Button size="sm" disabled={inventory.busy.length > 0} onClick={() => { props.setEnabled(installed.name, true); setTab('installed') }}>启用</Button>}
                <Button size="sm" variant={current ? 'ghost' : 'primary'} icon={current || active ? undefined : <IconDownloadOutlineRegular />} disabled={!!working || active || current || !item.artifact}
                  onClick={() => void install(item)}>{active ? (progress!.action === 'upgrade' ? '正在更新…' : '正在安装…') : working === item.url ? '正在开始…' : !item.artifact ? '不可安装' : current ? '已是最新' : failure ? '重试' : update ? '更新' : '安装'}</Button>
              </div>
            </li>
          })}</ul>}
        <p className={css.hint}>点击安装或更新后，DSH 在后台下载、校验中心发布的 .tgz 并安装启用，进度显示在卡片上；需要刷新界面或重启时会另行提示。中心按分发规则推送的插件也会自动安装，设置见“DSH 设置 → BKMS 插件中心”。</p>
      </section>}
    </div>
  </div>
}
