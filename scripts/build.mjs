import { existsSync, mkdirSync, symlinkSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const harness = resolve(root, '../../../deepseek-harness');
if (!existsSync(resolve(root, 'node_modules'))) symlinkSync(resolve(harness, 'packages/client/ui-plugin-manager/node_modules'), resolve(root, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
const result = spawnSync(process.execPath, [resolve(harness, 'node_modules/tsdown/dist/run.mjs'), '--config', resolve(root, 'tsdown.config.ts')], { cwd: root, stdio: 'inherit' });
if (result.status !== 0) process.exit(result.status ?? 1);
