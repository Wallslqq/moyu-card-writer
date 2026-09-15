#!/usr/bin/env node
/**
 * 为装配层差分准备「墨月原件」副本。
 *
 * 只把三个浏览器/重型依赖换成桩，其余（prompt-runtime 本体与它调用的
 * context-links / artifact-self-check / model-profile / response）全部用原件：
 *   · character-card-import → 桩：只用它的 importedCardData（逐字复制），
 *     该模块牵出 local-store 一整套浏览器存储代码；
 *   · tavern-library → 桩：referenceContext 在作品没有 references 时返回空串，
 *     差分会避开带 references 的作品（夹具里没有）；
 *   · batch-artifact → 桩：只用 batchSection 与 MVU_BATCH_TASKS（逐字复制），
 *     该模块牵出 workspace.applyArtifact，进而牵出整套写入链路。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ORIG = path.join(HERE, 'original');
const OUT = path.join(HERE, 'prompt-original');
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

let runtime = fs.readFileSync(path.join(ORIG, 'prompt-runtime.ts'), 'utf8');
runtime = runtime
  .replace(/from '\.\/context-links\.ts'/g, "from '../original/context-links.ts'")
  .replace(/from '\.\/artifact-self-check\.ts'/g, "from '../original/artifact-self-check.ts'")
  .replace(/from '\.\/model-profile\.ts'/g, "from '../original/model-profile.ts'")
  .replace(/from '\.\/character-card-import\.ts'/g, "from './stub-character-card-import.ts'")
  .replace(/from '\.\/tavern-library\.ts'/g, "from './stub-tavern-library.ts'")
  .replace(/from '\.\/batch-artifact\.ts'/g, "from './stub-batch-artifact.ts'")
  .replace(/from '\.\/types\.ts'/g, "from '../original/types.ts'");
fs.writeFileSync(path.join(OUT, 'prompt-runtime.ts'), runtime, 'utf8');

const objectValue = 'function objectValue(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }\n';
const importSource = fs.readFileSync(path.join(ORIG, 'character-card-import.ts'), 'utf8');
const start = importSource.indexOf('export function importedCardData(');
const rest = importSource.slice(start);
const body = rest.slice(0, rest.indexOf('\n}\n') + 3);
fs.writeFileSync(path.join(OUT, 'stub-character-card-import.ts'), [
  '// importedCardData 逐字取自 character-card-import.ts；其余导出与本差分无关。',
  objectValue,
  body,
  '',
].join('\n'), 'utf8');

const batchSource = fs.readFileSync(path.join(ORIG, 'batch-artifact.ts'), 'utf8');
const batchConst = batchSource.slice(batchSource.indexOf('export const BATCH_MAX_CHARACTERS'), batchSource.indexOf('const itemSchema'));
const batchFnStart = batchSource.indexOf('export function batchSection(');
const batchFn = batchSource.slice(batchFnStart, batchSource.indexOf('\n}\n', batchFnStart) + 3);
fs.writeFileSync(path.join(OUT, 'stub-batch-artifact.ts'), [
  '// batchSection 与 MVU_BATCH_TASKS 逐字取自 batch-artifact.ts；其余导出牵出 workspace 写入链路。',
  batchConst,
  batchFn,
  '',
].join('\n'), 'utf8');

fs.writeFileSync(path.join(OUT, 'stub-tavern-library.ts'), [
  '// referenceContext 是作者选用的离线资料副本的注入；差分夹具不含 references，返回空串与原件一致。',
  'export function referenceContext(): string { return ""; }',
  'export function addReference(): never { throw new Error("本差分不涉及参考资料"); }',
  '',
].join('\n'), 'utf8');

console.log('已生成 prompt-original/：' + fs.readdirSync(OUT).join('、'));
