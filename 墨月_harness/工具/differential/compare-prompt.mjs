#!/usr/bin/env node
/**
 * 装配层逐格比对 —— 同一份 (作品, 域, 专项, 焦点, 意图) 同时喂给
 * 墨月原件 prepareMoyuPrompt() 与 harness 的 preparePrompt()，比较**结构与选择结果**：
 *
 *   · 顶层标签的出现顺序（13 段注入顺序是否一致）
 *   · <knowledge id> 正文是否逐字相同
 *   · <workshop_task> 合同是否逐字相同
 *   · permission 三态是否一致
 *   · MVU 工作区按专项裁剪出的文件集是否一致
 *   · 条件段（维修 / 批量 / 代码修复 / 世界书投递 / 已有代码修复）是否按同样的条件出现
 *
 * **不比**两处有意偏离带来的文字差异：harness 把运行环境头改写成无网页版、
 * 工具段改写为 harness 工具名（见 工具/lib/prompt.mjs 头部）。这些段落只比"在不在"。
 *
 * 前置：node 工具/differential/setup-prompt-original.mjs
 * 用法：node 工具/differential/compare-prompt.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const base = new URL('./original/', import.meta.url).href;
const mineBase = new URL('../lib/', import.meta.url).href;

const original = await import(new URL('./prompt-original/prompt-runtime.ts', import.meta.url).href);
const mine = await import(`${mineBase}prompt.mjs`);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const bundle = JSON.parse(fs.readFileSync(path.join(ROOT, '知识库', '_源_prompt-bundle.json'), 'utf8'));
const taskById = new Map([...bundle.core, ...bundle.tasks].map((entry) => [entry.id, entry]));

const MODEL = { id: 'claude-sonnet-4-5', name: 'Claude' };

function project(overrides = {}) {
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
      depth: 0, order: 1, probability: 100, enabled: true, scale: 'small',
    }],
    rules: [], opening: { firstMessage: '她推开门。', alternateGreetings: [] },
    mvu: {
      enabled: true, initvarDesign: '开局值设计', updateRuleDesign: '变化规则设计',
      initvarSource: '主角:\n  金币: 0', updateRulesSource: '变量更新规则:\n  主角:\n    金币:\n      check: 当交易发生时',
      schemaSource: 'export const Schema = z.object({});',
    },
    statusbar: { kind: 'native', requirements: 'r', contract: '技术路线：原生 HTML', source: '<!doctype html></html>' },
    frontend: { requirements: 'r', contract: '唯一外层标签：`moyu_ui`', source: '<moyu_ui>\n原文\n</moyu_ui>', previewHtml: '<!doctype html></html>', testMessage: '' },
    ejsCharacters: [{ id: 'ejs-1', name: '状态', entryName: '[EJS] 状态', entryOrder: 3, requirements: '', contract: 'c', source: '<% if (1) { %>x<% } %>' }],
    scriptProjects: [], materials: [], artifacts: [], references: [], threads: {}, activeThreadIds: {},
    ...overrides,
  };
}

/** 从 system 里抽取可比较的特征。 */
function features(system, messages) {
  const tags = [...system.matchAll(/^<([a-z_]+)[\s>]/gm)].map((match) => match[1]).filter((tag) => tag !== 'knowledge' && tag !== 'workshop_task');
  const knowledge = system.match(/<knowledge id="[^"]*">\n([\s\S]*?)\n<\/knowledge>/)?.[1] ?? '';
  const contract = system.match(/<workshop_task\b[^>]*>[\s\S]*?<\/workshop_task>/i)?.[0] ?? '';
  const permission = system.match(/permission="([a-z-]+)"/)?.[1] ?? '';
  const mvuWorkspace = system.match(/<mvu_workspace[\s\S]*?<\/mvu_workspace>/)?.[0] ?? '';
  const mvuFiles = ['schema_source', 'initial_variable_design', 'initvar', 'update_rule_design', 'update_rules']
    .filter((tag) => mvuWorkspace.includes(`<${tag}>`)).join(',');
  const last = messages.at(-1);
  const lastText = typeof last?.content === 'string' ? last.content : '';
  return {
    tags: tags.join(' > '),
    knowledge: `${knowledge.length}:${hash(knowledge)}`,
    contract: `${contract.length}:${hash(contract)}`,
    permission,
    mvuFiles,
    batch: system.includes('<agent_batch_delivery') ? (system.match(/<agent_batch_delivery section="([a-z]+)"/)?.[1] ?? 'yes') : '',
    repair: system.includes('<artifact_repair_contract>'),
    existingCode: system.includes('<existing_code_repair>'),
    mvuWorkflow: system.includes('<mvu_workflow_state>'),
    worldbookTarget: system.includes('<worldbook_delivery_target>'),
    messages: messages.length,
    directTail: lastText.includes('/workshop-direct'),
  };
}

function hash(value) {
  let left = 2166136261;
  for (let index = 0; index < value.length; index += 1) left = Math.imul(left ^ value.charCodeAt(index), 16777619);
  return (left >>> 0).toString(16);
}

/** 用例：[名称, section, taskId, focus, flags] */
const CASES = [
  ['人物·性情', 'character', 'airp_character_nature', { targetId: 'char-1', area: 'characterNature' }, {}],
  ['人物·基础信息', 'character', 'airp_basic_information', { targetId: 'char-1', area: 'basicInformation' }, {}],
  ['人物·起点分流', 'character', 'airp_intake_router', { targetId: 'char-1' }, {}],
  ['世界书·小型（要成品）', 'worldbook', 'worldview_small', { targetId: 'wb-1' }, { artifactIntent: true, agentArtifactIntent: true }],
  ['世界书·小型（只回答）', 'worldbook', 'worldview_small', { targetId: 'wb-1' }, {}],
  ['世界书·规模分流', 'worldbook', 'worldview_scale_router', { targetId: 'wb-1' }, {}],
  ['规则', 'rules', 'creation_rules', {}, {}],
  ['开场白', 'opening', 'opening_style_then_draft', {}, {}],
  ['MVU·结构', 'mvu', 'mvu_schema_compilation', { area: 'schemaSource' }, {}],
  ['MVU·开局值设计', 'mvu', 'mvu_initvar_design', { area: 'initvarSource' }, {}],
  ['MVU·开局值成品', 'mvu', 'mvu_initvar_formatting', { area: 'initvarSource' }, { artifactIntent: true, agentArtifactIntent: true }],
  ['MVU·变化规则设计', 'mvu', 'mvu_update_rule_design', { area: 'updateRulesSource' }, {}],
  ['MVU·变化规则成品', 'mvu', 'mvu_update_rule_formatting', { area: 'updateRulesSource' }, { artifactIntent: true, agentArtifactIntent: true }],
  ['MVU·交叉检查', 'mvu', 'mvu_cross_check', { area: 'crossCheck' }, {}],
  ['状态栏·原生成品', 'statusbar', 'mvu_statusbar_native_build', {}, { artifactIntent: true, agentArtifactIntent: true }],
  ['状态栏·需求判定', 'statusbar', 'mvu_statusbar_briefing', { area: 'requirements' }, {}],
  ['前端·成品', 'frontend', 'frontend_build', {}, { artifactIntent: true, agentArtifactIntent: true }],
  ['前端·需求判定', 'frontend', 'frontend_briefing', {}, {}],
  ['EJS·成品', 'ejs', 'ejs_build', { targetId: 'ejs-1' }, { artifactIntent: true, agentArtifactIntent: true }],
  ['原卡·字段焦点', 'carddata', 'free_creation', { area: 'field:description' }, {}],
  ['原卡·总览', 'carddata', 'free_creation', {}, {}],
  ['维修轮', 'mvu', 'mvu_initvar_formatting', { area: 'initvarSource' }, { repair: { previousArtifact: '上一版', issues: ['缺字段'] } }],
  ['自查轮', 'mvu', 'mvu_initvar_formatting', { area: 'initvarSource' }, { selfCheck: true }],
  ['批量·世界书', 'worldbook', 'worldview_small', { targetId: 'wb-1' }, { artifactIntent: true, agentArtifactIntent: true, agentToolLimit: 30 }],
];

let passed = 0;
const diffs = [];
const compare = (name, a, b) => { if (a === b) passed += 1; else diffs.push({ name, a, b }); };

for (const [name, section, taskId, focus, flags] of CASES) {
  const task = taskById.get(taskId);
  const merged = { ...project(), ...flags.project };
  const common = {
    section, focus, userInput: '继续', project: merged, model: MODEL, layoutOrder: ['nav', 'main', 'assistant'],
  };
  let a; let b;
  try {
    a = features(...(() => {
      const prepared = original.prepareMoyuPrompt({
        bundle, task, pageLabel: section, recentMessages: [], materialIds: new Set(), artifactIds: new Set(),
        targetId: focus.targetId, ...common, ...flags,
      });
      return [prepared.system, prepared.messages];
    })());
  } catch (error) { a = { error: error.message.split('\n')[0] }; }
  try {
    b = features(...(() => {
      const prepared = mine.preparePrompt({
        domain: section, focus, userInput: common.userInput, project: merged, taskId,
        intent: flags.selfCheck ? 'self-check' : flags.artifactIntent ? 'artifact' : 'answer',
        agentMode: Boolean(flags.agentToolLimit),
        repair: flags.repair,
      });
      return [prepared.system, prepared.messages];
    })());
  } catch (error) { b = { error: error.message.split('\n')[0] }; }

  for (const key of ['tags', 'knowledge', 'contract', 'permission', 'mvuFiles', 'batch', 'repair', 'existingCode', 'mvuWorkflow', 'worldbookTarget', 'directTail']) {
    compare(`${name}｜${key}`, String(a[key] ?? a.error ?? ''), String(b[key] ?? b.error ?? ''));
  }
}

const total = passed + diffs.length;
console.log(`装配层逐格比对：${passed} 项一致，${diffs.length} 项有差异（共 ${total} 项）\n`);
for (const diff of diffs.slice(0, 20)) {
  console.log(`✗ ${diff.name}`);
  console.log(`   墨月: ${String(diff.a).slice(0, 300)}`);
  console.log(`   移植: ${String(diff.b).slice(0, 300)}\n`);
}
export const differential = { passed, diffs, total, label: 'compare-prompt' };
console.log(diffs.length ? `✗ 存在 ${diffs.length} 项差异` : '✓ 墨月原件装配与 harness 移植版在全部用例的结构与选择结果上一致');
if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('/compare-prompt.mjs')) {
  process.exit(diffs.length ? 1 : 0);
}
