#!/usr/bin/env node
/**
 * 作品结构检查（validateProject）逐格比对。
 * 同一份作品同时喂给墨月原件与 harness 移植版，比较问题清单（含 id / level / section / title / detail）。
 *
 * 用法：node 工具/differential/setup-validate-original.mjs && node 工具/differential/compare-validate.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
if (!fs.existsSync(path.join(HERE, 'validate-original', 'workspace.ts'))) {
  console.error('缺少 validate-original/，先运行 setup-validate-original.mjs');
  process.exit(2);
}

const moyu = await import(new URL('./validate-original/workspace.ts', import.meta.url).href);
const mine = await import(new URL('../lib/validate.mjs', import.meta.url).href);
const { newProject, addModule, writeSource } = await import(new URL('../lib/workshop.mjs', import.meta.url).href);

const F = (lang, body) => '```' + lang + '\n' + body + '\n```';

const SCHEMA_OK = [
  "import { registerMvuSchema } from 'https://example.invalid/mvu_zod.js';",
  '',
  'export const Schema = z.object({',
  '  主角: z.object({ 金币: z.coerce.number() }),',
  '});',
  '',
  '$(() => { registerMvuSchema(Schema); });',
].join('\n');
const INITVAR_OK = F('yaml', '主角:\n  金币: 0');
const RULES_OK = F('yaml', '变量更新规则:\n  主角:\n    金币:\n      check: 当交易发生时\n      type: number');
const STATUSBAR_OK = [
  '<!doctype html>', '<html>', '<head><meta charset="utf-8"></head>', '<body>', '<div id="a"></div>', '<script>',
  "waitGlobalInitialized('Mvu').then(() => { const d = Mvu.getMvuData({ type: 'message' }); document.getElementById('a').textContent = String(d); });",
  '</script>', '</body>', '</html>',
].join('\n');
const FRONTEND_CONTRACT = ['唯一外层标签：`moyu_ui`', '本地交互：点击展开详情'].join('\n');
const FRONTEND_TEXT = F('text', '<moyu_ui>\n原始正文\n</moyu_ui>');
const FRONTEND_HTML = [
  '<!doctype html>', '<html>', '<head><meta charset="utf-8"></head>', '<body>', '<div id="root"></div>',
  '<button type="button">展开</button>', '<script>',
  'const id = getCurrentMessageId();',
  "const raw = getChatMessages(id)[0]?.message ?? '';",
  "const box = document.createElement('div');",
  "box.textContent = raw.includes('<moyu_ui>') ? raw : '无';",
  "document.getElementById('root').replaceChildren(box);",
  '</script>', '</body>', '</html>',
].join('\n');
const EJS_OK = F('ejs', "<% if (getvar('stat_data.主角.金币') > 0) { %>有钱<% } %>");

/** 基准作品：固定 id，保证两边输入一致。 */
function base() {
  return {
    id: 'proj-fixed-1', title: '异乡人', summary: '测试',
    characters: [{
      id: 'char-1', name: '周梦瑶',
      basicInformation: '<周梦瑶_基础信息>\n上海人。\n</周梦瑶_基础信息>',
      lifeStructure: '', characterNature: '内核是想要被看见。', sceneExpression: '', clothingStyle: '', notes: '',
    }],
    worldbook: [{
      id: 'wb-1', title: '异乡人_世界设定', content: '<异乡人_世界设定>\n正文。\n</异乡人_世界设定>',
      keys: [], secondaryKeys: [], activation: 'always', placement: 'before_character',
      depth: 0, order: 1, probability: 100, enabled: true,
    }],
    rules: [],
    opening: { firstMessage: '她推开门。', alternateGreetings: [] },
    mvu: { enabled: true, initvarDesign: 'd', updateRuleDesign: 'd', initvarSource: INITVAR_OK, updateRulesSource: RULES_OK, schemaSource: SCHEMA_OK },
    statusbar: { kind: 'native', requirements: 'r', contract: 'c', source: STATUSBAR_OK },
    frontend: { requirements: 'r', contract: FRONTEND_CONTRACT, source: FRONTEND_TEXT, previewHtml: FRONTEND_HTML, testMessage: '' },
    ejsCharacters: [{ id: 'ejs-1', name: '状态', entryName: '[EJS] 状态', entryOrder: 3, requirements: '', contract: 'c', source: EJS_OK }],
    scriptProjects: [], materials: [], artifacts: [], assets: [], updatedAt: '2026-09-14T00:00:00.000Z',
  };
}

function withWorkshop(project, { complete = true } = {}) {
  const workshop = newProject('测试工坊');
  addModule(workshop, 'messages');
  for (const module of workshop.modules) {
    const isDependency = module.id === 'contacts';
    writeSource(module, isDependency && !complete ? '' : 'return { render(root){ root.textContent = "x"; } };', module.revision);
  }
  workshop.id = 'w1';
  return { ...project, scriptProjects: [workshop] };
}

const VARIANTS = [
  ['基准（全部就绪）', () => base()],
  ['作品无名字', () => { const p = base(); p.title = ''; return p; }],
  ['没有人物', () => { const p = base(); p.characters = []; return p; }],
  ['人物缺基础信息与性情', () => { const p = base(); p.characters[0].basicInformation = ''; p.characters[0].characterNature = ''; return p; }],
  ['没有开场白', () => { const p = base(); p.opening.firstMessage = ''; return p; }],
  ['世界书空条目', () => { const p = base(); p.worldbook[0].content = ''; return p; }],
  ['绿灯条目没有关键词', () => { const p = base(); p.worldbook[0].activation = 'keyword'; p.worldbook[0].keys = []; return p; }],
  ['导入卡里的绿灯无关键词（降级为提醒）', () => {
    const p = base();
    p.worldbook[0].activation = 'keyword'; p.worldbook[0].keys = []; p.worldbook[0].sourceRaw = { id: 3 };
    p.importedCard = { sourceName: 'x.png', sourceFormat: 'png', spec: 'chara_card_v3', specVersion: '3.0', raw: { data: { name: 'x' } } };
    return p;
  }],
  ['MVU 结构脚本有问题', () => { const p = base(); p.mvu.schemaSource = 'const a = 1;'; return p; }],
  ['状态栏未就绪（MVU 缺失）', () => { const p = base(); p.mvu.schemaSource = ''; return p; }],
  ['状态栏成品为空', () => { const p = base(); p.statusbar.source = ''; return p; }],
  ['状态栏成品有问题', () => { const p = base(); p.statusbar.source = STATUSBAR_OK.replace('<!doctype html>\n', ''); return p; }],
  ['前端缺 HTML', () => { const p = base(); p.frontend.previewHtml = ''; return p; }],
  ['前端缺外层标签', () => { const p = base(); p.frontend.contract = ''; p.frontend.source = '没有标签的提示词'; p.frontend.previewHtml = '<!doctype html><html><head></head><body><script>getCurrentMessageId();getChatMessages(1);</script></body></html>'; return p; }],
  ['前端标签不对齐', () => { const p = base(); p.frontend.previewHtml = FRONTEND_HTML.replace(/moyu_ui/g, 'other_tag'); return p; }],
  ['EJS 缺世界书名称', () => { const p = base(); p.ejsCharacters[0].entryName = ''; return p; }],
  ['EJS 顺序越界', () => { const p = base(); p.ejsCharacters[0].entryOrder = 9; return p; }],
  ['EJS 空代码', () => { const p = base(); p.ejsCharacters[0].source = ''; return p; }],
  ['EJS 用了 getVar', () => { const p = base(); p.ejsCharacters[0].source = "<% if (getVar('x')) { %>a<% } %>"; return p; }],
  ['工坊模块完整', () => withWorkshop(base())],
  ['工坊依赖模块缺代码', () => withWorkshop(base(), { complete: false })],
];

let passed = 0;
const diffs = [];
for (const [name, build] of VARIANTS) {
  const source = build();
  let a; let b;
  try { a = JSON.stringify(moyu.validateProject(JSON.parse(JSON.stringify(source)))); }
  catch (error) { a = `墨月抛错：${error.message}`; }
  try { b = JSON.stringify(mine.validateProject(JSON.parse(JSON.stringify(source)))); }
  catch (error) { b = `移植抛错：${error.message}`; }
  if (a === b) passed += 1;
  else diffs.push({ name, a, b });
}

console.log(`结构检查逐格比对：${passed} 项一致，${diffs.length} 项有差异（共 ${passed + diffs.length} 项）\n`);
for (const diff of diffs) {
  console.log(`✗ ${diff.name}`);
  const a = String(diff.a); const b = String(diff.b);
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i += 1;
  console.log(`   首个差异在第 ${i} 字符：`);
  console.log(`   墨月: …${a.slice(Math.max(0, i - 50), i + 200)}…`);
  console.log(`   移植: …${b.slice(Math.max(0, i - 50), i + 200)}…\n`);
}
export const differential = { passed, diffs, total: passed + diffs.length, label: 'compare-validate' };
console.log(diffs.length ? `✗ 存在 ${diffs.length} 项差异` : '✓ 墨月原件 validateProject() 与 harness 移植版在全部变体上逐字段一致');
if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('/compare-validate.mjs')) {
  process.exit(diffs.length ? 1 : 0);
}
