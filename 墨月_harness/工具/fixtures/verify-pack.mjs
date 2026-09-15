#!/usr/bin/env node
/**
 * 打包链路校验：直接导出的卡 JSON 与 PNG 内嵌读回结果必须完全一致，
 * 并打印六类固定注入的落地情况（P3b / P4 验收证据）。
 *
 * 用法：node 工具/fixtures/verify-pack.mjs 验收/card.fixture.json 验收/card.fixture.png
 */
import fs from 'node:fs';
import path from 'node:path';
import { readCharacterCard } from '../lib/png.mjs';

const [jsonFile, pngFile] = process.argv.slice(2);
if (!jsonFile || !pngFile) {
  console.error('用法：node 工具/fixtures/verify-pack.mjs <卡.json> <卡.png>');
  process.exit(2);
}

const direct = JSON.parse(fs.readFileSync(path.resolve(jsonFile), 'utf8'));
const embedded = readCharacterCard(new Uint8Array(fs.readFileSync(path.resolve(pngFile))));

let failed = 0;
const check = (name, ok, extra = '') => {
  if (!ok) failed += 1;
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${extra ? `  ${extra}` : ''}`);
};

check('PNG 内嵌卡可读回', Boolean(embedded));
check('直接导出与内嵌读回完全一致', JSON.stringify(direct) === JSON.stringify(embedded));

const entries = direct.data?.character_book?.entries ?? [];
const byTitle = (title) => entries.find((entry) => entry.comment === title);
const scripts = direct.data?.extensions?.tavern_helper?.scripts ?? [];
const regexes = direct.data?.extensions?.regex_scripts ?? [];

console.log(`\n条目 ${entries.length} 条：`);
for (const entry of entries) {
  const where = entry.extensions.position === 4 ? '指定深度'
    : entry.extensions.position === 1 ? '角色定义后' : '角色定义前';
  console.log(`  - ${entry.comment}｜${where}｜order ${entry.insertion_order}｜${entry.enabled ? '启用' : '禁用'}`);
}

console.log('\n六类固定注入：');
check('① initvar 条目存在且禁用', byTitle('[initvar]变量初始化勿开')?.enabled === false);
check('② 变量列表存在', Boolean(byTitle('变量列表')));
check('③ 变量输出格式存在', Boolean(byTitle('[mvu_update]变量输出格式')));
check('④ MVU 加载器 + 变量结构脚本', scripts.some((s) => s.name === 'MVU') && scripts.some((s) => s.name === '墨月·变量结构'), `脚本 ${scripts.length} 个`);
const mvuRegexNames = ['[不发送]去除变量更新', '[不显示]去除变量更新', '[不发送]界面占位符'];
check('⑤ 变量清洗正则三条', mvuRegexNames.every((name) => regexes.some((r) => r.scriptName === name)), `正则 ${regexes.length} 条`);
const displayRegex = regexes.filter((r) => /^\[显示\]/.test(r.scriptName));
check('⑥ 状态栏 / 前端显示正则', displayRegex.length >= 1, displayRegex.map((r) => r.scriptName).join('、'));
check('前端运行提示词条目存在', Boolean(byTitle('[界面] 消息前端运行提示词')));
check('状态栏存在时首楼补占位符', /<StatusPlaceHolderImpl\/>/.test(direct.data.first_mes));
check('空备用开场白被过滤', direct.data.alternate_greetings.length === 1);
check('内嵌世界书已绑定', direct.data.extensions.world === direct.data.character_book.name);
check('正则 markdownOnly / promptOnly 成对', regexes.every((r) => r.markdownOnly !== r.promptOnly || (!r.markdownOnly && !r.promptOnly)));

console.log(`\n${failed ? '✗' : '✓'} 打包链路校验 ${failed ? `${failed} 项未通过` : '全部通过'}`);
process.exit(failed ? 1 : 0);
