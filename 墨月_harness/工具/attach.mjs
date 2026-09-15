#!/usr/bin/env node
/**
 * 墨月 Harness · 附件集（一轮发送所用的文件与图片）
 *
 * 分工（与 thread.mjs 一致）：工作区负责**登记、存档、清单与注入**；
 * **读取图片与文件、决定上下文里放多少，都归 harness / 执行者**——
 * 所以这里不设体积与数量上限，也不构造"识图请求"。图片以**路径**交付。
 *
 * 用法：
 *   node 工具/attach.mjs --new --request "帮我看看这张图"      → 得到附件集 id
 *   node 工具/attach.mjs --add <路径> --set <id>              （可重复；文本与图片都走这里）
 *   node 工具/attach.mjs --show --set <id>
 *   node 工具/attach.mjs --set-description --set <id> --name <图名> --file <识别记录.txt>
 *   node 工具/attach.mjs --manifest --set <id> [--historical] [--json]
 *   node 工具/attach.mjs --list
 *   node 工具/attach.mjs --self-test
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { newAttachmentSet, readAttachmentSet, writeAttachmentSet, listAttachmentSets } from './lib/pending.mjs';
import { describeAttachment, attachmentManifest, normalizeImageDescription, LARGE_TEXT_HISTORY_BYTES } from './lib/attachments.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const flags = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) { (flags[key] ??= []).push(next); i += 1; } else flags[key] = true;
    } else flags._.push(argv[i]);
  }
  return flags;
}
const one = (v) => (Array.isArray(v) ? v.at(-1) : v && v !== true ? v : undefined);

const IMAGE_MEDIA_TYPES = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
};

function loadSet(flags) {
  const id = one(flags.set);
  if (!id) throw new Error('需要 --set <附件集 id>（用 --new 建一个）。');
  return readAttachmentSet(ROOT, id);
}

function selfTest() {
  const cases = [
    ['图片按扩展名分类', describeAttachment({ name: 'a.PNG', size: 10, path: 'x/a.PNG' }).kind === 'image'],
    ['文本按扩展名分类', describeAttachment({ name: 'a.md', size: 10, text: 'x' }).kind === 'text'],
    ['不可读类型被拒', (() => {
      try { describeAttachment({ name: 'a.bin', size: 10 }); return false; }
      catch (error) { return /不是可读取的图片或文本文件/.test(error.message); }
    })()],
    ['图片不设体积上限，只登记路径', (() => {
      const item = describeAttachment({ name: 'big.png', size: 50 * 1024 * 1024, path: 'x/big.png' });
      return item.kind === 'image' && item.path === 'x/big.png' && item.text === undefined;
    })()],
    ['超大文本标 turn-only（工作区策略，非传输限制）', (() => {
      const item = describeAttachment({ name: 'a.txt', size: LARGE_TEXT_HISTORY_BYTES + 1, text: 'x' });
      return item.historyPolicy === 'turn-only';
    })()],
    ['普通文本为 persistent', describeAttachment({ name: 'a.txt', size: 100, text: 'x' }).historyPolicy === 'persistent'],
    ['本轮清单交付图片路径与识别记录', (() => {
      const manifest = attachmentManifest([
        { kind: 'text', name: 'a.txt', mediaType: 'text/plain', text: '文件正文XYZ', historyPolicy: 'persistent' },
        { kind: 'image', name: 'b.png', mediaType: 'image/png', path: '素材/b.png', imageDescription: '一张图' },
      ], false);
      return manifest.includes('path="素材/b.png"') && manifest.includes('一张图') && manifest.includes('文件正文XYZ');
    })()],
    ['历史轮的 turn-only 文本只留过期提示', (() => {
      const manifest = attachmentManifest([{ kind: 'text', name: 'a.txt', mediaType: 'text/plain', text: '文件正文XYZ', historyPolicy: 'turn-only' }], true);
      return manifest.includes('state="expired"') && !manifest.includes('文件正文XYZ');
    })()],
    ['未识别图片说明"由执行环境读取"', (() => {
      const manifest = attachmentManifest([{ kind: 'image', name: 'b.png', mediaType: 'image/png', path: 'x/b.png' }], false);
      return manifest.includes('由执行环境读取对应路径');
    })()],
    ['历史轮默认不重读原图', (() => {
      const manifest = attachmentManifest([{ kind: 'image', name: 'b.png', mediaType: 'image/png', path: 'x/b.png', imageDescription: '记录' }], true);
      return manifest.includes('不要要求或假装再次查看原图') && manifest.includes('只有作者本轮明确要求重新识图时');
    })()],
    ['识别记录长度被截到 12000', normalizeImageDescription('x'.repeat(20_000)).length === 12_000],
  ];
  let failed = 0;
  for (const [name, ok] of cases) {
    if (!ok) failed += 1;
    console.log(`${ok ? '  ✓' : '  ✗'} ${name}`);
  }
  console.log(`\n${failed ? '✗' : '✓'} 附件自测 ${cases.length - failed}/${cases.length} 通过`);
  return failed ? 1 : 0;
}

function main() {
  const flags = parseArgs(process.argv.slice(2));
  if (flags['self-test']) return selfTest();

  if (flags.list) {
    const all = listAttachmentSets(ROOT);
    if (!all.length) { console.log('（还没有附件集）'); return 0; }
    for (const set of all) console.log(`${set.id}\n  ${set.attachments.length} 项｜${set.authorRequest.slice(0, 40)}｜${set.updatedAt}`);
    return 0;
  }

  if (flags.new) {
    const set = newAttachmentSet(ROOT, one(flags.request) ?? '');
    console.log(`✓ 已建附件集：${set.id}`);
    console.log(`  node 工具/attach.mjs --add <路径> --set ${set.id}`);
    return 0;
  }

  let set;
  try { set = loadSet(flags); } catch (error) { console.error(`✗ ${error.message}`); return 2; }

  if (flags.add) {
    const paths = Array.isArray(flags.add) ? flags.add : [flags.add];
    const added = [];
    const errors = [];
    for (const item of paths) {
      const absolute = path.resolve(item);
      const name = path.basename(absolute);
      try {
        const stat = fs.statSync(absolute);
        const relative = path.relative(ROOT, absolute).replace(/\\/g, '/');
        const candidate = { name, size: stat.size, path: relative };
        const kind = (() => { try { return describeAttachment({ ...candidate, text: '' }).kind; } catch { return ''; } })();
        if (kind === 'text') candidate.text = fs.readFileSync(absolute, 'utf8');
        if (kind === 'image') candidate.mediaType = IMAGE_MEDIA_TYPES[name.toLowerCase().match(/\.(png|jpe?g|webp|gif)$/)?.[0]] ?? '';
        added.push(describeAttachment(candidate));
      } catch (error) { errors.push(`${name}：${error.message}`); }
    }
    if (added.length) { set.attachments.push(...added); writeAttachmentSet(ROOT, set); }
    for (const item of added) {
      console.log(`✓ 已加入 [${item.kind}] ${item.name}${item.historyPolicy === 'turn-only' ? '（较大，正文只在发送当轮生效；再次需要时请重新添加）' : ''}`);
    }
    if (errors.length) { console.error(`✗ ${errors.join('；')}`); return 1; }
    console.log(`  当前 ${set.attachments.length} 项`);
    return 0;
  }

  if (flags['set-description']) {
    const name = one(flags.name);
    const file = one(flags.file);
    if (!name || !file) { console.error('需要 --name <图片名> 与 --file <识别记录.txt>'); return 2; }
    const image = set.attachments.find((item) => item.kind === 'image' && item.name === name);
    if (!image) { console.error(`✗ 附件集里没有图片「${name}」`); return 1; }
    image.imageDescription = normalizeImageDescription(fs.readFileSync(path.resolve(file), 'utf8'));
    writeAttachmentSet(ROOT, set);
    console.log(`✓ 已保存 ${name} 的识别记录（${image.imageDescription.length} 字符）`);
    return 0;
  }

  if (flags.manifest) {
    const text = attachmentManifest(set.attachments, Boolean(flags.historical));
    if (flags.json) { console.log(JSON.stringify({ manifest: text, attachments: set.attachments }, null, 2)); return 0; }
    console.log(text || '（无附件）');
    return 0;
  }

  if (flags.show) {
    console.log(`附件集：${set.id}`);
    console.log(`作者请求：${set.authorRequest || '（空）'}`);
    if (!set.attachments.length) console.log('  （无附件）');
    for (const item of set.attachments) {
      const extra = item.kind === 'image'
        ? (item.imageDescription ? `已保存识别记录 ${item.imageDescription.length} 字符` : '尚无识别记录（由执行环境按路径读取）')
        : `${item.historyPolicy}，${(item.text ?? '').length} 字符`;
      console.log(`  [${item.kind}] ${item.name}｜${item.path ?? '（无路径）'}｜${extra}`);
    }
    console.log('\n· 读取图片与判断上下文预算归 harness / 执行者；本工具不设体积与数量上限。');
    return 0;
  }

  console.error('用法：--new | --add | --show | --set-description | --manifest | --list | --self-test');
  return 2;
}

process.exit(main());
