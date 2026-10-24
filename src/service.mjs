import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
export const defaultCenter = 'https://118.145.114.8/plugin-center/plugins.json';
export function centerAddress(value) {
  const url = new URL(value || defaultCenter);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('请填写 HTTP 或 HTTPS 中心地址');
  if (!url.pathname.endsWith('/plugins.json')) url.pathname = url.pathname.replace(/\/$/, '') + '/plugins.json';
  url.search = ''; url.hash = ''; return url.href;
}
export async function readCatalog(value) {
  const center = centerAddress(value);
  const response = await fetch(center, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`中心读取失败（HTTP ${response.status}），请检查地址后重试`);
  const catalog = await response.json();
  if (!Array.isArray(catalog.plugins)) throw new Error('中心返回的目录不完整');
  return { center, plugins: catalog.plugins };
}
/** 校验第二版分发策略的外层结构；单条规则由同步引擎逐条校验。 */
export function parseDistribution(result) {
  if (result?.schemaVersion !== 2 || !Array.isArray(result.rules) || !Number.isSafeInteger(result.revision) || result.revision < 0) throw new Error('中心返回的策略格式不受支持');
  return { schemaVersion: result.schemaVersion, revision: result.revision, rules: result.rules };
}
function packageManifest(bytes) {
  const tar = gunzipSync(bytes, { maxOutputLength: 256 * 1024 * 1024 });
  for (let offset = 0; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512); if (header.every(v => v === 0)) break;
    const text = (a, b) => header.subarray(a, b).toString().replace(/\0.*$/s, '');
    const size = parseInt(text(124, 136).trim() || '0', 8);
    if (!Number.isSafeInteger(size) || size < 0 || offset + 512 + size > tar.length) throw new Error('包结构损坏');
    if (text(0, 100) === 'package/package.json') return JSON.parse(tar.subarray(offset + 512, offset + 512 + size).toString());
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return undefined;
}
/**
 * 下载（或复用缓存）发布包，校验大小、SHA256、包名、版本与完整清单后返回 file: 安装来源。
 * 缓存文件名为 SHA256.tgz，只有校验通过的内容才会写入。onProgress(已下载字节, 总字节) 在下载过程中调用。
 */
export async function prepareArtifact(artifact, packageName, directory, onProgress = () => {}) {
  if (!artifact || !/^[a-f0-9]{64}$/.test(artifact.sha256) || !Number.isSafeInteger(artifact.size) || artifact.size < 1 || artifact.size > 64 * 1024 * 1024) throw new Error('请先在中心上传固定版本包并上架');
  const file = join(directory, artifact.sha256 + '.tgz');
  let bytes;
  if (existsSync(file)) bytes = readFileSync(file);
  else {
    const url = new URL(artifact.url);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('发布包地址必须是 HTTP 或 HTTPS');
    const response = await fetch(url, { signal: AbortSignal.timeout(120000) });
    if (!response.ok || !response.body) throw new Error(`下载失败（HTTP ${response.status}）`);
    const chunks = []; let size = 0;
    for await (const chunk of response.body) { size += chunk.length; if (size > artifact.size) throw new Error('下载大小超过发布记录'); chunks.push(Buffer.from(chunk)); onProgress(size, artifact.size); }
    bytes = Buffer.concat(chunks);
  }
  if (bytes.length !== artifact.size || createHash('sha256').update(bytes).digest('hex') !== artifact.sha256) throw new Error('包校验失败，未交给安装器');
  const manifest = packageManifest(bytes);
  if (!manifest || manifest.name !== packageName || manifest.version !== artifact.version || JSON.stringify(manifest) !== JSON.stringify(artifact.manifest)) throw new Error('包清单与发布记录不符');
  mkdirSync(directory, { recursive: true }); if (!existsSync(file)) writeFileSync(file, bytes, { flag: 'wx' });
  return { spec: 'file:' + file.replaceAll('\\', '/'), name: manifest.name, version: manifest.version };
}
