#!/usr/bin/env node
/**
 * 墨月 Harness · 卡片档案（开卡的事实源 + 进程状态）
 *
 * 为什么需要它：墨月网页版靠三栏 UI 记住"当前页面／当前页签"，DSH 没有 UI。
 * 缺这一层时 agent 只能凭对话记忆推进，表现为漏条目、跳步骤、反复纠结归类
 * （2026-09-15 实测踩到）。本工具把规划与进度写进磁盘，让 agent 每轮核对文件。
 *
 * 两层：
 *   · `_规划.md` —— 项目级事实源（这张卡要长什么样）。**改正文前先改它。**
 *   · `_进度.md` —— 进程状态（做到哪、下一步）。带机器可读标记。
 *
 * 硬闸：**规划未确认时，拒绝推进任何正文条目**（`--mark`／`--worldbook` 会报错）。
 * 硬闸：**对应文件不存在或为空时，拒绝标记完成**（没落盘 ≠ 完成）。
 *
 * 用法：
 *   node 工具/material.mjs --init --card "卡名" [--force] [--card-root <路径>]
 *   node 工具/material.mjs --plan --card "卡名" --mode rough|full [--confirmed] [--refinements N]
 *   node 工具/material.mjs --stat --card "卡名"
 *   node 工具/material.mjs --mark --card "卡名" --item "人物名" --area <栏位id> [--action done|skip|undo]
 *   node 工具/material.mjs --blueprint --card "卡名" [--undo]
 *   node 工具/material.mjs --worldbook --card "卡名" --entry "条目名" [--done] [--blueprint-confirmed]
 *   node 工具/material.mjs --module --card "卡名" --key <模块key> [--undo]
 *   node 工具/material.mjs --probe
 *   node 工具/material.mjs --self-test
 *
 * 退出码：0 正常；1 运行错误（含硬闸拒绝）；2 用法/输入错误。
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  ALIGN_MODES, AREA_DONE, AREA_SKIPPED, AREA_TODO, CHARACTER_AREAS, HARNESS_ROOT, MODULES,
  PROJECT_DIR, areaFile, cardDir, cardRoot, countRefinements, initCard, isCharacterSettled,
  markArea, markModule, planningFile, progressFile, readState, renderNextActions, renderProgress,
  setBlueprint, setCardRoot, setPlanning, upsertWorldbook, worldbookFile,
} from './lib/cardfile.mjs';
import { auditText } from './lib/prose-audit.mjs';

/**
 * 写作质量粗筛（只读、机械）。
 *
 * 只抓可机械识别的表面特征，提醒人去细看；**不判断内容好坏**。
 * 判据见 `知识库/核心/_写作质量自检.md`。真正的判定由审稿子代理或作者做。
 */
export function qualityHints(state) {
  const candidates = [];
  for (const [name, item] of Object.entries(state.modules.character.items ?? {})) {
    for (const area of CHARACTER_AREAS) {
      if (item.areas[area.id] !== AREA_DONE) continue;
      candidates.push({ file: areaFile(state.title, name, area.id), where: `${name} · ${area.label}` });
    }
  }
  for (const entry of Object.keys(state.modules.worldbook.items ?? {})) {
    if (!state.modules.worldbook.items[entry].done) continue;
    candidates.push({ file: worldbookFile(state.title, entry), where: `世界书 · ${entry}` });
  }
  const hits = [];
  for (const candidate of candidates) {
    if (!fs.existsSync(candidate.file)) continue;
    const findings = auditText(fs.readFileSync(candidate.file, 'utf8'));
    if (findings.length) hits.push({ ...candidate, findings });
  }
  return { scanned: candidates.length, hits };
}

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

/**
 * 写盘诊断：遇拒时先跑这个，**不要升级沙箱权限**。
 *
 * DSH 在 Windows 用受限令牌 + 工作区 ACL 限制子进程写入
 * （见 @deepseek-ai/dsh-sandbox-windows-acl）。一旦某路径被拒，
 * 最可能是**目标落在沙箱边界外**，而不是文件权限不够。
 */
export function probeWritability({ cardOnly = false } = {}) {
  const targets = cardOnly
    ? [['档案根', cardRoot()]]
    : [
      ['档案根', cardRoot()],
      ['harness 根', HARNESS_ROOT],
      ['作品工程目录', PROJECT_DIR],
      ['请求目录', path.join(HARNESS_ROOT, '状态', '请求')],
      ['稿件目录', path.join(HARNESS_ROOT, '状态', '稿件')],
      ['待确认区', path.join(HARNESS_ROOT, '状态', '待确认')],
    ];

  const results = targets.map(([label, dir]) => {
    // 只读诊断**不许有副作用**：目录不存在就往下找到第一个已存在的祖先来探测。
    const exists = fs.existsSync(dir);
    let probeBase = dir;
    while (!fs.existsSync(probeBase)) {
      const parent = path.dirname(probeBase);
      if (parent === probeBase) break;
      probeBase = parent;
    }
    const probe = path.join(probeBase, `_写盘探测-${process.pid}`);
    let ok = false;
    let error = '';
    try {
      fs.mkdirSync(probe, { recursive: true });
      fs.writeFileSync(path.join(probe, 'x.txt'), 'ok', 'utf8');
      ok = true;
    } catch (caught) {
      error = `${caught?.code ?? ''} ${caught?.message ?? caught}`.trim();
    } finally {
      try { fs.rmSync(probe, { recursive: true, force: true }); } catch { /* 清不掉不算失败 */ }
    }
    return { label, dir, exists, probeBase, ok, error };
  });

  console.log('写盘诊断（遇拒时跑这个，不要升级沙箱权限）');
  console.log('');
  for (const row of results) {
    const note = row.exists ? '' : `（目录尚不存在，改在 ${row.probeBase} 里探测）`;
    console.log(`${row.ok ? '✓ 可写' : '✗ 被拒'}  ${row.label}${note}`);
    console.log(`        ${row.dir}`);
    if (!row.ok) console.log(`        原因：${row.error}`);
  }
  console.log('');

  const failed = results.filter((row) => !row.ok);
  if (!failed.length) {
    console.log('全部可写。若工具仍报错，把完整报错原文交给驾驶员，不要升级权限。');
    return 0;
  }
  const cardRow = results.find((row) => row.label === '档案根');
  const cwdInWorkspace = cardRow && cardRow.dir.toLowerCase().startsWith(process.cwd().toLowerCase());
  if (cardRow && !cardRow.ok && cwdInWorkspace) {
    console.log('★ 定性：**路径正确，但本次会话的 pwsh 子进程拿不到工作区写授权。**');
    console.log('  档案根就在当前工作区之内，却被拒 —— 这不是路径问题，也不是文件权限问题。');
    console.log('  最常见原因：**本工作区在本次会话开始之后被整体重建过**。');
    console.log('  工作区写授权按会话启动时的路径实体化，目录被删掉重建后旧授权即失效。');
    console.log('');
    console.log('  **唯一正确处置：请作者换一个新会话重试。**');
    console.log('  不要升级沙箱权限，不要换目录硬写，也不要改动这些工具。');
    return 1;
  }
  console.log('有路径被拒。**先按顺序排查，不要升级沙箱权限：**');
  console.log('  1. 被拒的路径是否落在会话工作区之内？边界外的写入本就该被拒。');
  console.log('  2. 若用了 --card-root 或环境变量，去掉它，让工具按自身位置推导。');
  console.log('  3. 工作区是否在本次会话开始后才被整体重建过？→ 换一个新会话再试。');
  console.log('  4. 以上都不是，把本诊断的完整输出交给驾驶员。');
  return 1;
}

/**
 * 渲染粗筛结果。**刻意写明"这不判内容好坏"**——抽象词有没有作者含义只有读上下文才知道。
 */
export function renderQualityHints(state) {
  const { scanned, hits } = qualityHints(state);
  const lines = ['## 写作质量粗筛（只读 · 判据见 `知识库/核心/_写作质量自检.md`）', ''];
  if (!scanned) {
    lines.push('（还没有已落盘的栏位／条目，无需粗筛）');
    lines.push('');
    return lines.join('\n');
  }
  if (!hits.length) {
    lines.push(`已扫 ${scanned} 份档案，未发现表面特征。`);
    lines.push('');
    lines.push('> 这只是机械粗筛。**抽象词有没有作者含义、活人感够不够，仍需审稿子代理或作者判断。**');
    lines.push('');
    return lines.join('\n');
  }
  lines.push('| 档案 | 级别 | 类型 | 次数 | 示例 |');
  lines.push('|---|---|---|---|---|');
  for (const item of hits) {
    for (const finding of item.findings) {
      lines.push(`| ${item.where} | ${finding.level} | ${finding.label} | ${finding.count} | ${finding.samples.join('、')} |`);
    }
  }
  lines.push('');
  lines.push('> **违规**需处理；**疑似**只是提醒（作者刻意的用法可保留）。粗筛不判内容好坏。');
  lines.push('');
  return lines.join('\n');
}

function usage() {
  console.error('用法：');
  console.error('  node 工具/material.mjs --self-test');
  console.error('  node 工具/material.mjs --probe                    # 写盘诊断（遇拒时先跑）');
  console.error('  node 工具/material.mjs --init  --card "卡名" [--force] [--card-root <路径>]');
  console.error('  node 工具/material.mjs --plan  --card "卡名" --mode rough|full [--confirmed] [--refinements N]');
  console.error('  node 工具/material.mjs --stat  --card "卡名"          # 进程状态 + 写作质量粗筛');
  console.error('  node 工具/material.mjs --audit --card "卡名"          # 只跑写作质量粗筛');
  console.error('  node 工具/material.mjs --mark  --card "卡名" --item "人物名" --area <栏位id> [--action done|skip|undo]');
  console.error('  node 工具/material.mjs --blueprint --card "卡名" [--undo]');
  console.error('  node 工具/material.mjs --worldbook --card "卡名" --entry "条目名" [--done] [--blueprint-confirmed]');
  console.error('  node 工具/material.mjs --module --card "卡名" --key <模块key> [--undo]');
  console.error('');
  console.error('  档案根默认从工具自身位置推导（= 仓库根），不依赖 cwd；');
  console.error('  需要指到别处时用 --card-root，或设环境变量 MOYU_CARD_ROOT。');
}

export function main() {
  const { flags } = parseArgs(process.argv.slice(2));
  if (flags['self-test']) return selfTest();
  if (typeof flags['card-root'] === 'string') setCardRoot(flags['card-root']);
  if (flags.probe) return probeWritability();

  const title = typeof flags.card === 'string' ? flags.card : undefined;
  if (!title) { usage(); return 2; }

  try {
    if (flags.init) {
      const state = initCard(title, { force: Boolean(flags.force) });
      console.log(`✓ 已建立卡片档案：${cardDir(title)}`);
      console.log('');
      console.log(renderNextActions(state).join('\n'));
      return 0;
    }
    if (flags.plan) {
      const plan = setPlanning(title, {
        mode: typeof flags.mode === 'string' ? flags.mode : undefined,
        confirmed: flags.confirmed === undefined ? undefined : true,
        refinements: typeof flags.refinements === 'string' ? flags.refinements : undefined,
      });
      console.log(`✓ 规划：模式=${ALIGN_MODES[plan.mode]?.label ?? plan.mode}　定稿=${plan.confirmed ? '已确认' : '未确认'}`);
      if (!plan.confirmed) console.log('  提醒：规划未确认前不能写正文条目。');
      return 0;
    }
    if (flags.stat) {
      const state = readState(title);
      if (!state) { console.error(`✗ 找不到卡片档案：${cardDir(title)}`); return 1; }
      console.log(renderProgress(state));
      console.log(renderQualityHints(state));
      return 0;
    }
    if (flags.audit) {
      const state = readState(title);
      if (!state) { console.error(`✗ 找不到卡片档案：${cardDir(title)}`); return 1; }
      console.log(renderQualityHints(state));
      return 0;
    }
    if (flags.mark) {
      const item = typeof flags.item === 'string' ? flags.item : undefined;
      const area = typeof flags.area === 'string' ? flags.area : undefined;
      if (!item || !area) { usage(); return 2; }
      const action = flags.action === 'skip' ? 'skip' : flags.action === 'undo' ? 'undo' : 'done';
      const { area: hit } = markArea(title, item, area, action);
      const verb = action === 'skip' ? '标为作者确认无需' : action === 'undo' ? '退回待定' : '已记入档案';
      console.log(`✓ ${item} · ${hit.label} ${verb}`);
      return 0;
    }
    if (flags.blueprint) {
      const wb = setBlueprint(title, !flags.undo);
      console.log(`✓ 世界书蓝图：${wb.blueprintConfirmed ? '已确认' : '未确认'}`);
      return 0;
    }
    if (flags.worldbook) {
      const entry = typeof flags.entry === 'string' ? flags.entry : undefined;
      if (!entry) { usage(); return 2; }
      upsertWorldbook(title, entry, {
        done: Boolean(flags.done),
        blueprintConfirmed: flags['blueprint-confirmed'] ? true : undefined,
      });
      console.log(`✓ 世界书条目已登记：${entry}`);
      return 0;
    }
    if (flags.module) {
      const key = typeof flags.key === 'string' ? flags.key : undefined;
      if (!key) { usage(); return 2; }
      markModule(title, key, !flags.undo);
      console.log(`✓ 模块 ${key} 标记为${flags.undo ? '未完成' : '已完成'}`);
      return 0;
    }
    usage();
    return 2;
  } catch (error) {
    console.error(`✗ ${error?.message ?? error}`);
    return 1;
  }
}

// ── 自测 ─────────────────────────────────────────────────────────────
export function selfTest() {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'moyu-cardfile-'));
  const previous = cardRoot();
  setCardRoot(sandbox);

  const tmp = () => `自测卡-${crypto.randomUUID().slice(0, 8)}`;
  const cases = [
    ['建卡：生成 _规划.md / _进度.md / README / 八个模块目录 / 导出', () => {
      const title = tmp();
      try {
        const state = initCard(title);
        const dir = cardDir(title);
        return fs.existsSync(planningFile(title))
          && fs.existsSync(progressFile(title))
          && fs.existsSync(path.join(dir, 'README.md'))
          && fs.existsSync(path.join(dir, '导出'))
          && MODULES.every((m) => fs.existsSync(path.join(dir, m.dir)))
          && state.planning.mode === 'unset';
      } finally { fs.rmSync(cardDir(title), { recursive: true, force: true }); }
    }],
    ['硬闸：规划未确认时拒绝写正文', () => {
      const title = tmp();
      try {
        initCard(title);
        let refused = false;
        try { markArea(title, '男主', 'basicInformation', 'done'); } catch { refused = true; }
        return refused;
      } finally { fs.rmSync(cardDir(title), { recursive: true, force: true }); }
    }],
    ['硬闸：确认规划后放行', () => {
      const title = tmp();
      try {
        initCard(title);
        setPlanning(title, { mode: 'rough', confirmed: true });
        const file = areaFile(title, '男主', 'basicInformation');
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, '他二十岁。', 'utf8');
        markArea(title, '男主', 'basicInformation', 'done');
        return readState(title).modules.character.items['男主'].areas.basicInformation === AREA_DONE;
      } finally { fs.rmSync(cardDir(title), { recursive: true, force: true }); }
    }],
    ['硬闸：文件不存在或为空时拒绝标记完成', () => {
      const title = tmp();
      try {
        initCard(title);
        setPlanning(title, { mode: 'full', confirmed: true });
        let refusedMissing = false;
        try { markArea(title, '男主', 'basicInformation', 'done'); } catch { refusedMissing = true; }
        const file = areaFile(title, '男主', 'basicInformation');
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, '   \n', 'utf8');
        let refusedEmpty = false;
        try { markArea(title, '男主', 'basicInformation', 'done'); } catch { refusedEmpty = true; }
        return refusedMissing && refusedEmpty;
      } finally { fs.rmSync(cardDir(title), { recursive: true, force: true }); }
    }],
    ['栏位：可标"作者确认无需"，但必填不可', () => {
      const title = tmp();
      try {
        initCard(title);
        setPlanning(title, { mode: 'rough', confirmed: true });
        markArea(title, '男主', 'clothingStyle', 'skip');
        const ok = readState(title).modules.character.items['男主'].areas.clothingStyle === AREA_SKIPPED;
        let refused = false;
        try { markArea(title, '男主', 'basicInformation', 'skip'); } catch { refused = true; }
        return ok && refused;
      } finally { fs.rmSync(cardDir(title), { recursive: true, force: true }); }
    }],
    ['栏位：五栏全闭合才算该人物完成', () => {
      const title = tmp();
      try {
        initCard(title);
        setPlanning(title, { mode: 'rough', confirmed: true });
        const file = areaFile(title, '男主', 'basicInformation');
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, '内容。', 'utf8');
        markArea(title, '男主', 'basicInformation', 'done');
        const before = isCharacterSettled(readState(title).modules.character.items['男主'].areas);
        for (const area of CHARACTER_AREAS.slice(1)) markArea(title, '男主', area.id, 'skip');
        const after = isCharacterSettled(readState(title).modules.character.items['男主'].areas);
        return before === false && after === true;
      } finally { fs.rmSync(cardDir(title), { recursive: true, force: true }); }
    }],
    ['文件命名：与知识库顺序一致（零补齐）', () => {
      const title = '自测卡-顺序';
      return CHARACTER_AREAS.map((a) => path.basename(areaFile(title, '男主', a.id))).join('|')
        === '01 基础信息.md|02 穿衣风格.md|03 生活结构.md|04 人物性情.md|05 场景表达.md';
    }],
    ['规划：对齐模式可设，非法值被拒', () => {
      const title = tmp();
      try {
        initCard(title);
        setPlanning(title, { mode: 'rough' });
        const ok = readState(title).planning.mode === 'rough';
        let refused = false;
        try { setPlanning(title, { mode: '瞎写' }); } catch { refused = true; }
        return ok && refused;
      } finally { fs.rmSync(cardDir(title), { recursive: true, force: true }); }
    }],
    ['规划：进度表里能看到规划状态与待细化处数', () => {
      const title = tmp();
      try {
        const state = initCard(title);
        const text = renderProgress(state);
        return text.includes('对齐模式') && text.includes('待细化') && text.includes('_规划.md');
      } finally { fs.rmSync(cardDir(title), { recursive: true, force: true }); }
    }],
    ['世界书：条目登记与蓝图确认', () => {
      const title = tmp();
      try {
        initCard(title);
        setPlanning(title, { mode: 'full', confirmed: true });
        upsertWorldbook(title, '家', { done: false });
        upsertWorldbook(title, '游泳池', { done: true, blueprintConfirmed: true });
        const wb = readState(title).modules.worldbook;
        return wb.blueprintConfirmed && Object.keys(wb.items).length === 2
          && wb.items['家'].done === false && wb.items['游泳池'].done === true;
      } finally { fs.rmSync(cardDir(title), { recursive: true, force: true }); }
    }],
    ['模块：可标记完成与撤销', () => {
      const title = tmp();
      try {
        initCard(title);
        setPlanning(title, { mode: 'rough', confirmed: true }); // 模块标记也受规划硬闸约束（C3）
        markModule(title, 'rules', true);
        const on = readState(title).modules.rules.done === true;
        markModule(title, 'rules', false);
        const off = readState(title).modules.rules.done === false;
        return on && off;
      } finally { fs.rmSync(cardDir(title), { recursive: true, force: true }); }
    }],
    ['硬闸：规划未确认时拒绝标记模块完成（C3）', () => {
      const title = tmp();
      try {
        initCard(title);
        let refused = false;
        try { markModule(title, 'rules', true); } catch { refused = true; }
        return refused;
      } finally { fs.rmSync(cardDir(title), { recursive: true, force: true }); }
    }],
    ['栏位：可撤销（done/skip 都能退回待定）（A2）', () => {
      const title = tmp();
      try {
        initCard(title);
        setPlanning(title, { mode: 'rough', confirmed: true });
        markArea(title, '男主', 'clothingStyle', 'skip');
        const skipped = readState(title).modules.character.items['男主'].areas.clothingStyle === AREA_SKIPPED;
        markArea(title, '男主', 'clothingStyle', 'undo');
        const undone = readState(title).modules.character.items['男主'].areas.clothingStyle === AREA_TODO;
        return skipped && undone;
      } finally { fs.rmSync(cardDir(title), { recursive: true, force: true }); }
    }],
    ['蓝图：可单独确认，不受后续条目登记干扰（A3）', () => {
      const title = tmp();
      try {
        initCard(title);
        setPlanning(title, { mode: 'full', confirmed: true });
        setBlueprint(title, true);
        const on = readState(title).modules.worldbook.blueprintConfirmed === true;
        upsertWorldbook(title, '家', { done: false }); // 不带 blueprintConfirmed
        const stillOn = readState(title).modules.worldbook.blueprintConfirmed === true;
        setBlueprint(title, false);
        const off = readState(title).modules.worldbook.blueprintConfirmed === false;
        return on && stillOn && off;
      } finally { fs.rmSync(cardDir(title), { recursive: true, force: true }); }
    }],
    ['待细化计数：只认行首／列表项标记，说明行不算（A7）', () => {
      const title = tmp();
      try {
        initCard(title);
        const file = planningFile(title);
        fs.writeFileSync(file, [
          '# 规划',
          '',
          '> 说明：未定项写 [待细化]；本行提到它但不算数。',
          '- [待细化]',
          '- 规模判断：[待细化]',
          '- 真标记三 [待细化]',
          '纯行内出现 [待细化] 前面是汉字，不算。',
          '',
        ].join('\n'), 'utf8');
        // 行首 1 处 + 列表项 2 处 = 3；说明行与行内出现的不算。
        return countRefinements(title) === 3;
      } finally { fs.rmSync(cardDir(title), { recursive: true, force: true }); }
    }],
    ['引导：规划未定时先让 agent 问对齐模式', () => {
      const title = tmp();
      try {
        const actions = renderNextActions(initCard(title)).join('\n');
        return actions.includes('对齐模式') && !actions.includes('人物模块还没开始');
      } finally { fs.rmSync(cardDir(title), { recursive: true, force: true }); }
    }],
    ['引导：规划确认后才提示人物模块', () => {
      const title = tmp();
      try {
        initCard(title);
        setPlanning(title, { mode: 'rough', confirmed: true });
        const actions = renderNextActions(readState(title)).join('\n');
        return actions.includes('总体名单') && actions.includes('审阅');
      } finally { fs.rmSync(cardDir(title), { recursive: true, force: true }); }
    }],
    ['档案根：默认落在仓库根，且不依赖 cwd', () => {
      const cwd = process.cwd();
      const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'moyu-cwd-'));
      setCardRoot(undefined); // 清除覆盖，回到按工具位置推导
      try {
        process.chdir(elsewhere);
        return cardRoot() === path.resolve(HARNESS_ROOT, '..', 'card');
      } finally {
        process.chdir(cwd);
        setCardRoot(sandbox);
        fs.rmSync(elsewhere, { recursive: true, force: true });
      }
    }],
    ['诊断：--probe 不创建不存在的目录（只读无副作用）', () => {
      const ghost = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'moyu-probe-')), '还没建的卡');
      setCardRoot(ghost);
      try {
        probeWritability({ cardOnly: true });
        return !fs.existsSync(ghost);
      } finally {
        setCardRoot(sandbox);
        fs.rmSync(path.dirname(ghost), { recursive: true, force: true });
      }
    }],
  ];

  let failed = 0;
  for (const [name, run] of cases) {
    let ok = false; let detail = '';
    try { ok = run() === true; } catch (error) { detail = String(error?.message ?? error); }
    if (!ok) failed += 1;
    console.log(`${ok ? '  ✓' : '  ✗'} ${name}${detail ? `  ← ${detail}` : ''}`);
  }

  setCardRoot(previous);
  fs.rmSync(sandbox, { recursive: true, force: true });
  console.log(`\n${failed ? '✗' : '✓'} 卡片档案自测 ${cases.length - failed}/${cases.length} 通过`);
  return failed ? 1 : 0;
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) process.exit(main());
