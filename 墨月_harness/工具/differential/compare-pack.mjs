#!/usr/bin/env node
/**
 * 打包层逐格比对——同一份作品夹具同时喂给「墨月原件 projectCard()」与「harness 移植版」，
 * 深度比较导出的角色卡 JSON（含内嵌世界书、正则、脚本、稳定 ID）。
 *
 * 用法：node 工具/differential/setup-pack-original.mjs && node 工具/differential/compare-pack.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');

const setupFile = path.join(HERE, 'pack-original', 'character-card.ts');
if (!fs.existsSync(setupFile)) {
  console.error('缺少 pack-original/，先运行 setup-pack-original.mjs');
  process.exit(2);
}

const moyu = await import(new URL('./pack-original/character-card.ts', import.meta.url).href);
const mine = await import(new URL('../lib/card.mjs', import.meta.url).href);
const { createCharacter, createWorldbookEntry, createRule } = await import(new URL('../lib/apply.mjs', import.meta.url).href);
const { newProject, addModule, writeSource } = await import(new URL('../lib/workshop.mjs', import.meta.url).href);

const MODULE_SOURCE = (title) => `const title = ${JSON.stringify(title)};\nreturn { render(root) { root.textContent = title; } };`;

/** 造一个含工坊工程的变体；两边拿到同一份深拷贝。 */
function withWorkshop(base, { withPhone = true, legacyEntry = false } = {}) {
  const workshop = newProject('测试工坊');
  addModule(workshop, 'collection');
  if (withPhone) addModule(workshop, 'messages');
  for (const module of workshop.modules) writeSource(module, MODULE_SOURCE(module.title), module.revision);
  workshop.id = 'workshop-fixed-1';
  if (legacyEntry) {
    base.worldbook.push({
      id: 'legacy-wb', title: '旧版工坊条目', content: '旧正文', keys: [], secondaryKeys: [],
      activation: 'always', placement: 'before_character', depth: 0, order: 10, probability: 100, enabled: true,
      sourceRaw: { extensions: { moyu_script_project: 'fixed-legacy-id' } },
    });
  }
  return { ...base, scriptProjects: [workshop] };
}

function fixture(overrides = {}) {
  const now = '2026-09-14T00:00:00.000Z';
  const character = createCharacter('周梦瑶');
  character.basicInformation = '<周梦瑶_基础信息>\n上海人。\n</周梦瑶_基础信息>';
  character.characterNature = '内核是想要被看见。';
  const wb = createWorldbookEntry();
  wb.title = '异乡人_世界设定';
  wb.content = '<异乡人_世界设定>\n小型世界观正文。\n</异乡人_世界设定>';
  wb.scale = 'small';
  const rule = createRule();
  rule.title = '称呼规则';
  rule.content = '<创作规则_称呼>\n不得替使用者决定台词。\n</创作规则_称呼>';
  return {
    id: 'proj-fixture-1', title: '异乡人', summary: '测试作品',
    characters: [character], worldbook: [wb], rules: [rule],
    opening: { firstMessage: '她推开门。', alternateGreetings: ['', '另一个开场。'] },
    mvu: {
      enabled: true, initvarDesign: '开局值设计', updateRuleDesign: '变化规则设计',
      initvarSource: '主角:\n  金币: 0',
      updateRulesSource: '变量更新规则:\n  主角:\n    金币:\n      check: 当交易发生时\n      type: number',
      schemaSource: "import { registerMvuSchema } from 'https://example.invalid/mvu_zod.js';\n\nexport const Schema = z.object({\n  主角: z.object({ 金币: z.coerce.number() }),\n});\n\n$(() => { registerMvuSchema(Schema); });",
    },
    statusbar: {
      kind: 'native', requirements: '看金币', contract: '技术路线：原生 HTML',
      source: '<!doctype html>\n<html><head><meta charset="utf-8"></head><body><div data-mvu-path="stat_data.主角.金币" data-fallback="未知"></div><script>\nwaitGlobalInitialized(\'Mvu\').then(() => { const d = Mvu.getMvuData({ type: \'message\' }); document.body.dataset.ready = \'1\'; });\n</script></body></html>',
    },
    frontend: {
      requirements: '看原文', contract: '唯一外层标签：`moyu_ui`',
      source: '<moyu_ui>\n原始正文\n</moyu_ui>',
      previewHtml: '<!doctype html>\n<html><head><meta charset="utf-8"></head><body><div id="root"></div><script>\nconst id = getCurrentMessageId();\nconst raw = getChatMessages(id)[0]?.message || \'\';\nconst box = document.createElement(\'div\');\nbox.textContent = raw.includes(\'<moyu_ui>\') ? raw : \'无\';\ndocument.getElementById(\'root\').replaceChildren(box);\n</script></body></html>',
      testMessage: '',
    },
    ejsCharacters: [{ id: 'ejs-1', name: '状态', entryName: '[EJS] 状态', entryOrder: 3, requirements: '', contract: 'c', source: "<% if (getvar('stat_data.主角.金币') > 0) { %>有钱<% } %>" }],
    assets: [], materials: [], artifacts: [], threads: {}, activeThreadIds: [], recoveryReplies: [],
    scriptProjects: [], createdAt: now, updatedAt: now,
    ...overrides,
  };
}

/** 变体：覆盖不同分支 */
const VARIANTS = [
  ['基准（MVU + 状态栏 + 前端 + EJS 全开）', () => fixture()],
  ['MVU 关闭', () => fixture({ mvu: { ...fixture().mvu, enabled: false } })],
  ['无状态栏（kind=none）', () => fixture({ statusbar: { kind: 'none', requirements: '', contract: '', source: '' } })],
  ['Vue 状态栏（触发 Vue 运行时内联）', () => {
    const f = fixture();
    return { ...f, statusbar: { ...f.statusbar, kind: 'vue', source: '<!doctype html>\n<html><head></head><body><div id="a"></div><script>\nwaitGlobalInitialized(\'Mvu\').then(() => { const d = Mvu.getMvuData({}); Vue.createApp({ data: () => ({ x: 1 }) }).mount(\'#a\'); });\n</script></body></html>' } };
  }],
  ['无前端（不注入前端条目与正则）', () => { const f = fixture(); return { ...f, frontend: { requirements: '', contract: '', source: '', previewHtml: '', testMessage: '' } }; }],
  ['多人物（order 取模 1–8）', () => {
    const f = fixture();
    const extra = Array.from({ length: 9 }, (_, i) => { const c = createCharacter(`角色${i + 2}`); c.basicInformation = `正文${i}`; return c; });
    return { ...f, characters: [...f.characters, ...extra] };
  }],
  ['开场白与备用均为空', () => fixture({ opening: { firstMessage: '', alternateGreetings: [] } })],
  ['无规则条目', () => fixture({ rules: [] })],
  ['世界书条目带 sourceRaw（保留原 id 与扩展）', () => {
    const f = fixture();
    f.worldbook[0].sourceRaw = { id: 7, disable: true, order: 42, depth: 2, probability: 80, extensions: { role: 1, custom: 'x' } };
    return f;
  }],
  ['导入卡（沿用原卡字段，不写 tags/creator）', () => fixture({
    importedCard: {
      sourceName: 'x.png', sourceFormat: 'png', spec: 'chara_card_v3', specVersion: '3.0',
      raw: { name: '原名', description: '原描述', first_mes: '原首楼', data: { name: '原名', description: '原描述', creator: '原作者', character_version: '1.2', tags: ['原标签'], extensions: { regex_scripts: [{ id: 'r1', scriptName: '[显示]自定义', findRegex: '/x/g', replaceString: 'y', markdownOnly: true, promptOnly: false }], tavern_helper: { scripts: [{ id: 's1', name: '自定义脚本', content: 'x' }] } } } },
    },
  })],
  ['工坊·成就与图鉴 + 消息与私信（含手机配套与正则）', () => withWorkshop(fixture())],
  ['工坊·仅非手机模块（不注入手机正则）', () => withWorkshop(fixture(), { withPhone: false })],
  ['工坊·作品里已有上一版工坊条目（应被过滤）', () => withWorkshop(fixture(), { legacyEntry: true })],
];

let passed = 0;
const diffs = [];
for (const [name, build] of VARIANTS) {
  const project = build();
  let a; let b; let err = '';
  try { a = JSON.stringify(moyu.projectCard(JSON.parse(JSON.stringify(project)))); } catch (error) { err = `墨月抛错：${error.message}`; a = err; }
  try { b = JSON.stringify(mine.projectCard(JSON.parse(JSON.stringify(project)))); } catch (error) { err += ` 移植抛错：${error.message}`; b = err; }
  if (a === b) passed += 1;
  else diffs.push({ name, a, b });
}

console.log(`打包层逐格比对：${passed} 项一致，${diffs.length} 项有差异（共 ${passed + diffs.length} 项）\n`);
for (const diff of diffs) {
  console.log(`✗ ${diff.name}`);
  // 找出第一处不同
  const a = String(diff.a); const b = String(diff.b);
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i += 1;
  console.log(`   首个差异在第 ${i} 字符附近：`);
  console.log(`   墨月: …${a.slice(Math.max(0, i - 60), i + 140)}…`);
  console.log(`   移植: …${b.slice(Math.max(0, i - 60), i + 140)}…\n`);
}
console.log(diffs.length ? `✗ 存在 ${diffs.length} 项差异` : '✓ 墨月原件 projectCard() 与 harness 移植版在全部变体上逐字段一致');
export const differential = { passed: passed, diffs: diffs, total: passed + diffs.length, label: 'compare-pack' };
// 作为脚本直接运行时才决定退出码；被验收脚本 import 时不终止进程。
if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('/compare-pack.mjs')) {
  process.exit(diffs.length ? 1 : 0);
}
