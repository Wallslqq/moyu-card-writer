#!/usr/bin/env node
/**
 * 逐格比对（差分测试）——同一批用例同时喂给「墨月原始实现」与「harness 移植版」，
 * 逐条比较：归一化后的成品正文、error 明细集合、repair 标题集合、warning 标题集合。
 *
 * 原始实现直接从 `original/` 下的墨月 TS 源码加载（Node 24 类型擦除），
 * 因此这不是"照文档写的"，而是**同一份代码的两个副本对跑**。
 *
 * 用法：node 工具/differential/compare.mjs
 * 退出码：0 全部一致；1 存在差异。
 */
import process from 'node:process';

const base = new URL('./original/', import.meta.url).href;
const mineBase = new URL('../lib/', import.meta.url).href;

const moyu = {
  response: await import(`${base}response.ts`),
  validation: await import(`${base}workspace-validation.ts`),
  mvu: await import(`${base}mvu-check.ts`),
  yaml: await import(`${base}yaml-document.ts`),
  configured: await import(`${base}configured-artifact.ts`),
  syntax: await import(`${base}javascript-syntax.ts`),
};
const mine = {
  review: await import(`${mineBase}review.mjs`),
  html: await import(`${mineBase}html.mjs`),
  ejs: await import(`${mineBase}ejs.mjs`),
  mvu: await import(`${mineBase}mvu.mjs`),
  yaml: await import(`${mineBase}yaml.mjs`),
  configured: await import(`${mineBase}configured.mjs`),
  syntax: await import(`${mineBase}syntax.mjs`),
};

const F = (lang, body) => '```' + lang + '\n' + body + '\n```';

const WORLDVIEW_OK = [
  F('text', '<异乡人_世界设定>\n正文。\n</异乡人_世界设定>'),
  F('yaml', ['对应标签: <异乡人_世界设定>', '条目名称: 异乡人_世界设定', '启用: true', '激活策略: 蓝灯',
    '关键词: 无', '插入位置: 角色定义前', 'order: 1', '激活概率: 100'].join('\n')),
].join('\n\n');

const RULE_OK = [
  F('text', '<创作规则_称呼>\n不得替使用者决定台词。\n</创作规则_称呼>'),
  F('yaml', ['对应标签: <创作规则_称呼>', '条目名称: 创作规则_称呼', '启用: true', '激活策略: 蓝灯',
    '插入位置: 指定深度', 'order: 1', 'depth: 0'].join('\n')),
].join('\n\n');

const SCHEMA_OK = [
  "import { registerMvuSchema } from 'https://example.invalid/mvu_zod.js';",
  '',
  'export const Schema = z.object({',
  '  主角: z.object({ 金币: z.coerce.number(), 存活: z.boolean() }),',
  '});',
  '',
  '$(() => { registerMvuSchema(Schema); });',
].join('\n');

const INITVAR_OK = F('yaml', '主角:\n  金币: 0\n  存活: true');
const RULES_OK = F('yaml', '变量更新规则:\n  主角:\n    金币:\n      check: 当交易发生时\n      type: number');

const STATUSBAR_OK = [
  '<!doctype html>', '<html>', '<head><meta charset="utf-8"></head>', '<body>', '<div id="a"></div>',
  '<script>',
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

const EJS_OK = F('ejs', "<% if (getvar('stat_data.主角.存活')) { %>活着<% } %>");

const PROJECT = {
  mvu: { enabled: true, initvarDesign: 'd', updateRuleDesign: 'd', initvarSource: INITVAR_OK, updateRulesSource: RULES_OK, schemaSource: SCHEMA_OK },
  statusbar: { kind: 'native', requirements: '', contract: '', source: STATUSBAR_OK },
  frontend: { requirements: '', contract: FRONTEND_CONTRACT, source: FRONTEND_TEXT, previewHtml: FRONTEND_HTML, testMessage: '' },
  ejsCharacters: [{ id: 'e1', name: 'x', entryName: '[EJS] x', entryOrder: 1, requirements: '', contract: 'c', source: EJS_OK }],
  characters: [], worldbook: [], rules: [], opening: { firstMessage: '', alternateGreetings: [] },
  materials: [], artifacts: [], importedCard: undefined,
};

/** 审阅用例：[名称, taskId, 成品内容, 合同] */
const REVIEW_CASES = [
  ['世界书·合法', 'worldview_small', WORLDVIEW_OK, ''],
  ['世界书·缺激活策略', 'worldview_small', WORLDVIEW_OK.replace('激活策略: 蓝灯\n', ''), ''],
  ['世界书·缺配对配置', 'worldview_small', F('text', '<甲_设定>\n正文\n</甲_设定>'), ''],
  ['世界书·小型两条', 'worldview_small', `${WORLDVIEW_OK}\n\n${WORLDVIEW_OK}`, ''],
  ['世界书·order 非整数', 'worldview_small', WORLDVIEW_OK.replace('order: 1', 'order: 一'), ''],
  ['世界书·概率越界', 'worldview_small', WORLDVIEW_OK.replace('激活概率: 100', '激活概率: 150'), ''],
  ['世界书·绿灯缺关键词', 'worldview_small', WORLDVIEW_OK.replace('激活策略: 蓝灯', '激活策略: 绿灯').replace('关键词: 无', '关键词:'), ''],
  ['世界书·插入位置错', 'worldview_small', WORLDVIEW_OK.replace('插入位置: 角色定义前', '插入位置: 角色定义后'), ''],
  ['世界书·中型缺配置项', 'worldview_medium', F('text', '<甲_设定>\n正文\n</甲_设定>'), ''],
  ['规则·合法', 'creation_rules', RULE_OK, ''],
  ['规则·指定深度缺 depth', 'creation_rules', RULE_OK.replace('depth: 0\n', ''), ''],
  ['开场白·文风约定混入', 'opening_style_then_draft', F('text', '<开场白_文风约定>\n冷静\n</开场白_文风约定>'), ''],
  ['开场白·空', 'opening_style_then_draft', '', ''],
  ['MVU 开局值·YAML 语法错', 'mvu_initvar_formatting', F('yaml', '主角:\n  金币: [未闭合'), ''],
  ['MVU 开局值·无 YAML 块', 'mvu_initvar_formatting', F('text', '主角: 1'), ''],
  ['MVU 变化规则·Tab 缩进', 'mvu_update_rule_formatting', F('yaml', '变量更新规则:\n\t主角: 1'), ''],
  ['MVU 结构·合法', 'mvu_schema_compilation', F('javascript', SCHEMA_OK), ''],
  ['MVU 结构·缺注册', 'mvu_schema_compilation', F('javascript', SCHEMA_OK.replace('$(() => { registerMvuSchema(Schema); });', '')), ''],
  ['MVU 结构·导入 zod', 'mvu_schema_compilation', F('javascript', "import { z } from 'zod';\n" + SCHEMA_OK), ''],
  ['MVU 结构·coerce.boolean', 'mvu_schema_compilation', F('javascript', SCHEMA_OK.replace('z.boolean()', 'z.coerce.boolean()')), ''],
  ['MVU 结构·passthrough', 'mvu_schema_compilation', F('javascript', SCHEMA_OK.replace('});', '}).passthrough();')), ''],
  ['MVU 结构·语法错', 'mvu_schema_compilation', F('javascript', 'const 1 = ;'), ''],
  ['状态栏·合法', 'mvu_statusbar_native_build', F('html', STATUSBAR_OK), ''],
  ['状态栏·缺外壳', 'mvu_statusbar_native_build', F('html', STATUSBAR_OK.replace('<!doctype html>\n', '')), ''],
  ['状态栏·innerHTML', 'mvu_statusbar_native_build', F('html', STATUSBAR_OK.replace('textContent', 'innerHTML')), ''],
  ['状态栏·缺 MVU 读取', 'mvu_statusbar_native_build', F('html', STATUSBAR_OK.replace(/waitGlobalInitialized[\s\S]*?\);/, 'const d = 1;')), ''],
  ['状态栏·Vue 缺 createApp', 'mvu_statusbar_vue_build', F('html', STATUSBAR_OK), ''],
  ['状态栏·模板残留', 'mvu_statusbar_native_build', F('html', STATUSBAR_OK.replace('id="a"', 'data-x="实际变量路径"')), ''],
  ['前端·合法', 'frontend_build', [FRONTEND_TEXT, F('html', FRONTEND_HTML)].join('\n\n'), FRONTEND_CONTRACT],
  ['前端·缺 text 块', 'frontend_build', F('html', FRONTEND_HTML), FRONTEND_CONTRACT],
  ['前端·持久化存储', 'frontend_build', [FRONTEND_TEXT, F('html', FRONTEND_HTML.replace("document.getElementById('root')", "localStorage.getItem('x');\ndocument.getElementById('root')"))].join('\n\n'), FRONTEND_CONTRACT],
  ['前端·漏按钮', 'frontend_build', [FRONTEND_TEXT, F('html', FRONTEND_HTML.replace('<button type="button">展开</button>\n', ''))].join('\n\n'), FRONTEND_CONTRACT],
  ['前端·外层标签未解析', 'frontend_build', [FRONTEND_TEXT, F('html', FRONTEND_HTML.replace(/moyu_ui/g, 'other_tag'))].join('\n\n'), FRONTEND_CONTRACT],
  ['前端·围栏名归一（repair）', 'frontend_build', `${F('txt', '提示词')}\n\n${F('htm', FRONTEND_HTML)}`, FRONTEND_CONTRACT],
  ['EJS·合法', 'ejs_build', EJS_OK, ''],
  ['EJS·getVar', 'ejs_build', F('ejs', "<% if (getVar('x')) { %>a<% } %>"), ''],
  ['EJS·标签数不等', 'ejs_build', F('ejs', "<% if (getvar('x')) { %>a<% }"), ''],
  ['EJS·表达式语法错', 'ejs_build', F('ejs', '<%= (1 + %>'), ''],
  ['文本类·缺结束标签（repair）', 'airp_basic_information', '<甲_基础信息>\n正文', ''],
  ['文本类·合法', 'airp_basic_information', F('text', '<甲_基础信息>\n正文\n</甲_基础信息>'), ''],
  ['外壳·围栏奇数（repair）', 'mvu_schema_compilation', '```javascript\n' + SCHEMA_OK, ''],
  ['原卡·字段为空', 'free_creation', '', 'moyu-card-edit:field:description'],
  ['原卡·正则非 JSON', 'free_creation', '不是 JSON', 'moyu-card-edit:regex:0'],
  ['原卡·正则合法', 'free_creation', '```json\n{"scriptName":"x"}\n```', 'moyu-card-edit:regex:0'],
].map(([name, taskId, content, contract]) => ({ name, taskId, content, contract }));

/** 交叉检查用例：[名称, mvu 覆盖] */
const CROSS_CASES = [
  ['交叉·类型不一致', { initvarSource: F('yaml', '主角:\n  金币: "零"\n  存活: true') }],
  ['交叉·规则引用不存在路径', { updateRulesSource: F('yaml', '变量更新规则:\n  主角:\n    声望:\n      check: 当推进时') }],
  ['交叉·规则更新只读字段', { updateRulesSource: F('yaml', '变量更新规则:\n  主角:\n    金币:\n      check: 当交易时\n    _隐藏:\n      check: 当暗线推进时') }],
  ['交叉·check 写成代码', { updateRulesSource: F('yaml', '变量更新规则:\n  主角:\n    金币:\n      check: () => true') }],
  ['交叉·三份缺一', { updateRulesSource: '' }],
  ['交叉·结构缺开局值字段', { initvarSource: F('yaml', '主角:\n  金币: 0\n  存活: true\n  声望: 0') }],
  ['交叉·开局值含 stat_data 外壳', { initvarSource: F('yaml', 'stat_data:\n  主角:\n    金币: 0') }],
  ['交叉·变化规则缺根节点', { updateRulesSource: F('yaml', '规则:\n  主角:\n    金币:\n      check: x') }],
  ['交叉·模板字段残留', { schemaSource: SCHEMA_OK + '\n// 实际变量路径' }],
];

function normalizeReview(result) {
  const pick = (severity, field) => result.diagnostics.filter((d) => d.severity === severity).map((d) => d[field]).sort();
  return JSON.stringify({
    content: result.content,
    error: pick('error', 'detail'),
    repair: pick('repair', 'title'),
    warning: pick('warning', 'title'),
  });
}

let passed = 0;
const diffs = [];
const compare = (name, a, b) => { if (a === b) passed += 1; else diffs.push({ name, a, b }); };

for (const item of REVIEW_CASES) {
  compare(`审阅｜${item.name}`,
    normalizeReview(moyu.response.reviewArtifactContent(item.taskId, item.content, item.contract)),
    normalizeReview(mine.review.reviewArtifactContent(item.taskId, item.content, item.contract)));
}

const CROSS_CONTENT = F('yaml', '变量更新规则:\n  主角:\n    金币:\n      check: 当交易时\n      type: number');
for (const [name, override] of CROSS_CASES) {
  const project = { ...PROJECT, mvu: { ...PROJECT.mvu, ...override } };
  compare(`交叉｜${name}`,
    normalizeReview(moyu.validation.workspaceArtifactReview(project, 'mvu_update_rule_formatting', CROSS_CONTENT, '')),
    normalizeReview(mine.review.workspaceArtifactReview(project, 'mvu_update_rule_formatting', CROSS_CONTENT, '')));
}

compare('函数｜mvuSchemaIssues（合法）', JSON.stringify(moyu.response.mvuSchemaIssues(SCHEMA_OK)), JSON.stringify(mine.mvu.mvuSchemaIssues(SCHEMA_OK)));
compare('函数｜mvuSchemaIssues（coerce.boolean）', JSON.stringify(moyu.response.mvuSchemaIssues(SCHEMA_OK.replace('z.boolean()', 'z.coerce.boolean()'))), JSON.stringify(mine.mvu.mvuSchemaIssues(SCHEMA_OK.replace('z.boolean()', 'z.coerce.boolean()'))));
compare('函数｜statusbarArtifactIssues', JSON.stringify(moyu.response.statusbarArtifactIssues(STATUSBAR_OK, 'native')), JSON.stringify(mine.html.statusbarArtifactIssues(STATUSBAR_OK, 'native')));
compare('函数｜statusbarArtifactIssues（Vue）', JSON.stringify(moyu.response.statusbarArtifactIssues(STATUSBAR_OK, 'vue')), JSON.stringify(mine.html.statusbarArtifactIssues(STATUSBAR_OK, 'vue')));
compare('函数｜frontendArtifactIssues', JSON.stringify(moyu.response.frontendArtifactIssues(FRONTEND_TEXT, FRONTEND_HTML, FRONTEND_CONTRACT)), JSON.stringify(mine.html.frontendArtifactIssues(FRONTEND_TEXT, FRONTEND_HTML, FRONTEND_CONTRACT)));
compare('函数｜ejsArtifactIssues', JSON.stringify(moyu.response.ejsArtifactIssues(EJS_OK)), JSON.stringify(mine.ejs.ejsArtifactIssues(EJS_OK)));
compare('函数｜inspectYamlMapping.keys', JSON.stringify(moyu.yaml.inspectYamlMapping(INITVAR_OK).keys), JSON.stringify(mine.yaml.inspectYamlMapping(INITVAR_OK).keys));
compare('函数｜inspectYamlMapping.issue', JSON.stringify(moyu.yaml.inspectYamlMapping('a: [1').issue), JSON.stringify(mine.yaml.inspectYamlMapping('a: [1').issue));
compare('函数｜configuredTextBlocks', JSON.stringify(moyu.configured.configuredTextBlocks(WORLDVIEW_OK)), JSON.stringify(mine.configured.configuredTextBlocks(WORLDVIEW_OK)));
compare('函数｜configuredTextArtifactIssues', JSON.stringify(moyu.configured.configuredTextArtifactIssues(F('text', 'no tag'))), JSON.stringify(mine.configured.configuredTextArtifactIssues(F('text', 'no tag'))));
compare('函数｜javascriptSyntaxIssue', JSON.stringify(moyu.syntax.javascriptSyntaxIssue('const 1 = ;', 'module')), JSON.stringify(mine.syntax.javascriptSyntaxIssue('const 1 = ;', 'module')));
compare('函数｜ejsSyntaxIssues', JSON.stringify(moyu.syntax.ejsSyntaxIssues(EJS_OK)), JSON.stringify(mine.syntax.ejsSyntaxIssues(EJS_OK)));
compare('函数｜checkMvuFiles.issues', JSON.stringify(moyu.mvu.checkMvuFiles(PROJECT.mvu, true).issues), JSON.stringify(mine.mvu.checkMvuFiles(PROJECT.mvu, true).issues));
compare('函数｜checkMvuFiles.keys', JSON.stringify(moyu.mvu.checkMvuFiles(PROJECT.mvu, true).keys), JSON.stringify(mine.mvu.checkMvuFiles(PROJECT.mvu, true).keys));
compare('函数｜checkMvuFiles.limitations', JSON.stringify(moyu.mvu.checkMvuFiles(PROJECT.mvu, true).limitations), JSON.stringify(mine.mvu.checkMvuFiles(PROJECT.mvu, true).limitations));

const total = passed + diffs.length;
console.log(`逐格比对：${passed} 项一致，${diffs.length} 项有差异（共 ${total} 项）\n`);
for (const diff of diffs.slice(0, 12)) {
  console.log(`✗ ${diff.name}`);
  console.log(`   墨月: ${String(diff.a).slice(0, 420)}`);
  console.log(`   移植: ${String(diff.b).slice(0, 420)}\n`);
}
console.log(diffs.length ? `✗ 存在 ${diffs.length} 项差异` : '✓ 墨月原始实现与 harness 移植版在全部用例上逐字段一致');
export const differential = { passed: passed, diffs: diffs, total: passed + diffs.length, label: 'compare' };
// 作为脚本直接运行时才决定退出码；被验收脚本 import 时不终止进程。
if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('/compare.mjs')) {
  process.exit(diffs.length ? 1 : 0);
}
