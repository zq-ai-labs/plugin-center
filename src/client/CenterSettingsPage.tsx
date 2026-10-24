import { useState, useSyncExternalStore, useEffect } from 'react'
import { Button, IconRefreshOutlineRegular, Input, Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import { centerSettings, type SyncRow, type SyncStatus } from './center-settings.ts'
import css from './CenterSettingsPage.module.css'

type Tone = 'success' | 'active' | 'error' | undefined
/** 每个插件的状态：文字与徽标颜色。 */
const states: Record<string, [string, Tone]> = {
  current: ['已是最新', 'success'], done: ['已完成', 'success'], install: ['待安装', 'active'], upgrade: ['待升级', 'active'],
  queued: ['排队中', 'active'], running: ['正在安装', 'active'], failed: ['失败', 'error'], 'waiting-retry': ['等待重试', 'error'],
  paused: ['已暂停', 'error'], conflict: ['已暂停', 'error'], 'user-removed': ['已卸载', undefined], manual: ['手工管理', undefined],
  outdated: ['有新版本', undefined], builtin: ['内置', undefined], scheduled: ['等待检查', undefined], unsupported: ['暂不支持', undefined], 'unknown-version': ['版本未知', 'error'],
}
const modes: Record<string, string> = { manual: '手工管理', automatic: '自动维护', required: '强制维护' }
const clock = (value: string | number | null) => {
  if (!value) return '—'
  const date = new Date(value), today = new Date().toDateString() === date.toDateString()
  return today ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : date.toLocaleString([], { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function PluginItem({ row, busy }: { row: SyncRow; busy: boolean }) {
  const [label, tone] = states[row.state] ?? [row.state, undefined]
  const version = !row.installed ? `未安装 · 目标 ${row.target}` : row.installed === row.target ? `v${row.installed}` : `v${row.installed} → ${row.target}`
  const retry = row.state === 'paused' || row.state === 'failed' || row.state === 'waiting-retry'
  return <li className={css.item}>
    <div className={css.itemMain}>
      <div className={css.itemName} title={row.packageName}>{row.name}</div>
      <div className={css.itemMeta}>{version} · {modes[row.installMode] ?? row.installMode}{row.autoUpgrade ? ' · 自动升级' : ''}</div>
      {row.lastError && retry && <div className={css.itemError} title={row.lastError}>{row.lastError.length > 160 ? row.lastError.slice(0, 160) + '…' : row.lastError}</div>}
    </div>
    {retry && <Button size="sm" disabled={busy} onClick={() => void centerSettings.syncAction('sync/retry', { name: row.packageName })}>重试</Button>}
    <span className={css.badge} data-tone={tone}>{label}</span>
  </li>
}

function SyncSection({ sync, busy, error }: { sync: SyncStatus; busy: boolean; error: string }) {
  const [message, setMessage] = useState('')
  async function toggle(enabled: boolean) {
    try { await centerSettings.setAutoSync(enabled); setMessage('') }
    catch (e) { setMessage(e instanceof Error ? e.message : String(e)) }
  }
  const schedule = sync.running ? '正在检查…' : `上次 ${clock(sync.lastCheck)}${sync.autoSync ? ` · 下次 ${clock(sync.nextCheckAt)}` : ''}${sync.revision !== null ? ` · 规则第 ${sync.revision} 版` : ''}`
  const problem = message || error || (sync.lastError && `读取规则失败：${sync.lastError}`) || sync.conflict
  return <section className={css.group}>
    <h3 className={css.groupTitle}>自动更新</h3>
    <div className={css.card}>
      <div className={css.row}>
        <div className={css.rowText}>
          <div className={css.rowLabel}>自动安装和升级</div>
          <div className={css.rowHint}>按中心发布的分发规则在后台执行，需要刷新或重启时会提示</div>
        </div>
        <Switch checked={sync.autoSync} disabled={busy} label="自动安装和升级" onChange={next => void toggle(next)} />
      </div>
      <div className={css.row}>
        <div className={css.rowText}>
          <div className={css.rowLabel}>检查更新</div>
          <div className={css.rowHint}>{schedule}</div>
        </div>
        <Button size="sm" variant="outline" icon={<IconRefreshOutlineRegular />} disabled={busy || sync.running} onClick={() => void centerSettings.syncAction('sync/check')}>{busy ? '检查中…' : '立即检查'}</Button>
      </div>
      {problem && <p role="alert" className={css.alert}>{problem}</p>}
      {sync.plugins.length > 0
        ? <ul className={css.list} aria-label="分发规则中的插件">{sync.plugins.map(row => <PluginItem key={row.packageName} row={row} busy={busy} />)}</ul>
        : <div className={css.empty}>{sync.lastCheck ? '中心暂未发布分发规则' : '尚未检查'}</div>}
    </div>
    {sync.history.length > 0 && <details className={css.history}>
      <summary>最近执行记录（{sync.history.length}）</summary>
      <ul>{sync.history.map((h, i) => <li key={i}>
        <time>{clock(h.at)}</time>
        <span className={h.ok ? undefined : css.failed}>{h.source === 'manual' ? '手动' : '自动'}{h.action === 'install' ? '安装' : '升级'} {h.name || h.packageName} {h.from ? `${h.from} → ` : ''}{h.to}{h.ok ? '' : ' · 失败'}</span>
      </li>)}</ul>
    </details>}
  </section>
}

export function CenterSettingsPage() {
  const state = useSyncExternalStore(centerSettings.subscribe, centerSettings.getSnapshot)
  const [address, setAddress] = useState(state.address), [message, setMessage] = useState('')
  useEffect(() => { setAddress(state.address) }, [state.address])
  useEffect(() => { void centerSettings.refreshSync() }, [])
  async function save() {
    try { await centerSettings.setAddress(address); setMessage('已保存') }
    catch (error) { setMessage(error instanceof Error ? error.message : String(error)) }
  }
  const sync = state.sync
  const changed = address.trim() !== state.address
  const source = state.source === 'profile' ? '来自 Profile 预置' : state.source === 'default' ? '默认地址' : state.source === 'browser' ? '仅保存在本浏览器' : ''
  return <div className={css.page}>
    <h2 className={css.title}>BKMS 插件中心</h2>
    <section className={css.group}>
      <h3 className={css.groupTitle}>常规</h3>
      <div className={css.card}>
        <div className={css.row}>
          <div className={css.rowText}>
            <div className={css.rowLabel}>在侧栏显示入口</div>
            <div className={css.rowHint}>隐藏后插件仍正常使用</div>
          </div>
          <Switch checked={state.visible} label="在侧栏显示 BKMS 插件中心入口" onChange={next => {
            try { centerSettings.setVisible(next) } catch { setMessage('设置无法保存，请检查浏览器存储') }
          }} />
        </div>
        <div className={`${css.row} ${css.addressRow}`}>
          <div className={css.rowText}>
            <div className={css.rowLabel}>中心地址</div>
            {source && <div className={css.rowHint}>{source}</div>}
          </div>
          <div className={css.addressControl}>
            <Input className={css.addressInput} aria-label="BKMS 中心目录地址" value={address} onChange={e => { setAddress(e.target.value); setMessage('') }} onKeyDown={e => { if (e.key === 'Enter') void save() }} />
            <Button size="sm" variant={changed ? 'primary' : 'outline'} disabled={!changed} onClick={() => void save()}>保存</Button>
          </div>
        </div>
        {message && <p role="status" className={css.message}>{message}</p>}
      </div>
    </section>
    {!sync ? <p className={css.empty}>{state.syncError || '正在读取自动更新状态…'}</p>
      : !sync.available ? <p role="alert" className={css.alert}>{sync.reason}</p>
      : <SyncSection sync={sync} busy={state.syncBusy} error={state.syncError} />}
  </div>
}
