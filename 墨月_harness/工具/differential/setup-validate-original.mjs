#!/usr/bin/env node
/**
 * 为 validateProject 差分准备「墨月原件」副本。
 *
 * 只做两件事：
 *   1. 把 workspace.ts 的相对 import 指到 original/ 里的原件与 vendored 工坊原件；
 *   2. 把 `character-card-import` 换成桩——它唯一被用到的导出是 importedCardData（6 行，逐字复制），
 *      而那个模块还牵出一整套浏览器存储代码（local-store），与本差分的对象无关。
 * validateProject 本体与它调用的所有校验函数都是原件。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ORIG = path.join(HERE, 'original');
const OUT = path.join(HERE, 'validate-original');
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

let workspace = fs.readFileSync(path.join(ORIG, 'workspace.ts'), 'utf8');
workspace = workspace
  .replace(/from '\.\/response\.ts'/g, "from '../original/response.ts'")
  .replace(/from '\.\/configured-artifact\.ts'/g, "from '../original/configured-artifact.ts'")
  .replace(/from '\.\/mvu-check\.ts'/g, "from '../original/mvu-check.ts'")
  .replace(/from '\.\/workspace-pages\.ts'/g, "from '../original/workspace-pages.ts'")
  .replace(/from '\.\/types\.ts'/g, "from '../original/types.ts'")
  .replace(/from '\.\/character-card-import\.ts'/g, "from './stub-character-card-import.ts'")
  .replace(/from '\.\.\/script-workshop\/project\.ts'/g, "from '../../vendor/script-workshop/project.ts'")
  .replace(/from '\.\.\/script-workshop\/runtime\.ts'/g, "from '../../vendor/script-workshop/runtime.ts'");
fs.writeFileSync(path.join(OUT, 'workspace.ts'), workspace, 'utf8');

// 逐字抽出 importedCardData（来自 character-card-import.ts），不引入其余浏览器依赖。
const importSource = fs.readFileSync(path.join(ORIG, 'character-card-import.ts'), 'utf8');
const start = importSource.indexOf('export function importedCardData(');
if (start < 0) throw new Error('找不到 importedCardData');
const rest = importSource.slice(start);
const end = rest.indexOf('\n}\n');
const body = rest.slice(0, end + 3);
const objectValue = 'function objectValue(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }\n';

fs.writeFileSync(path.join(OUT, 'stub-character-card-import.ts'), [
  '// 由 setup-validate-original.mjs 生成：importedCardData 逐字取自 character-card-import.ts，',
  '// 其余导出与本差分无关（那一侧会牵出浏览器存储代码）。',
  objectValue,
  body,
  '',
].join('\n'), 'utf8');

console.log('已生成 validate-original/：' + fs.readdirSync(OUT).join('、'));
