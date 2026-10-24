import { createElement } from 'react'

// Read official contributions without registering into their owned slots.
// Each copied contribution gets its own declaration and renderer authority.
const roots = ['item', 'bundle.activation', 'bundle.config', 'row.config', 'detail.actions', 'detail.badge', 'detail.section']
export function mirrorPluginSlots(ctx: any): () => void {
  const mapKey = (key: string) => key.startsWith('plugins.') ? key.replace(/^plugins\./, 'bkmsPlugins.') : 'bkmsMirror.' + key
  function watch(source: string, destination: string): () => void {
    const copies = new Map<any, () => void>()
    let stopped = false
    function update() {
      if (stopped) return
      const entries = ctx.slots.entries(source)
      for (const [entry, dispose] of copies) if (!entries.includes(entry)) {dispose(); copies.delete(entry)}
      for (const entry of entries) {
        if (copies.has(entry)) continue
        const children = Object.fromEntries(Object.entries(entry.children ?? {}).map(([key, spec]) => [mapKey(key), spec]))
        function Contribution(props: any) {
          return createElement(entry.component, {...props,
            renderSlot: (key: string, ...args: any[]) => props.renderSlot(mapKey(key), ...args),
            renderSlotChain: (key: string, ...args: any[]) => props.renderSlotChain(mapKey(key), ...args),
          })
        }
        const unregister = ctx.slots.register({name: destination, ...entry.options,
          ...(entry.inject ? {inject: entry.inject} : {}),
          ...(entry.select ? {select: entry.select} : {}),
          ...(entry.store ? {store: entry.store} : {}),
          ...(entry.locale ? {locale: entry.locale} : {}),
          ...(Object.keys(children).length ? {children} : {}),
        }, Contribution)
        const descendants = Object.keys(entry.children ?? {}).map(key => watch(key, mapKey(key)))
        copies.set(entry, () => {descendants.forEach(dispose => dispose()); unregister()})
      }
    }
    const unsubscribe = ctx.slots.subscribe(source, update)
    update()
    return () => {stopped = true; unsubscribe(); copies.forEach(dispose => dispose()); copies.clear()}
  }
  const disposers = roots.map(key => watch('plugins.' + key, 'bkmsPlugins.' + key))
  return () => disposers.forEach(dispose => dispose())
}
