// 本地预览：把 scripts/fixtures/ui-preview.tsx 打包成带 index.html 的目录（默认系统临时目录），不连接真实服务。
import { createRequire } from 'node:module'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const harness = resolve(root, '../../../deepseek-harness')
const directory = resolve(process.argv[2] ?? join(tmpdir(), 'bkms-plugin-center-preview'))
await mkdir(directory, { recursive: true })
const require = createRequire(join(harness, 'package.json'))
const { build } = await import(pathToFileURL(require.resolve('tsdown')).href)
const { transform } = await import(pathToFileURL(join(harness, 'node_modules/lightningcss/node/index.js')).href)
const prefix = '\0preview-css:', plain = '\0preview-plain:'
await build({
  config: false, cwd: root, entry: { preview: 'scripts/fixtures/ui-preview.tsx' }, outDir: directory, clean: false, format: 'esm', platform: 'browser', target: 'es2022', dts: false, sourcemap: false,
  define: { 'process.env.NODE_ENV': '"production"' }, deps: { alwaysBundle: [/.*/] }, outputOptions: { entryFileNames: '[name].js' },
  plugins: [{
    name: 'preview',
    resolveId(source, importer) {
      // 官方已安装页需要完整宿主，预览中替换为占位。
      if (source === './PluginManagerPage.tsx') return '\0preview-installed'
      if (source.endsWith('.module.css') && importer) return prefix + resolve(dirname(importer), source) + '.mjs'
      // 依赖里的普通 CSS（如 katex）直接注入。
      if (source.endsWith('.css') && importer) return this.resolve(source, importer, { skipSelf: true }).then(r => r ? plain + r.id + '.mjs' : null)
      return null
    },
    async load(id) {
      if (id === '\0preview-installed') return 'export const PluginManagerPage = (props) => window.__INSTALLED__(props)'
      if (id.startsWith(plain)) return `const s=document.createElement('style');s.textContent=${JSON.stringify(await readFile(id.slice(plain.length, -4), 'utf8'))};document.head.append(s)`
      if (!id.startsWith(prefix)) return null
      const file = id.slice(prefix.length, -4)
      const { code, exports } = transform({ filename: file, code: await readFile(file), cssModules: { pattern: '[hash]_[local]' } })
      const map = Object.fromEntries(Object.entries(exports ?? {}).map(([k, v]) => [k, v.name]))
      return `const s=document.createElement('style');s.textContent=${JSON.stringify(code.toString())};document.head.append(s);export default ${JSON.stringify(map)}`
    },
  }],
})
const theme = join(harness, 'packages/client/ui-theme/src/styles')
const css = (await Promise.all(['design-platform.css', 'base.css'].map(f => readFile(join(theme, f), 'utf8')))).join('\n')
await writeFile(join(directory, 'index.html'), `<!doctype html><html lang="zh"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>BKMS 插件中心预览</title><style>${css}\nbody{margin:0}</style><body><div id="root" style="height:100vh"></div><script type="module" src="./preview.js"></script></body></html>`)
console.log(directory)
