#!/usr/bin/env node
/** 把复制来的墨月原始 TS 里的相对导入补上 .ts 扩展，使其能在 Node ESM 下直接加载。 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = process.argv[2] ?? path.join(path.dirname(fileURLToPath(import.meta.url)), 'original');
let changed = 0;
for (const file of fs.readdirSync(dir)) {
  if (!file.endsWith('.ts')) continue;
  const full = path.join(dir, file);
  const before = fs.readFileSync(full, 'utf8');
  const after = before.replace(/(from\s+['"])(\.\.?\/[^'"]+?)(['"])/g, (match, head, spec, tail) => (
    /\.(ts|js|json)$/.test(spec) ? match : head + spec + '.ts' + tail
  ));
  if (after !== before) { fs.writeFileSync(full, after, 'utf8'); changed += 1; console.log('  改写: ' + file); }
}
console.log('共改写 ' + changed + ' 个文件');
