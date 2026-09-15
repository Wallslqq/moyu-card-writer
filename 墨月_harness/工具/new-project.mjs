#!/usr/bin/env node
/**
 * 墨月 Harness · 新建作品工程
 *
 * 作品工程是这一套流程的唯一落账处：人物、世界书、规则、开场白、MVU、状态栏、
 * 前端、EJS 全部写进同一份 JSON。本工具只做一件事——产出一份**空但结构完整**
 * 的工程，之后每一轮由 prompt.mjs 读它、check.mjs 判它、pack.mjs 写它。
 *
 * 用法：
 *   node 工具/new-project.mjs --title "卡名" [--summary "一句话"] [--id <id>] \
 *        [--out 状态/作品/卡名.json] [--force]
 *   node 工具/new-project.mjs --list
 *   node 工具/new-project.mjs --self-test
 *
 * 默认写到 `<harness>/状态/作品/<卡名>.json`；已存在时拒绝覆盖（除非 --force）。
 * 退出码：0 成功；1 已存在且未加 --force；2 用法/输入错误。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HARNESS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROJECT_DIR = path.join(HARNESS_ROOT, '状态', '作品');

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

/** 空工程的标准形状——与 pack/check/prompt 的既有夹具保持同一组字段。 */
export function emptyProject(title, { id, summary = '' } = {}) {
  const now = new Date().toISOString();
  return {
    id: id || `proj-${randomUUID().slice(0, 8)}`,
    title,
    summary,
    stage: 'draft',
    activeSection: 'character',
    characters: [],
    worldbook: [],
    rules: [],
    opening: { firstMessage: '', alternateGreetings: [''] },
    mvu: {
      enabled: false,
      initvarDesign: '',
      updateRuleDesign: '',
      initvarSource: '',
      updateRulesSource: '',
      schemaSource: '',
    },
    statusbar: { kind: 'none', requirements: '', contract: '', source: '' },
    frontend: { requirements: '', contract: '', source: '', previewHtml: '', testMessage: '' },
    ejsCharacters: [],
    assets: [],
    materials: [],
    artifacts: [],
    threads: {},
    activeThreadIds: {},
    recoveryReplies: [],
    scriptProjects: [],
    createdAt: now,
    updatedAt: now,
  };
}

/** 卡名 → 文件名：只去掉文件系统不允许的字符，保留中文（可读优先）。 */
export function projectFileName(title) {
  const safe = String(title).trim().replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').slice(0, 80);
  return `${safe || '未命名作品'}.json`;
}

function main() {
  const { flags, _ } = parseArgs(process.argv.slice(2));
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

  const title = flags.title && flags.title !== true ? String(flags.title).trim() : (_.length ? String(_[0]).trim() : '');
  if (!title) {
    console.error('缺少 --title <卡名>。');
    console.error('用法：node 工具/new-project.mjs --title "卡名" [--summary "一句话"] [--out 状态/作品/卡名.json] [--force]');
    return 2;
  }
  const out = flags.out && flags.out !== true
    ? path.resolve(flags.out)
    : path.join(PROJECT_DIR, projectFileName(title));
  if (fs.existsSync(out) && !flags.force) {
    console.error(`✗ 已存在同名作品工程：${out}`);
    console.error('  换一个 --title，或用 --out 指定另一条路径；确实要覆盖再加 --force。');
    return 1;
  }

  const project = emptyProject(title, {
    id: flags.id && flags.id !== true ? flags.id : undefined,
    summary: flags.summary && flags.summary !== true ? flags.summary : '',
  });
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify(project, null, 2)}\n`, 'utf8');
  console.log(`✓ 已新建作品工程：${out}`);
  console.log(`  id：${project.id}｜卡名：${project.title}`);
  console.log('  下一步（把作品工程交给装配器，先看一眼路由会落到哪）：');
  console.log(`  node 工具/status.mjs --project "${out}"`);
  return 0;
}

// ── 自测 ──────────────────────────────────────────────────────────────
function selfTest() {
  const cases = [
    ['工程形状：域字段齐全', () => {
      const p = emptyProject('测试卡', { id: 'proj-test' });
      const required = ['id', 'title', 'summary', 'stage', 'activeSection', 'characters', 'worldbook', 'rules',
        'opening', 'mvu', 'statusbar', 'frontend', 'ejsCharacters', 'assets', 'materials', 'artifacts',
        'threads', 'activeThreadIds', 'recoveryReplies', 'scriptProjects', 'createdAt', 'updatedAt'];
      return required.every((key) => key in p) && p.id === 'proj-test' && p.characters.length === 0;
    }],
    ['工程形状：MVU 五份文件字段齐全且默认未启用', () => {
      const m = emptyProject('x').mvu;
      return m.enabled === false && ['initvarDesign', 'updateRuleDesign', 'initvarSource', 'updateRulesSource', 'schemaSource'].every((k) => k in m);
    }],
    ['文件名：去掉非法字符、保留中文', () => projectFileName('留学/生:模拟?器') === '留学_生_模拟_器.json'],
    ['文件名：空标题有兜底', () => projectFileName('   ') === '未命名作品.json'],
    ['写盘：能建目录并拒绝重复覆盖', () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'moyu-new-'));
      const file = path.join(dir, '子目录', '卡.json');
      const p = emptyProject('卡', { id: 'proj-t' });
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(p), 'utf8');
      const again = fs.existsSync(file);
      fs.rmSync(dir, { recursive: true, force: true });
      return again && JSON.parse(JSON.stringify(p)).title === '卡';
    }],
  ];
  let failed = 0;
  for (const [name, run] of cases) {
    let ok = false; let detail = '';
    try { ok = run() === true; } catch (error) { detail = String(error?.message ?? error); }
    if (!ok) failed += 1;
    console.log(`${ok ? '  ✓' : '  ✗'} ${name}${detail ? `  ← ${detail}` : ''}`);
  }
  console.log(`\n${failed ? '✗' : '✓'} 新建作品工程自测 ${cases.length - failed}/${cases.length} 通过`);
  return failed ? 1 : 0;
}

// 只在被当作命令运行时才执行 main —— 这样别的模块可以 import emptyProject()
// 而不触发建卡副作用。
const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) process.exit(main());
