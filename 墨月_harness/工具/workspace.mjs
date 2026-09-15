#!/usr/bin/env node
/**
 * 墨月 Harness · 工作区按需查阅（Agent 的两个只读工具）
 *
 *   node 工具/workspace.mjs --targets --section worldbook --project 作品.json
 *   node 工具/workspace.mjs --read    --section character --target char-1 [--offset N] [--limit N] [--guidance]
 *   node 工具/workspace.mjs --scan    --query "周梦瑶" [--section character]
 *   node 工具/workspace.mjs --tools   --project 作品.json [--intent artifact] [--batch worldbook] [--self-check]
 *   node 工具/workspace.mjs --self-test
 *
 * 等价墨月的 `moyu_read_authorized_context` / `moyu_search_workspace`，
 * 以及 `allowedMoyuAgentTools()` 的工具裁剪规则。
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { targets, readTarget, readSection, searchWorkspace, sliceContent, allowedTools, MAX_READ_LENGTH } from './lib/workspace-read.mjs';
import { KNOWLEDGE_DOMAINS } from './lib/domains.mjs';
import { resolveDelivery, resolveConversationTask } from './lib/route.mjs';
import { readKnowledge } from './lib/prompt.mjs';

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
const num = (v, fallback) => { const n = Number(one(v)); return Number.isFinite(n) ? n : fallback; };

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EMPTY = { title: '', summary: '', characters: [], worldbook: [], rules: [], opening: { firstMessage: '', alternateGreetings: [] }, mvu: {}, statusbar: {}, frontend: {}, ejsCharacters: [] };

function loadProject(flags) {
  const file = one(flags.project);
  if (!file) return EMPTY;
  return JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
}

function selfTest() {
  const project = {
    title: '异乡人', summary: '测试', characters: [{ id: 'char-1', name: '周梦瑶', basicInformation: '上海人。', lifeStructure: '', characterNature: '想要被看见。', sceneExpression: '', clothingStyle: '', notes: '' }],
    worldbook: [{ id: 'wb-1', title: '钟楼_地点设定', content: '钟声覆盖半城。', keys: ['钟楼'], secondaryKeys: [], activation: 'keyword', placement: 'before_character', depth: 0, order: 60, probability: 100, enabled: true, scale: 'medium' }],
    rules: [{ id: 'r-1', title: '称呼规则', content: '不得替使用者决定台词。', placement: 'system_depth', depth: 0, order: 1, enabled: true }],
    ejsCharacters: [{ id: 'e-1', name: '状态', entryName: '[EJS] 状态', entryOrder: 3, source: '<% if (1) { %>x<% } %>' }],
    opening: { firstMessage: '她推开门。', alternateGreetings: [] }, mvu: {}, statusbar: {}, frontend: {},
  };
  const cases = [
    ['目录只给 id 与名称', (() => { const t = targets(project, 'worldbook'); return t.length === 1 && t[0].target_id === 'wb-1' && t[0].title === '钟楼_地点设定'; })()],
    ['按 target_id 读到正文', (readTarget(project, 'worldbook', 'wb-1') ?? '').includes('钟声覆盖半城')],
    ['人物读取包含全部栏目', (() => { const value = readTarget(project, 'character', 'char-1') ?? ''; return ['basic_information', 'life_structure', 'character_nature', 'scene_expression', 'clothing_style', 'test_notes'].every((key) => value.includes(key)); })()],
    ['未知 target 返回 undefined', readTarget(project, 'worldbook', '不存在') === undefined],
    ['页面级读取返回目录', (readSection(project, 'rules') ?? '').includes('r-1')],
    ['搜索命中并给出片段与 target_id', (() => {
      const r = searchWorkspace(project, ['character', 'worldbook'], '周梦瑶');
      // 页面级目录与 target 正文都会命中（与墨月一致），故只断言"至少一条带 target_id 的正文命中"。
      return r.total >= 1 && r.matches.some((m) => m.target_id === 'char-1' && m.excerpt.includes('周梦瑶'));
    })()],
    ['搜索是字面匹配，不是正则', searchWorkspace(project, ['worldbook'], '钟.覆盖').total === 0],
    ['搜索无结果', searchWorkspace(project, ['worldbook'], '不存在的词').total === 0],
    ['搜索分页给出 next_offset', (() => { const r = searchWorkspace(project, ['character', 'worldbook', 'rules', 'ejs'], '。', 0, 1); return r.total > 1 && r.next_offset === 1; })()],
    ['长内容按 offset/limit 续读', (() => { const s = sliceContent('0123456789', 2, 3); return s.content === '234' && s.next_offset === 5 && s.total_characters === 10; })()],
    ['工具裁剪：只回答时不给待确认工具', allowedTools({ hasContexts: true, artifactIntent: false }).join(',') === 'moyu_read_authorized_context,moyu_search_workspace'],
    ['工具裁剪：出片 + 批量时给全部', allowedTools({ hasContexts: true, artifactIntent: true, workspaceCheck: true, batch: 'worldbook' }).length === 5],
    ['工具裁剪：自查不出批量', !allowedTools({ hasContexts: true, artifactIntent: true, batch: 'mvu', selfCheck: true }).includes('moyu_prepare_batch')],
    ['读取上限与墨月一致', MAX_READ_LENGTH === 24_000],
  ];
  let failed = 0;
  for (const [name, ok] of cases) { if (!ok) failed += 1; console.log(`${ok ? '  ✓' : '  ✗'} ${name}`); }
  console.log(`\n${failed ? '✗' : '✓'} 工作区查阅自测 ${cases.length - failed}/${cases.length} 通过`);
  return failed ? 1 : 0;
}

function main() {
  const flags = parseArgs(process.argv.slice(2));
  if (flags['self-test']) return selfTest();
  const project = loadProject(flags);
  const section = one(flags.section) ?? one(flags.domain);

  if (flags.targets) {
    if (!section) { console.error('需要 --section'); return 2; }
    console.log(JSON.stringify({ section, targets: targets(project, section) }, null, 2));
    return 0;
  }

  if (flags.read) {
    if (!section) { console.error('需要 --section'); return 2; }
    const targetId = one(flags.target);
    const content = targetId ? readTarget(project, section, targetId) : readSection(project, section);
    if (content === undefined) { console.error(`✗ 这一页没有 target_id「${targetId}」；先用 --targets 看目录。`); return 1; }
    const limit = Math.min(MAX_READ_LENGTH, num(flags.limit, 12_000));
    const sliced = sliceContent(content, num(flags.offset, 0), limit);
    // --guidance：附上该页专项的合同与知识（等价墨月 include_guidance）。
    let guidance;
    if (flags.guidance) {
      const routed = resolveConversationTask(section, project, {}, '', false);
      const entry = routed.task ? readKnowledge(routed.task) : undefined;
      guidance = entry ? { task_id: routed.task, task_prompt: entry.contract, knowledge: entry.knowledge } : { task_id: routed.task ?? '', task_prompt: '', knowledge: '' };
    }
    console.log(JSON.stringify({ section, ...(targetId ? { target_id: targetId } : {}), ...sliced, ...(guidance ? { guidance } : {}), note: '当前作品的锁定快照。next_offset 不为空表示仍有后续正文。' }, null, 2));
    return 0;
  }

  if (flags.scan) {
    const query = one(flags.query);
    if (!query) { console.error('需要 --query'); return 2; }
    const domains = section ? [section] : KNOWLEDGE_DOMAINS;
    const result = searchWorkspace(project, domains, query, num(flags.offset, 0), 30);
    console.log(JSON.stringify(result, null, 2));
    return result.total ? 0 : 1;
  }

  if (flags.tools) {
    const context = { explicitIntent: one(flags.intent), userInput: one(flags.input) ?? '' };
    const routed = resolveConversationTask(section ?? 'worldbook', project, {}, context.userInput, context.explicitIntent === 'artifact');
    const delivery = resolveDelivery(section ?? 'worldbook', routed.task ?? '', context);
    const names = allowedTools({
      hasContexts: true,
      artifactIntent: delivery.artifactIntent,
      workspaceCheck: ['mvu', 'statusbar', 'frontend', 'ejs'].includes(section ?? ''),
      selfCheck: delivery.selfCheck,
      batch: delivery.batch,
    });
    console.log(JSON.stringify({ section: section ?? 'worldbook', task: routed.task, permission: delivery.permission, tools: names }, null, 2));
    return 0;
  }

  console.error('用法：--targets | --read | --scan | --tools | --self-test（详见文件头）');
  return 2;
}

process.exit(main());
