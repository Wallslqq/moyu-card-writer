#!/usr/bin/env node
/**
 * 路由与意图推断逐格比对。
 * 同一批 (域, 作品状态, 焦点, 输入, 意图) 同时喂给墨月原件与 harness 移植版，
 * 比较 resolvePageTask / resolveConversationTask / requestsArtifact / 工具上限 的输出。
 *
 * 注意口径差异（有意的接口适配，不是行为差异）：
 *   墨月 resolvePageTask 从 tasks 数组里取"任务对象"返回；harness 直接返回专项 id 字符串。
 *   比对时统一取 `result?.id ?? result`。
 *
 * 用法：node 工具/differential/compare-route.mjs
 */
import path from 'node:path';
import process from 'node:process';

const base = new URL('./original/', import.meta.url).href;
const mineBase = new URL('../lib/', import.meta.url).href;

const moyu = {
  page: await import(`${base}page-assistant.ts`),
  agent: await import(`${base}agent-run.ts`),
  // sectionTaskFilter 决定每个页面实际能路由到哪些专项；界面就是用它过滤后才调 resolvePageTask 的。
  workspace: await import(new URL('./validate-original/workspace.ts', import.meta.url).href),
};
const mine = {
  route: await import(`${mineBase}route.mjs`),
  promptLib: await import(`${mineBase}prompt.mjs`),
  agentRun: await import(`${mineBase}agent-run.mjs`),
};

// 28 条专项的 id（从知识库索引取，与墨月 prompt-bundle 一一对应）
const ALL_TASKS = [...mine.promptLib.knowledgeIndex().keys()]
  .filter((id) => mine.promptLib.readKnowledge(id).meta.kind === 'task')
  .map((id) => ({ id, name: id }));

/** 墨月界面按页面过滤专项后再路由；空列表时 resolvePageTask 的 `tasks[0]` 兜底即为 undefined。 */
const tasksFor = (section) => ALL_TASKS.filter((task) => moyu.workspace.sectionTaskFilter(section, task.id));

const emptyProject = (overrides = {}) => ({
  characters: [], worldbook: [], rules: [],
  opening: { firstMessage: '', alternateGreetings: [] },
  mvu: { enabled: false, initvarDesign: '', updateRuleDesign: '', initvarSource: '', updateRulesSource: '', schemaSource: '' },
  statusbar: { kind: 'none', requirements: '', contract: '', source: '' },
  frontend: { requirements: '', contract: '', source: '', previewHtml: '' },
  ejsCharacters: [],
  ...overrides,
});

const FILLED = {
  character: emptyProject({ characters: [{ id: 'c1', name: '甲', basicInformation: 'x', characterNature: 'y' }] }),
  worldbookScale: emptyProject({ worldbook: [{ id: 'w1', scale: 'large' }] }),
  mvuFull: emptyProject({ mvu: { enabled: true, initvarDesign: 'a', updateRuleDesign: 'b', initvarSource: 'c', updateRulesSource: 'd', schemaSource: 'e' } }),
  mvuPartial: emptyProject({ mvu: { enabled: true, initvarDesign: '', updateRuleDesign: '', initvarSource: '', updateRulesSource: '', schemaSource: 'e' } }),
  statusbarNative: emptyProject({ statusbar: { kind: 'native', contract: '技术路线：原生 HTML', source: 'x' } }),
  statusbarVue: emptyProject({ statusbar: { kind: 'native', contract: '技术路线：单 HTML Vue', source: 'x' } }),
  statusbarKindVueNoContract: emptyProject({ statusbar: { kind: 'vue', contract: '', source: '' } }),
  frontendReady: emptyProject({ frontend: { contract: '唯一外层标签：`x`', source: 'y', previewHtml: 'z' } }),
  ejsReady: emptyProject({ ejsCharacters: [{ id: 'e1', contract: 'c', source: 's' }] }),
  ejsNoContract: emptyProject({ ejsCharacters: [{ id: 'e1', contract: '', source: '' }] }),
};

const INPUTS = [
  '', '继续', '帮我写个配角', '这个 NPC 怎么样', '跑卡结果分析', '她太被动了，问题分析',
  '零散的想法', '没想好怎么写', '整理一下我的想法', '这是小型世界观', '要做中型世界观',
  '大型还是中型好', '怎么拆条目', '讨论一下设计', '生成文件', '生成 yaml', '初始变量怎么定',
  '更新规则说清楚', '交叉检查三份文件', '结构脚本有问题', '这个国家有很多城邦',
  '讨论需求', '能不能做', '怎么做', '生成', '重新判断规模', '帮我生成一份小型世界观',
  '先不要生成，我们再讨论', '为什么还没有生成成品？',
];

/** 每条用例：[名称, section, project, focus, input, artifactIntent, preferredTaskId] */
const CASES = [
  ...['overview', 'carddata', 'character', 'worldbook', 'rules', 'opening', 'mvu', 'statusbar', 'frontend', 'ejs', 'package']
    .flatMap((section) => INPUTS.map((input) => [`${section}｜${input || '(空)'}`, section, FILLED[section] ?? emptyProject(), {}, input, false, ''])),
  ['人物·无人物时起点分流', 'character', emptyProject(), {}, '你好', false, ''],
  ['人物·按栏目 性情', 'character', FILLED.character, { area: 'characterNature' }, '继续', false, ''],
  ['人物·按栏目 生活结构', 'character', FILLED.character, { area: 'lifeStructure' }, '继续', false, ''],
  ['人物·测试笔记栏目', 'character', FILLED.character, { area: 'notes' }, '继续', false, ''],
  ['世界书·焦点条目带规模', 'worldbook', FILLED.worldbookScale, { targetId: 'w1' }, '继续', false, ''],
  ['世界书·沿用已锁定规模', 'worldbook', emptyProject(), {}, '继续', false, 'worldview_medium'],
  ['世界书·正文提到国家不改档', 'worldbook', FILLED.worldbookScale, { targetId: 'w1' }, '这个国家有很多城邦', false, 'worldview_medium'],
  ['MVU·交叉检查页签', 'mvu', FILLED.mvuFull, { area: 'crossCheck' }, '顺便看下开局值', false, ''],
  ['MVU·结构页签', 'mvu', FILLED.mvuFull, { area: 'schemaSource' }, '继续', false, ''],
  ['MVU·开局值页签+讨论', 'mvu', FILLED.mvuFull, { area: 'initvarSource' }, '讨论一下设计', false, ''],
  ['MVU·开局值页签+出片', 'mvu', FILLED.mvuFull, { area: 'initvarSource' }, '生成文件', true, ''],
  ['MVU·规则页签+出片', 'mvu', FILLED.mvuFull, { area: 'updateRulesSource' }, '生成文件', true, ''],
  ['MVU·齐全后落交叉检查', 'mvu', FILLED.mvuFull, {}, '继续', false, ''],
  ['MVU·缺结构', 'mvu', FILLED.mvuPartial, {}, '继续', false, ''],
  ['状态栏·规划焦点', 'statusbar', FILLED.statusbarNative, { area: 'requirements' }, '继续', false, ''],
  ['状态栏·合同焦点', 'statusbar', FILLED.statusbarNative, { area: 'contract' }, '继续', false, ''],
  ['状态栏·原生路线出片', 'statusbar', FILLED.statusbarNative, {}, '继续', true, ''],
  ['状态栏·Vue 路线出片', 'statusbar', FILLED.statusbarVue, {}, '继续', true, ''],
  ['状态栏·kind 描述源码但无合同', 'statusbar', FILLED.statusbarKindVueNoContract, {}, '继续', false, ''],
  ['状态栏·改需求', 'statusbar', FILLED.statusbarVue, {}, '想调整一下需求', false, ''],
  ['前端·有合同出片', 'frontend', FILLED.frontendReady, {}, '继续', true, ''],
  ['前端·无合同', 'frontend', emptyProject(), {}, '继续', false, ''],
  ['EJS·有合同出片', 'ejs', FILLED.ejsReady, {}, '生成', true, ''],
  ['EJS·无合同', 'ejs', FILLED.ejsNoContract, {}, '生成', true, ''],
];

let passed = 0;
const diffs = [];
const compare = (name, a, b) => { if (a === b) passed += 1; else diffs.push({ name, a, b }); };

for (const [name, section, project, focus, input, artifactIntent, preferred] of CASES) {
  const a = moyu.page.resolvePageTask(section, tasksFor(section), project, focus, input, artifactIntent, preferred);
  const b = mine.route.resolvePageTask(section, project, focus, input, artifactIntent, preferred);
  compare(`路由｜${name}`, String(a?.id ?? a ?? ''), String(b ?? ''));
}

/** 会话承接 */
const CARRY_CASES = [
  ['规模结论→中型', 'worldbook', emptyProject(), {}, '继续', false, 'worldview_scale_router', false, '世界观规模：中型'],
  ['规模结论→小型', 'worldbook', emptyProject(), {}, '继续', false, 'worldview_scale_router', false, '**世界观规模：小型**'],
  ['规模结论缺失', 'worldbook', emptyProject(), {}, '继续', false, 'worldview_scale_router', false, '我觉得中型不错'],
  ['锁定会话时建议不同', 'character', FILLED.character, { area: 'basicInformation' }, '帮我写个配角', false, 'airp_basic_information', true, ''],
  ['锁定会话但状态栏改需求', 'statusbar', FILLED.statusbarVue, {}, '修改需求', false, 'mvu_statusbar_native_build', true, ''],
  ['未锁定则换任务', 'character', FILLED.character, { area: 'basicInformation' }, '帮我写个配角', false, 'airp_basic_information', false, ''],
];
for (const [name, section, project, focus, input, artifactIntent, preferred, lock, previous] of CARRY_CASES) {
  const a = moyu.page.resolveConversationTask(section, tasksFor(section), project, focus, input, artifactIntent, preferred, lock, previous);
  const b = mine.route.resolveConversationTask(section, project, focus, input, artifactIntent, preferred, lock, previous);
  compare(`承接｜${name}`, JSON.stringify({ task: a?.task?.id ?? null, suggested: a?.suggestedTask?.id ?? null }),
    JSON.stringify({ task: b?.task ?? null, suggested: b?.suggestedTask ?? null }));
}

/** 意图推断 */
for (const input of INPUTS.concat(['把这份设定写进世界书', '按中型世界观生成', '准备待确认稿', '重新生成'])) {
  compare(`意图｜${input || '(空)'}`, String(moyu.agent.requestsArtifact(input)), String(mine.route.requestsArtifact(input)));
}

/** 工具上限与快照 */
for (const value of [undefined, 0, 1, 30, 100, 1000, -5, 3.6, 'abc']) {
  compare(`工具上限｜${String(value)}`, String(moyu.agent.normalizeAgentToolCallLimit(value)), String(mine.agentRun.normalizeAgentToolCallLimit(value)));
}

const total = passed + diffs.length;
console.log(`路由/意图逐格比对：${passed} 项一致，${diffs.length} 项有差异（共 ${total} 项）\n`);
for (const diff of diffs.slice(0, 15)) {
  console.log(`✗ ${diff.name}`);
  console.log(`   墨月: ${diff.a}`);
  console.log(`   移植: ${diff.b}\n`);
}
export const differential = { passed, diffs, total, label: 'compare-route' };
console.log(diffs.length ? `✗ 存在 ${diffs.length} 项差异` : '✓ 墨月原件路由与 harness 移植版在全部用例上一致');
if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('/compare-route.mjs')) {
  process.exit(diffs.length ? 1 : 0);
}
