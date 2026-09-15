#!/usr/bin/env node
/**
 * 墨月 Harness · 作品现状与下一步
 *
 * 为什么需要它：墨月网页版靠三栏 UI 的页签状态告诉你"现在在哪、还差什么"；
 * DSH 里没有 UI 层（`sectionState()` 不移植），所以把它变成一段可读文本。
 * 每一轮开头跑一次，编排者就知道自己站在哪、Author 说一句"继续"会落到哪条专项。
 *
 * 本工具**不是第二个裁判**：它只汇总既有状态并调用既有路由（lib/route.mjs），
 * 不自己发明优先级规则、不改任何文件。
 *
 * 用法：
 *   node 工具/status.mjs --project 状态/作品/卡名.json [--json] [--out 结果.json]
 *   node 工具/status.mjs --list
 *   node 工具/status.mjs --self-test
 *
 * 退出码：0 正常；2 用法/输入错误。
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { resolvePageTask } from './lib/route.mjs';
import { DOMAIN_LABELS, domainLabel, readKnowledge } from './lib/prompt.mjs';
import { validateProject } from './lib/validate.mjs';
import { createCharacter, createWorldbookEntry, createRule, createEjsCharacter } from './lib/apply.mjs';
import { emptyProject } from './new-project.mjs';

const HARNESS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROJECT_DIR = path.join(HARNESS_ROOT, '状态', '作品');

/** 人物六栏目（栏目标识要与作品工程字段、路由 focus.area 完全一致）。 */
export const CHAR_AREAS = [
  ['basicInformation', '基础信息'],
  ['lifeStructure', '生活结构'],
  ['characterNature', '人物性情'],
  ['sceneExpression', '场景表现'],
  ['clothingStyle', '衣着风格'],
  ['notes', '备注'],
];
const MVU_FILES = [
  ['initvarDesign', '开局值设计'],
  ['initvarSource', '开局值'],
  ['updateRuleDesign', '变化规则设计'],
  ['updateRulesSource', '变化规则'],
  ['schemaSource', '结构'],
];
/**
 * 建议顺序：与墨月的创作顺序一致（人物 → 世界 → 规则 → 开场 → MVU → 状态栏 → 前端 → EJS）。
 * `carddata`（原卡资料）是**可选导入**、`package`（检查与导出）是终点，两者都不是待办，
 * 因此不参与"下一步"推荐；`overview` 只在标题/简介还没填时才算前置待办。
 */
const ORDER = ['overview', 'character', 'worldbook', 'rules', 'opening', 'mvu', 'statusbar', 'frontend', 'ejs', 'carddata', 'package'];
const WORK_ORDER = ['character', 'worldbook', 'rules', 'opening', 'mvu', 'statusbar', 'frontend', 'ejs'];

const filled = (value) => Boolean(String(value ?? '').trim());

function parseArgs(argv) {
  const out = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token.startsWith('--')) {
      const key = token.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) { out.flags[key] = next; i += 1; }
      else out.flags[key] = true;
    } else out._.push(token);
  }
  return out;
}

/** 逐域算出：完成度、空缺项、以及"此刻只说继续会落到哪条专项"。 */
export function inspect(project) {
  const domains = [];

  const pushCharacter = () => {
    const list = [];
    for (const [index, character] of (project.characters ?? []).entries()) {
      const name = character.name || `未命名人物${index + 1}`;
      const gaps = CHAR_AREAS.filter(([key]) => !filled(character[key]));
      const area = gaps.length ? gaps[0][0] : '';
      let task = '';
      try { task = resolvePageTask('character', project, { targetId: character.id, area }, '继续', false); } catch { task = ''; }
      list.push({
        id: character.id,
        name,
        done: CHAR_AREAS.length - gaps.length,
        total: CHAR_AREAS.length,
        gaps: gaps.map(([key, label]) => ({ key, label })),
        task,
      });
    }
    const complete = list.length > 0 && list.every((item) => item.gaps.length === 0);
    return { complete, list };
  };

  const character = pushCharacter();
  const worldbook = (project.worldbook ?? []).map((entry, index) => ({
    name: entry.title || `未命名条目${index + 1}`,
    scale: entry.scale ?? '',
    filled: filled(entry.content),
  }));
  const mvuFiles = MVU_FILES.map(([key, label]) => ({ key, label, filled: filled(project.mvu?.[key]) }));
  const ejs = (project.ejsCharacters ?? []).map((item, index) => ({
    name: item.name || `未命名 EJS${index + 1}`,
    requirements: filled(item.requirements),
    contract: filled(item.contract),
    source: filled(item.source),
  }));
  // validateProject 假定记录由构造器生成（字段齐全）。手写残缺记录会抛错，
  // 而本工具是"汇总"不是"裁判"，所以这里降级成一条提示，不让它整份崩掉。
  let structIssues = [];
  let structError = '';
  try { structIssues = validateProject(project); }
  catch (error) { structError = String(error?.message ?? error); }

  const record = (domain, complete, detail, focus = {}) => {
    let task = '';
    try { task = resolvePageTask(domain, project, focus, '继续', false) ?? ''; } catch { task = ''; }
    domains.push({ domain, label: domainLabel(domain), complete, detail, task, taskName: taskName(task) });
  };

  record('overview', filled(project.title) && filled(project.summary), {
    title: filled(project.title), summary: filled(project.summary),
  });
  record('carddata', Boolean(project.importedCard), { imported: Boolean(project.importedCard) });
  record(
    'character',
    character.complete,
    { count: character.list.length, items: character.list },
    character.list.length && character.list[0].gaps.length
      ? { targetId: (project.characters ?? [])[0]?.id, area: character.list[0].gaps[0].key }
      : {},
  );
  record('worldbook', worldbook.length > 0 && worldbook.every((item) => item.filled), { count: worldbook.length, items: worldbook });
  record('rules', (project.rules ?? []).length > 0, { count: (project.rules ?? []).length });
  record('opening', filled(project.opening?.firstMessage), {
    first: filled(project.opening?.firstMessage),
    alternates: (project.opening?.alternateGreetings ?? []).filter(filled).length,
  });
  record(
    'mvu',
    Boolean(project.mvu?.enabled) && mvuFiles.every((item) => item.filled),
    { enabled: Boolean(project.mvu?.enabled), files: mvuFiles },
    mvuFiles.some((item) => !item.filled) ? { area: project.mvu?.enabled ? mvuFiles.find((item) => !item.filled)?.key : '' } : {},
  );
  record(
    'statusbar',
    project.statusbar?.kind && project.statusbar.kind !== 'none' && filled(project.statusbar?.source),
    {
      kind: project.statusbar?.kind ?? 'none',
      requirements: filled(project.statusbar?.requirements),
      contract: filled(project.statusbar?.contract),
      source: filled(project.statusbar?.source),
    },
  );
  record(
    'frontend',
    // 前端是两份文件：运行提示词 + 消息前端 HTML。少一份都不能打包（见 lib/validate.mjs）。
    filled(project.frontend?.source) && filled(project.frontend?.previewHtml),
    {
      requirements: filled(project.frontend?.requirements),
      contract: filled(project.frontend?.contract),
      source: filled(project.frontend?.source),
      previewHtml: filled(project.frontend?.previewHtml),
    },
  );
  record('ejs', ejs.length > 0 && ejs.every((item) => item.source), { count: ejs.length, items: ejs });
  record('package', structError ? false : structIssues.every((item) => item.level !== 'error'), structError
    ? { blockers: null, error: structError }
    : { blockers: structIssues.filter((item) => item.level === 'error').length });

  // 下一步：先看作品设置是否还没填，再按创作顺序取第一个"还没完成且现在就能推进"的域。
  const prerequisite = domains.find((item) => item.domain === 'overview' && !item.complete) ?? null;
  const next = prerequisite
    ?? WORK_ORDER.map((domain) => domains.find((item) => item.domain === domain))
      .find((item) => item && !item.complete && item.task)
    ?? null;
  return { domains, next, structIssues, structError };
}

function taskName(taskId) {
  if (!taskId) return '';
  try { return readKnowledge(taskId).meta?.name ?? taskId; } catch { return taskId; }
}

function printText(project, info) {
  console.log(`作品：${project.title || '（无题）'}（${project.id ?? '无 id'}）｜阶段：${project.stage ?? 'draft'}`);
  if (filled(project.summary)) console.log(`简介：${project.summary}`);
  console.log('─'.repeat(60));
  for (const item of info.domains) {
    const mark = item.complete ? '✓' : '·';
    console.log(`${mark} ${padLabel(item.label)} ${describe(item)}`);
  }
  console.log('─'.repeat(60));
  if (info.structError) console.log(`⚠ 结构检查无法运行：${info.structError}（工程里可能有手工写残的记录；用 pack --prepare/--apply 写入的记录不会有这个问题）`);
  const pending = info.domains.filter((item) => !item.complete);
  if (!pending.length) {
    console.log('各域都已定稿。');
  } else {
    console.log('此刻只说「继续」时，各域会落到：');
    for (const item of pending) {
      console.log(`  ${item.label} → ${item.task || '（该域不出片，只能自由问答）'}${item.taskName ? `（${item.taskName}）` : ''}`);
    }
  }
  console.log('');
  if (info.next) {
    console.log(`建议下一步：${info.next.label} → ${info.next.task}（${info.next.taskName}）`);
    console.log(`  node 工具/prompt.mjs --project <作品.json> --domain ${info.next.domain}${focusArgs(info.next)} --input "……" --route-only`);
  } else {
    console.log('建议下一步：跑结构检查，然后导出角色卡。');
    console.log('  node 工具/check.mjs --project <作品.json>');
    console.log('  node 工具/pack.mjs --card --project <作品.json> --out 卡.json');
  }
  console.log('· 这是工作区现状汇总，不代表已经在酒馆运行。');
}

function focusArgs(item) {
  if (item.domain === 'character') {
    const first = item.detail?.items?.find((c) => c.gaps.length);
    if (first) return ` --focus-target ${first.id} --focus-area ${first.gaps[0].key}`;
  }
  if (item.domain === 'mvu') {
    const gap = item.detail?.files?.find((file) => !file.filled);
    if (gap) return ` --focus-area ${gap.key}`;
  }
  return '';
}

/** 中文按两列宽计算，避免"人物"与"MVU 变量"对不齐。 */
function displayWidth(text) {
  let width = 0;
  for (const char of String(text)) {
    width += /[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6]/.test(char) ? 2 : 1;
  }
  return width;
}
function padLabel(label, columns = 12) {
  return `${label}${' '.repeat(Math.max(1, columns - displayWidth(label)))}`;
}

function describe(item) {
  const d = item.detail ?? {};
  switch (item.domain) {
    case 'overview': return `标题${d.title ? '✓' : '—'} 简介${d.summary ? '✓' : '—'}`;
    case 'carddata': return d.imported ? '已导入原卡' : '未导入';
    case 'character': {
      if (!d.count) return '还没有人物';
      return d.items.map((c) => `${c.name} ${c.done}/${c.total}${c.gaps.length ? `（缺 ${c.gaps.map((g) => g.label).join('、')}）` : ''}`).join('｜');
    }
    case 'worldbook': return d.count ? d.items.map((w) => `${w.name}${w.scale ? `（${w.scale}）` : ''}${w.filled ? '' : ' 内容为空'}`).join('｜') : '还没有条目';
    case 'rules': return d.count ? `${d.count} 条` : '还没有规则';
    case 'opening': return `首条${d.first ? '✓' : '—'}｜备用 ${d.alternates} 条`;
    case 'mvu': return `${d.enabled ? '已启用' : '未启用'}｜${d.files.map((f) => `${f.label}${f.filled ? '✓' : '—'}`).join(' ')}`;
    case 'statusbar': return `${d.kind}｜需求${d.requirements ? '✓' : '—'} 合同${d.contract ? '✓' : '—'} 源码${d.source ? '✓' : '—'}`;
    case 'frontend': return `需求${d.requirements ? '✓' : '—'} 合同${d.contract ? '✓' : '—'} 运行提示词${d.source ? '✓' : '—'} HTML${d.previewHtml ? '✓' : '—'}`;
    case 'ejs': return d.count ? d.items.map((e) => `${e.name}${e.source ? '✓' : '—'}`).join('｜') : '还没有 EJS';
    case 'package': return d.error ? '结构检查跑不动（工程里有残缺记录）' : d.blockers ? `${d.blockers} 个阻断问题` : '结构检查无阻断';
    default: return '';
  }
}

function main() {
  const { flags } = parseArgs(process.argv.slice(2));
  if (flags['self-test']) return selfTest();

  if (flags.list) {
    if (!fs.existsSync(PROJECT_DIR)) { console.log('（还没有作品工程）'); return 0; }
    const files = fs.readdirSync(PROJECT_DIR).filter((name) => name.endsWith('.json'));
    if (!files.length) { console.log('（还没有作品工程）'); return 0; }
    for (const name of files) {
      const file = path.join(PROJECT_DIR, name);
      let title = '（读不出标题）';
      try { title = JSON.parse(fs.readFileSync(file, 'utf8')).title ?? title; } catch { /* 保持占位 */ }
      console.log(`${name}\t${title}`);
    }
    return 0;
  }

  if (!flags.project || flags.project === true) {
    console.error('缺少 --project <作品.json>。');
    console.error('用法：node 工具/status.mjs --project 状态/作品/卡名.json [--json] [--out 结果.json]');
    return 2;
  }
  let project;
  try { project = JSON.parse(fs.readFileSync(path.resolve(flags.project), 'utf8')); }
  catch (error) { console.error(`✗ 读不了作品工程：${error.message}`); return 2; }

  const info = inspect(project);
  if (flags.json) {
    const payload = {
      project: { id: project.id, title: project.title, stage: project.stage },
      domains: info.domains.map((item) => ({ domain: item.domain, label: item.label, complete: item.complete, task: item.task, taskName: item.taskName })),
      next: info.next ? { domain: info.next.domain, task: info.next.task, taskName: info.next.taskName } : null,
      structIssues: info.structIssues,
      structError: info.structError || null,
    };
    const text = `${JSON.stringify(payload, null, 2)}\n`;
    if (flags.out && flags.out !== true) { fs.writeFileSync(path.resolve(flags.out), text, 'utf8'); console.log(`✓ 已写出：${path.resolve(flags.out)}`); }
    else process.stdout.write(text);
    return 0;
  }
  printText(project, info);
  return 0;
}

// ── 自测 ──────────────────────────────────────────────────────────────
function selfTest() {
  // 用 new-project.mjs 的同一份空工程定义，避免自测夹具与真实工程漂移。
  const empty = () => ({ ...emptyProject('卡', { id: 'p' }), importedCard: null });
  const cases = [
    ['空作品：人物为空、建议落在作品设置或人物起点', () => {
      const info = inspect(empty());
      const character = info.domains.find((d) => d.domain === 'character');
      return character.complete === false && info.domains.length === 11 && Boolean(info.next);
    }],
    ['人物：六栏目填充计数正确', () => {
      const p = empty();
      const c = createCharacter('周梦瑶');
      c.basicInformation = 'x'; c.characterNature = 'y';
      p.characters = [c];
      const info = inspect(p);
      const item = info.domains.find((d) => d.domain === 'character').detail.items[0];
      return item.done === 2 && item.total === 6 && item.gaps.length === 4 && item.gaps[0].key === 'lifeStructure';
    }],
    ['人物：栏目补满即视为完成', () => {
      const p = empty();
      const c = createCharacter('甲');
      for (const [key] of CHAR_AREAS) c[key] = 'x';
      p.characters = [c];
      return inspect(p).domains.find((d) => d.domain === 'character').complete === true;
    }],
    ['MVU：未启用时给出结构专项而非开局值', () => {
      const info = inspect(empty());
      return info.domains.find((d) => d.domain === 'mvu').task === 'mvu_schema_compilation';
    }],
    ['MVU：只缺变化规则时指出该文件', () => {
      const p = empty();
      p.mvu = { enabled: true, initvarDesign: 'a', initvarSource: 'b', updateRuleDesign: 'c', updateRulesSource: '', schemaSource: 'd' };
      const mvu = inspect(p).domains.find((d) => d.domain === 'mvu');
      return mvu.complete === false && mvu.task === 'mvu_update_rule_formatting';
    }],
    ['状态栏：有合同无源码时完成度为假', () => {
      const p = empty();
      p.statusbar = { kind: 'vue', requirements: 'r', contract: '技术路线：单 HTML Vue', source: '' };
      const sb = inspect(p).domains.find((d) => d.domain === 'statusbar');
      return sb.complete === false && sb.task === 'mvu_statusbar_vue_build';
    }],
    ['导出：结构检查阻断数被如实带出', () => {
      const pkg = inspect(empty()).domains.find((d) => d.domain === 'package');
      return pkg.complete === false && pkg.detail.blockers > 0;
    }],
    ['域清单：11 个域且标签可读', () => {
      const info = inspect(empty());
      return info.domains.every((d) => d.label && d.label !== d.domain) && DOMAIN_LABELS.character === '人物';
    }],
    ['下一步：原卡资料（可选导入）与导出不算待办', () => {
      const p = empty();
      p.summary = '有简介';
      const c = createCharacter('甲');
      for (const [key] of CHAR_AREAS) c[key] = 'x';
      p.characters = [c];
      const wb = createWorldbookEntry(); wb.title = '设定'; wb.content = 'x'; wb.scale = 'small';
      p.worldbook = [wb];
      const rule = createRule(); rule.title = '规则'; rule.content = 'x';
      p.rules = [rule];
      // 只改字段、不整份替换嵌套对象——手写残缺对象会让 validateProject 崩掉（自测夹具的坑）。
      p.opening = { ...p.opening, firstMessage: 'x' };
      p.mvu = { ...p.mvu, enabled: true, initvarDesign: 'a', initvarSource: 'b', updateRuleDesign: 'c', updateRulesSource: 'd', schemaSource: 'e' };
      p.statusbar = { ...p.statusbar, kind: 'native', requirements: 'r', contract: 'c', source: 'x' };
      p.frontend = { ...p.frontend, requirements: 'r', contract: 'c', source: 'x', previewHtml: 'x' };
      p.ejsCharacters = [createEjsCharacter('E')].map((item) => ({ ...item, requirements: 'r', contract: 'c', source: 'x' }));
      const info = inspect(p);
      const carddata = info.domains.find((d) => d.domain === 'carddata');
      return carddata.complete === false && info.next === null && !info.structError;
    }],
    ['前端：只有运行提示词、没有 HTML 时不算完成', () => {
      const p = empty();
      p.frontend = { ...p.frontend, requirements: 'r', contract: 'c', source: 'x' };
      return inspect(p).domains.find((d) => d.domain === 'frontend').complete === false;
    }],
    ['下一步：标题或简介没填时先回到作品设置', () => {
      const p = empty();
      const info = inspect(p);
      return info.next?.domain === 'overview';
    }],
    ['焦点建议：给的是人物 id 而不是名字', () => {
      const p = empty();
      const c = createCharacter('周梦瑶');
      p.characters = [c];
      const item = inspect(p).domains.find((d) => d.domain === 'character');
      return focusArgs(item) === ` --focus-target ${c.id} --focus-area basicInformation`;
    }],
    ['汇总不因残缺记录崩掉：结构检查降级为提示', () => {
      const p = empty();
      p.summary = '有简介';
      p.characters = [{ id: 'c1', name: '半成品' }];
      const info = inspect(p);
      return Boolean(info.structError) && info.domains.find((d) => d.domain === 'package').complete === false;
    }],
  ];
  let failed = 0;
  for (const [name, run] of cases) {
    let ok = false; let detail = '';
    try { ok = run() === true; } catch (error) { detail = String(error?.message ?? error); }
    if (!ok) failed += 1;
    console.log(`${ok ? '  ✓' : '  ✗'} ${name}${detail ? `  ← ${detail}` : ''}`);
  }
  console.log(`\n${failed ? '✗' : '✓'} 现状汇总自测 ${cases.length - failed}/${cases.length} 通过`);
  return failed ? 1 : 0;
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) process.exit(main());
