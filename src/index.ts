import { homedir } from 'node:os'
import { join } from 'node:path'
import { readCatalog } from './service.mjs'
import { createSync } from './sync.mjs'

/** Profile 预置：center 为默认中心地址，autoSync 为默认自动更新开关；设置页保存的值优先。 */
export interface Config { center?: string; autoSync?: boolean }

type Sync = ReturnType<typeof createSync>
const unavailable = { available: false, reason: '当前 DSH 未提供插件管理服务，无法自动更新' }

export function apply(ctx: any, config: Config = {}): void {
  const homeOf = () => ctx.get('profileContext')?.home || process.env.DSH_HOME || join(homedir(), '.dsh')
  let sync: Sync | undefined
  ctx.inject(['pluginManager'], (managed: any) => {
    const profile = ctx.get('profileContext')
    const instance = createSync({
      manager: () => managed.pluginManager,
      home: homeOf(),
      stateDir: profile?.dir ? join(profile.dir, '.bkms-plugin-center') : join(homeOf(), 'bkms-plugin-center'),
      profileDir: profile?.dir,
      preset: { center: config.center, autoSync: config.autoSync },
      log: (level: 'info' | 'warn', message: string) => managed.logger?.[level]?.(message),
    })
    // 官方安装器的日志与阶段事件，按 requestId 归到对应插件的进度上。
    managed.on('plugin-manager/install-log', (chunk: any) => instance.installLog(chunk))
    managed.on('plugin-manager/install-state', (event: any) => instance.installState(event))
    managed.effect(() => {
      sync = instance
      instance.start()
      return () => { instance.stop(); if (sync === instance) sync = undefined }
    }, 'bkms-plugin-center: auto sync')
  })
  // 给其他插件（应用中心）用的窄接口：读目录、查同步进度、重试失败的插件。安装和升级只由插件中心按分发规则执行。
  if (typeof ctx.provide === 'function') ctx.provide('bkmsPluginCenter', {
    version: 1,
    catalog: () => readCatalog(sync?.getConfig().address),
    status: (since?: number) => sync?.status(Number(since) || 0) ?? unavailable,
    retry: (packageName: string) => { if (!sync) throw new Error(unavailable.reason); return sync.retry(String(packageName ?? '')) },
  })
  ctx.inject(['webServer'], (host: any) => {
    type Operation = (url: URL, body: any) => unknown
    const register = (path: string, methods: { GET?: Operation; POST?: Operation }) => host.effect(() => host.webServer.register({ kind: 'exact', path, handler: async (req: any, res: any) => {
      res.setHeader('content-type', 'application/json; charset=utf-8'); res.setHeader('cache-control', 'no-store')
      const operation = methods[req.method as 'GET' | 'POST']
      if (!operation) { res.writeHead(405); res.end(JSON.stringify({ error: `只支持 ${Object.keys(methods).join(' / ')} 请求` })); return }
      try {
        let body: any = {}
        if (req.method === 'POST') {
          // 要求 JSON 请求体：跨站页面无法在没有预检的情况下发送，避免被其他网页触发安装。
          if (!String(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) { res.writeHead(415); res.end(JSON.stringify({ error: '请求必须是 JSON' })); return }
          const chunks: Buffer[] = []; let size = 0
          for await (const chunk of req) { size += chunk.length; if (size > 65536) throw new Error('请求内容过大'); chunks.push(Buffer.from(chunk)) }
          const text = Buffer.concat(chunks).toString('utf8').trim()
          body = text ? JSON.parse(text) : {}
        }
        res.end(JSON.stringify(await operation(new URL(req.url, 'http://localhost'), body)))
      } catch (error) { res.writeHead(400); res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) })) }
    } }))
    const center = (url: URL) => url.searchParams.get('center') || sync?.getConfig().address
    const required = (): Sync => { if (!sync) throw new Error(unavailable.reason); return sync }
    register('/api/bkms-plugin-center/catalog', { GET: url => readCatalog(center(url)) })
    register('/api/bkms-plugin-center/config', { GET: () => sync?.getConfig() ?? unavailable, POST: (_url, body) => required().setConfig(body) })
    register('/api/bkms-plugin-center/sync', { GET: url => sync?.status(Number(url.searchParams.get('since')) || 0) ?? unavailable })
    register('/api/bkms-plugin-center/sync/check', { POST: () => required().checkNow() })
    register('/api/bkms-plugin-center/sync/install', { POST: (_url, body) => required().install(String(body.plugin ?? '')) })
    register('/api/bkms-plugin-center/sync/retry', { POST: (_url, body) => required().retry(String(body.name ?? '')) })
  })
}
