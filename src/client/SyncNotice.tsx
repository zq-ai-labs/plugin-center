/** 自动更新的全局提示：插件安装完成后需要刷新界面或重启客户端。挂在 shell.overlay，不依赖插件中心页面。 */
import { useState, useSyncExternalStore, type ReactNode } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { centerSettings } from './center-settings.ts'

const dismissedKey = 'bkms-plugin-center.dismissed-notices'
function readDismissed(): string[] {
  try { return JSON.parse(sessionStorage.getItem(dismissedKey) || '[]') } catch { return [] }
}
const names = (items: { name: string; version: string }[]) => items.map(item => `${item.name} ${item.version}`).join('、')
const notes = (items: { note: string }[]) => [...new Set(items.map(item => item.note).filter(Boolean))].join('；')

const card = {
  pointerEvents: 'auto', width: 360, maxWidth: 'calc(100vw - 32px)', boxSizing: 'border-box', padding: '12px 16px', borderRadius: 'var(--dsw-radius-lg, 12px)',
  background: 'var(--dsw-alias-toast-bg, #1f2329)', color: 'var(--dsw-alias-toast-label, #fff)', boxShadow: 'var(--dsw-shadow-lv3, 0 8px 24px #0004)',
  fontSize: 13, lineHeight: 1.5,
} as const

export function SyncNotice(): ReactNode {
  const state = useSyncExternalStore(centerSettings.subscribe, centerSettings.getSnapshot)
  const [dismissed, setDismissed] = useState(readDismissed)
  const dismiss = (id: string) => {
    const next = [...dismissed, id].slice(-50)
    setDismissed(next)
    try { sessionStorage.setItem(dismissedKey, JSON.stringify(next)) } catch { /* 仅本次会话隐藏。 */ }
  }
  const sync = state.sync
  if (!sync?.available) return null
  // 安装本身不提醒，只在安装完成后需要刷新界面或重启时提示。
  const cards: ReactNode[] = []
  for (const notice of sync.notices) {
    if (dismissed.includes(notice.id)) continue
    const restart = notice.kind === 'restart'
    cards.push(
      <div key={notice.id} role="status" style={card}>
        <strong>{restart ? '插件已更新，需要重启 DSH' : '插件已更新，刷新界面后生效'}</strong>
        <div>{names(notice.items)}</div>
        {notes(notice.items) && <div style={{ opacity: 0.8 }}>{notes(notice.items)}</div>}
        {restart && <div style={{ opacity: 0.8 }}>请保存工作后完全退出 DSH（包括托盘），再重新打开。</div>}
        <div style={{ display: 'flex', gap: 8, marginTop: 8, justifyContent: 'flex-end' }}>
          <Button size="sm" onClick={() => dismiss(notice.id)}>{restart ? '知道了' : '稍后'}</Button>
          {!restart && <Button size="sm" variant="primary" onClick={() => location.reload()}>刷新界面</Button>}
        </div>
      </div>,
    )
  }
  if (!cards.length) return null
  return <div style={{ position: 'fixed', right: 16, bottom: 16, zIndex: 1000, display: 'flex', flexDirection: 'column', gap: 8, pointerEvents: 'none' }}>{cards}</div>
}
