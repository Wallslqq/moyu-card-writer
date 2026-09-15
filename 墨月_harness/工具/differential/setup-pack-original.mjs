#!/usr/bin/env node
/**
 * 为打包层差分测试准备「墨月原件」副本。
 *
 * 做法：复制 character-card.ts 与 statusbar-document.ts 原件，只把**浏览器专属**的依赖换成桩：
 *   · `./project-file`（浏览器下载）→ 桩
 *   · `./workspace` → 只抽出 frontendOuterTag / containsTagPair / escapeRegex 三个函数（逐字复制）
 *   · `../script-workshop/{export,phone,worldbook}` → 桩（夹具不含工坊模块；一旦被调用即报错）
 *   · `./statusbar-document` → 补丁版：Vue 运行时改从 harness 的 vendored vue 读取
 * 其余逻辑全部使用墨月原件，未做任何改写。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(HERE, 'original');
const OUT = path.join(HERE, 'pack-original');
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const read = (name) => fs.readFileSync(path.join(SRC, name), 'utf8');

// 1) character-card.ts：只改 import 指向
let card = read('character-card.ts');
card = card
  .replace(/from '\.\/project-file'/g, "from './stub-project-file.ts'")
  .replace(/from '\.\/workspace'/g, "from './stub-workspace.ts'")
  // 脚本工坊三个依赖指向 vendored 原件（不再是桩），使工坊集成逻辑也进入差分覆盖。
  .replace(/from '\.\.\/script-workshop\/export'/g, "from '../../vendor/script-workshop/export.ts'")
  .replace(/from '\.\.\/script-workshop\/phone'/g, "from '../../vendor/script-workshop/phone.ts'")
  .replace(/from '\.\.\/script-workshop\/worldbook'/g, "from '../../vendor/script-workshop/worldbook.ts'")
  .replace(/from '\.\/types'/g, "from './stub-types.ts'");
fs.writeFileSync(path.join(OUT, 'character-card.ts'), card, 'utf8');

// 2) statusbar-document.ts：Vue 运行时改读 vendored 文件
let statusbar = read('statusbar-document.ts');
statusbar = statusbar
  .replace(/import vueGlobalRuntime from 'vue\/dist\/vue\.global\.prod\.js\?raw';\n/, '')
  .replace(/^/, "import fs from 'node:fs';\nimport path from 'node:path';\nimport { fileURLToPath } from 'node:url';\nconst vueGlobalRuntime = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'node_modules', 'vue', 'dist', 'vue.global.prod.js'), 'utf8');\n");
fs.writeFileSync(path.join(OUT, 'statusbar-document.ts'), statusbar, 'utf8');

// 3) workspace 桩：逐字抽出三个函数
const workspace = read('workspace.ts');
const fn = (name) => {
  const start = workspace.indexOf(`export function ${name}(`) >= 0 ? workspace.indexOf(`export function ${name}(`) : workspace.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`找不到 ${name}`);
  // 找到函数结束（下一个顶层 function/export 或文件末尾）
  const rest = workspace.slice(start);
  const nextMatch = rest.slice(1).search(/\n(?:export )?function /);
  return nextMatch < 0 ? rest.trimEnd() : rest.slice(0, nextMatch + 1).trimEnd();
};
fs.writeFileSync(path.join(OUT, 'stub-workspace.ts'), [
  '// 由 setup 脚本从 workspace.ts 逐字抽出，未改写。',
  fn('escapeRegex'),
  fn('frontendOuterTag'),
  fn('containsTagPair'),
  '',
].join('\n\n'), 'utf8');

// 4) 桩模块
fs.writeFileSync(path.join(OUT, 'stub-project-file.ts'), 'export function downloadWorkspaceFile(): void { /* 浏览器下载，差分中不需要 */ }\n', 'utf8');
fs.writeFileSync(path.join(OUT, 'stub-types.ts'), 'export type MoyuProject = any;\nexport type MoyuWorldbookPlacement = any;\n', 'utf8');

console.log('已生成 pack-original/：' + fs.readdirSync(OUT).join('、'));

// 5) 给生成物里的相对导入补 .ts 扩展（Node ESM 需要）
let fixed = 0;
for (const file of fs.readdirSync(OUT)) {
  if (!file.endsWith('.ts')) continue;
  const full = path.join(OUT, file);
  const before = fs.readFileSync(full, 'utf8');
  const after = before.replace(/(from\s+['"])(\.\.?\/[^'"]+?)(['"])/g, (match, head, spec, tail) => (
    /\.(ts|js|json)$/.test(spec) ? match : head + spec + '.ts' + tail
  ));
  if (after !== before) { fs.writeFileSync(full, after, 'utf8'); fixed += 1; }
}
console.log(`已为 ${fixed} 个生成文件补 .ts 扩展`);
