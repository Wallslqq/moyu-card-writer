#!/usr/bin/env node
/**
 * 把墨月脚本工坊源码 vendor 进 harness。
 *
 * 为什么是"vendor 原件"而不是"重写移植"：
 *   工坊成品是用 `函数.toString()` 序列化进角色卡里的（installTavernWorkshop / changeNumbers /
 *   createFloatingWindow / floatingLayout 都是这样嵌进去的）。这类代码手抄一遍，错一个字符在
 *   任何离线测试里都看不出来，却会直接让玩家端的脚本跑不起来。原文是 GPL-3.0-only，
 *   与本 harness 同源；vendor 是最忠实也最安全的选择。
 *
 * 只做两件事：补 Node ESM 需要的 .ts 扩展；不改任何逻辑。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = process.argv[2] ?? 'C:/Users/Walls/Downloads/送君一程，有缘自会再相见/源码/web/src/script-workshop';
const OUT = path.join(HERE, 'vendor', 'script-workshop');

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const files = fs.readdirSync(SRC).filter((name) => name.endsWith('.ts'));
let patched = 0;
for (const name of files) {
  let text = fs.readFileSync(path.join(SRC, name), 'utf8');
  const before = text;
  text = text.replace(/(from\s+['"])(\.\.?\/[^'"]+?)(['"])/g, (match, head, spec, tail) => (
    /\.(ts|js|json)$/.test(spec) ? match : head + spec + '.ts' + tail
  ));
  if (text !== before) patched += 1;
  fs.writeFileSync(path.join(OUT, name), text, 'utf8');
}
fs.writeFileSync(path.join(OUT, 'README.md'), [
  '# 脚本工坊源码（vendor）',
  '',
  '来源：墨月写卡器 `源码/web/src/script-workshop/`，许可 GPL-3.0-only（与本 harness 同源）。',
  '',
  '**未做任何逻辑改动**，只补了 Node ESM 需要的 `.ts` 扩展名（由 `工具/vendor-workshop.mjs` 生成）。',
  '',
  '不要手工编辑本目录；要更新就重跑 `node 工具/vendor-workshop.mjs <墨月源码路径>`。',
  '',
].join('\n'), 'utf8');

console.log(`已 vendor ${files.length} 个文件到 工具/vendor/script-workshop/（${patched} 个补了扩展名）`);
