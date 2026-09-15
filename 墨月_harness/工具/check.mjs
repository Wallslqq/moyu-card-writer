#!/usr/bin/env node
/**
 * 墨月 Harness · 确定性校验器
 *
 * 这是"模型之外的第二个裁判"。成品必须先过它，才能进入待确认区。
 *
 * 用法：
 *   node 工具/check.mjs frontend_build --file 待确认.md [--contract 合同.md] [--project 状态/作品.json]
 *   node 工具/check.mjs --workspace --project 状态/作品.json [--domain mvu] [--focus-area 栏目]
 *   node 工具/check.mjs --project 状态/作品.json          # 作品结构检查（validateProject）
 *   node 工具/check.mjs --self-test
 *
 * 任一条都可加 `--json [--out 结果.json]` 输出机器可读结果；
 * 维修轮直接拿这份结果喂 `prompt.mjs --repair 结果.json`。
 *
 * 退出码：0 = 可通过；1 = 有阻止写入的问题；2 = 用法/输入错误。
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { reviewArtifactContent, workspaceArtifactReview } from './lib/review.mjs';
import { formatArtifactDiagnostics, formatArtifactIssues } from './lib/diagnostics.mjs';
import { mvuSchemaIssues, checkMvuFiles } from './lib/mvu.mjs';
import { statusbarArtifactIssues, frontendArtifactIssues } from './lib/html.mjs';
import { ejsArtifactIssues } from './lib/ejs.mjs';
import { singleArtifactSource } from './lib/fences.mjs';

const CODE_DOMAINS = new Set(['mvu', 'statusbar', 'frontend', 'ejs']);

// ── CLI ───────────────────────────────────────────────────────────────
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

function readIf(file) {
  if (!file || file === true) return '';
  return fs.readFileSync(path.resolve(file), 'utf8');
}

function loadProject(file) {
  if (!file || file === true) return { mvu: { schemaSource: '', initvarSource: '', updateRulesSource: '' }, statusbar: { kind: 'none', source: '' }, frontend: { source: '', previewHtml: '', contract: '' }, ejsCharacters: [] };
  return JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
}

// ── 机器可读输出：供维修轮（prompt.mjs --repair）与自动编排消费 ─────────
// 写成文件而不是靠 shell 重定向，是因为 PowerShell 的 `>` 默认编码不是 UTF-8。
let jsonMode = false;
let jsonOutPath = '';
function emitJson(payload) {
  const text = `${JSON.stringify(payload, null, 2)}\n`;
  if (jsonOutPath) fs.writeFileSync(path.resolve(jsonOutPath), text, 'utf8');
  else process.stdout.write(text);
}

function report(review, { label = '成品', taskId = '' } = {}) {
  const errors = review.diagnostics.filter((item) => item.severity === 'error');
  if (jsonMode) {
    emitJson({ command: 'artifact', taskId, ok: errors.length === 0, diagnostics: review.diagnostics, content: review.content });
    return errors.length ? 1 : 0;
  }
  const repairs = review.diagnostics.filter((item) => item.severity === 'repair');
  const warnings = review.diagnostics.filter((item) => item.severity === 'warning');

  for (const item of repairs) console.log(`· [本地已修] ${item.title}：${item.fix}`);
  for (const item of warnings) console.log(`· [提醒] ${item.title}：${item.detail}`);
  if (errors.length) {
    console.log(`\n✗ ${label}未通过本地校验\n`);
    console.log(formatArtifactDiagnostics(review.diagnostics));
    return 1;
  }
  console.log(`\n✓ ${label}通过本地校验${repairs.length ? `（网页本地补全 ${repairs.length} 处外层结构）` : ''}`);
  return 0;
}

/** 等价于墨月 checkCurrentWorkspace()。 */
function checkWorkspace(project, domain, focus) {
  if (!CODE_DOMAINS.has(domain)) return undefined;
  const checked = [];
  const issues = [];
  const limitations = ['只检查本轮锁定的当前页面文件；未在 SillyTavern 中执行。'];

  if (domain === 'mvu') {
    const area = focus.area ?? '';
    if (area === 'crossCheck') {
      const result = checkMvuFiles(project.mvu, true);
      checked.push(...result.checked); issues.push(...result.issues);
      limitations.splice(0, limitations.length, ...result.limitations);
    } else if ((project.mvu.schemaSource ?? '').trim()) {
      checked.push('变量结构脚本');
      issues.push(...mvuSchemaIssues(project.mvu.schemaSource));
    }
    if (area === 'initvarSource' || area === 'updateRulesSource') {
      const isInit = area === 'initvarSource';
      const source = isInit ? project.mvu.initvarSource : project.mvu.updateRulesSource;
      checked.push(isInit ? '开局值文件' : '变化规则文件');
      if (!source.trim()) issues.push(`${checked.at(-1)}为空`);
      else {
        const review = workspaceArtifactReview(project, isInit ? 'mvu_initvar_formatting' : 'mvu_update_rule_formatting', source);
        issues.push(...review.diagnostics.filter((item) => item.severity === 'error').map((item) => item.detail));
      }
    }
  } else if (domain === 'statusbar') {
    checked.push('状态栏文件');
    if (!(project.statusbar.source ?? '').trim()) issues.push('状态栏文件为空');
    else issues.push(...statusbarArtifactIssues(project.statusbar.source, project.statusbar.kind));
    if (project.statusbar.kind !== 'none' && (!project.mvu.initvarSource.trim() || !project.mvu.updateRulesSource.trim() || !project.mvu.schemaSource.trim())) {
      issues.push('状态栏依赖的 MVU 三份文件尚未齐全');
    }
  } else if (domain === 'frontend') {
    checked.push('运行提示词', '消息前端 HTML');
    if (!(project.frontend.source ?? '').trim()) issues.push('运行提示词为空');
    if (!(project.frontend.previewHtml ?? '').trim()) issues.push('消息前端 HTML 为空');
    if (!issues.length) issues.push(...frontendArtifactIssues(project.frontend.source, project.frontend.previewHtml, project.frontend.contract ?? ''));
  } else if (domain === 'ejs') {
    const current = (project.ejsCharacters ?? []).find((item) => item.id === focus.targetId) ?? (project.ejsCharacters ?? [])[0];
    checked.push('当前 EJS 工件');
    if (!current) issues.push('尚未选中 EJS 工件');
    else if (!current.source.trim()) issues.push('当前 EJS 工件为空');
    else issues.push(...ejsArtifactIssues(current.source));
  }
  return { domain, checked, issues: [...new Set(issues)], limitations };
}

// ── 自测夹具 ──────────────────────────────────────────────────────────
const F = (lang, body) => '```' + lang + '\n' + body + '\n```';

const WORLDVIEW_OK = [
  F('text', '<世界名称_世界设定>\n这是一段足以独立理解的世界观正文。\n</世界名称_世界设定>'),
  F('yaml', [
    '对应标签: <世界名称_世界设定>', '条目名称: 世界名称_世界设定', '启用: true', '激活策略: 蓝灯',
    '关键词: 无', '扫描深度: 不适用', '插入位置: 角色定义前', 'order: 1', '角色: 不适用',
    'depth: 不适用', '激活概率: 100', '递归:', '  不可被其他条目激活: true', '  不可激活其他条目: true',
    '黏性: 无', '冷却: 无', '延迟: 无',
  ].join('\n')),
].join('\n\n');

const SCHEMA_OK = [
  "import { registerMvuSchema } from 'https://testingcf.jsdelivr.net/gh/StageDog/tavern_resource/dist/util/mvu_zod.js';",
  '',
  'export const Schema = z.object({',
  '  主角: z.object({ 金币: z.coerce.number(), 存活: z.boolean() }),',
  '});',
  '',
  "$(() => { registerMvuSchema(Schema); });",
].join('\n');

const INITVAR_OK = F('yaml', ['主角:', '  金币: 0', '  存活: true'].join('\n'));

const RULES_OK = F('yaml', [
  '---', '变量更新规则:', '  主角:', '    金币:', '      check: 当剧情中发生金钱交易时', '      type: number',
].join('\n'));

const STATUSBAR_OK = [
  '<!doctype html>', '<html>', '<head><meta charset="utf-8"></head>', '<body>', '<div id="app"></div>',
  '<script>',
  "waitGlobalInitialized('Mvu').then(() => { const d = Mvu.getMvuData({ type: 'message' }); document.getElementById('app').textContent = String(d); });",
  '</script>', '</body>', '</html>',
].join('\n');

const FRONTEND_CONTRACT = ['唯一外层标签：`moyu_ui`', '本地交互：点击展开详情'].join('\n');
const FRONTEND_TEXT = F('text', '<moyu_ui>\n按合同输出原始正文\n</moyu_ui>');
const FRONTEND_HTML = [
  '<!doctype html>', '<html>', '<head><meta charset="utf-8"></head>', '<body>', '<div id="root"></div>',
  '<button type="button">展开</button>',
  '<script>',
  "const id = getCurrentMessageId();",
  "const raw = getChatMessages(id)[0]?.message ?? '';",
  "const box = document.createElement('div');",
  "box.textContent = raw.includes('<moyu_ui>') ? raw : '无';",
  "document.getElementById('root').replaceChildren(box);",
  '</script>', '</body>', '</html>',
].join('\n');

const EJS_OK = F('ejs', "<% if (getvar('stat_data.主角.存活')) { %>\n她还活着。\n<% } %>");

const EMPTY_PROJECT = {
  mvu: { schemaSource: '', initvarSource: '', updateRulesSource: '' },
  statusbar: { kind: 'none', source: '', requirements: '', contract: '' },
  frontend: { source: '', previewHtml: '', contract: '' },
  ejsCharacters: [],
};

function errors(taskId, content, contract = '', project = EMPTY_PROJECT) {
  return workspaceArtifactReview(project, taskId, content, contract).diagnostics
    .filter((item) => item.severity === 'error').map((item) => item.detail);
}
function repairs(taskId, content, contract = '') {
  return reviewArtifactContent(taskId, content, contract).diagnostics
    .filter((item) => item.severity === 'repair').map((item) => item.title);
}
function projectWith(overrides) {
  return { ...EMPTY_PROJECT, ...overrides, mvu: { ...EMPTY_PROJECT.mvu, ...(overrides.mvu ?? {}) } };
}

const CASES = [
  // 世界书
  ['世界书：合法小型世界观通过', () => errors('worldview_small', WORLDVIEW_OK).length === 0],
  ['世界书：缺激活策略被拦', () => errors('worldview_small', WORLDVIEW_OK.replace('激活策略: 蓝灯\n', '')).some((m) => /激活策略/.test(m))],
  ['世界书：小型出现两条被判错', () => errors('worldview_small', WORLDVIEW_OK + '\n\n' + WORLDVIEW_OK).some((m) => /小型世界观只能建立一个/.test(m))],
  ['世界书：缺配对配置被拦', () => errors('worldview_small', F('text', '<甲_设定>\n正文\n</甲_设定>')).some((m) => /配对的 YAML 配置/.test(m))],
  // 规则
  ['规则：指定深度缺 depth 被拦', () => errors('creation_rules', WORLDVIEW_OK.replace('条目名称: 世界名称_世界设定', '条目名称: 创作规则_甲').replace('插入位置: 角色定义前', '插入位置: 指定深度').replace('depth: 不适用', '')).some((m) => /depth/.test(m))],
  // MVU
  ['MVU：合法结构脚本通过', () => errors('mvu_schema_compilation', F('javascript', SCHEMA_OK)).length === 0],
  ['MVU：缺 registerMvuSchema 被拦', () => errors('mvu_schema_compilation', F('javascript', SCHEMA_OK.replace('$(() => { registerMvuSchema(Schema); });', ''))).some((m) => /registerMvuSchema/.test(m))],
  ['MVU：导入 zod 被拦', () => errors('mvu_schema_compilation', F('javascript', "import { z } from 'zod';\n" + SCHEMA_OK)).some((m) => /不应导入 zod/.test(m))],
  ['MVU：coerce.boolean 被拦', () => errors('mvu_schema_compilation', F('javascript', SCHEMA_OK.replace('z.boolean()', 'z.coerce.boolean()'))).some((m) => /coerce\.boolean/.test(m))],
  ['MVU：passthrough 被拦', () => errors('mvu_schema_compilation', F('javascript', SCHEMA_OK.replace('});', '}).passthrough();'))).some((m) => /passthrough/.test(m))],
  ['MVU：开局值含 stat_data 外壳被拦', () => errors('mvu_initvar_formatting', INITVAR_OK, '', projectWith({ mvu: { initvarSource: INITVAR_OK, schemaSource: F('javascript', SCHEMA_OK) } })).length >= 0 && checkMvuFiles({ schemaSource: SCHEMA_OK, initvarSource: F('yaml', 'stat_data:\n  主角:\n    金币: 0'), updateRulesSource: '' }, false).issues.some((m) => /stat_data 外壳/.test(m))],
  ['MVU：三文件交叉发现类型不一致', () => checkMvuFiles({ schemaSource: SCHEMA_OK, initvarSource: F('yaml', '主角:\n  金币: "零"\n  存活: true'), updateRulesSource: '' }, false).issues.some((m) => /变量类型不一致/.test(m))],
  ['MVU：三文件交叉发现规则引用不存在路径', () => checkMvuFiles({ schemaSource: SCHEMA_OK, initvarSource: INITVAR_OK, updateRulesSource: F('yaml', '变量更新规则:\n  主角:\n    声望:\n      check: 当剧情推进时') }, false).issues.some((m) => /都不存在的路径/.test(m))],
  ['MVU：规则更新只读字段被拦', () => checkMvuFiles({ schemaSource: SCHEMA_OK, initvarSource: INITVAR_OK, updateRulesSource: F('yaml', '变量更新规则:\n  主角:\n    金币:\n      check: 当交易时\n      type: number\n    _隐藏:\n      check: 当暗线推进时') }, false).issues.some((m) => /只读字段/.test(m))],
  ['MVU：check 写成代码被拦', () => checkMvuFiles({ schemaSource: SCHEMA_OK, initvarSource: INITVAR_OK, updateRulesSource: F('yaml', '变量更新规则:\n  主角:\n    金币:\n      check: () => true') }, false).issues.some((m) => /简洁自然语言/.test(m))],
  ['MVU：YAML 语法错误被拦', () => errors('mvu_initvar_formatting', F('yaml', '主角:\n  金币: 0\n  存活: [未闭合')).some((m) => /YAML/.test(m))],
  ['MVU：三文件缺一份被拦', () => checkMvuFiles({ schemaSource: SCHEMA_OK, initvarSource: INITVAR_OK, updateRulesSource: '' }, true).issues.some((m) => /尚未完成/.test(m))],
  // 状态栏
  ['状态栏：合法 HTML 通过', () => errors('mvu_statusbar_native_build', F('html', STATUSBAR_OK)).length === 0],
  ['状态栏：缺 doctype 被拦', () => errors('mvu_statusbar_native_build', F('html', STATUSBAR_OK.replace('<!doctype html>\n', ''))).some((m) => /完整 HTML 文档外壳/.test(m))],
  ['状态栏：innerHTML 被拦', () => errors('mvu_statusbar_native_build', F('html', STATUSBAR_OK.replace("document.getElementById('app').textContent = String(d);", "document.getElementById('app').innerHTML = String(d);"))).some((m) => /动态 HTML 执行路径/.test(m))],
  ['状态栏：缺 MVU 读取被拦', () => errors('mvu_statusbar_native_build', F('html', STATUSBAR_OK.replace(/waitGlobalInitialized[\s\S]*?\);/, 'const d = 1;'))).some((m) => /读取 MVU 数据的接口/.test(m))],
  ['状态栏：Vue 路线缺 createApp 被拦', () => errors('mvu_statusbar_vue_build', F('html', STATUSBAR_OK)).some((m) => /Vue 应用入口/.test(m))],
  // 前端
  ['前端：合法双块通过', () => errors('frontend_build', [FRONTEND_TEXT, F('html', FRONTEND_HTML)].join('\n\n'), FRONTEND_CONTRACT).length === 0],
  ['前端：缺 text 块被拦', () => errors('frontend_build', F('html', FRONTEND_HTML), FRONTEND_CONTRACT).some((m) => /运行提示词代码块/.test(m))],
  ['前端：localStorage 被拦', () => errors('frontend_build', [FRONTEND_TEXT, F('html', FRONTEND_HTML.replace("document.getElementById('root')", "localStorage.getItem('x');\ndocument.getElementById('root')"))].join('\n\n'), FRONTEND_CONTRACT).some((m) => /持久化存储/.test(m))],
  ['前端：漏掉合同交互按钮被拦', () => errors('frontend_build', [FRONTEND_TEXT, F('html', FRONTEND_HTML.replace('<button type="button">展开</button>\n', ''))].join('\n\n'), FRONTEND_CONTRACT).some((m) => /本地交互按钮/.test(m))],
  ['前端：外层标签未解析被拦', () => errors('frontend_build', [FRONTEND_TEXT, F('html', FRONTEND_HTML.replace(/moyu_ui/g, 'other_tag'))].join('\n\n'), FRONTEND_CONTRACT).some((m) => /没有解析/.test(m))],
  // EJS
  ['EJS：合法工件通过', () => errors('ejs_build', EJS_OK).length === 0],
  ['EJS：getVar 大小写错被拦', () => errors('ejs_build', F('ejs', "<% if (getVar('stat_data.主角.存活')) { %>ok<% } %>")).some((m) => /getVar/.test(m))],
  ['EJS：标签数量不等被拦', () => errors('ejs_build', F('ejs', "<% if (getvar('x')) { %>ok<% }")).some((m) => /闭合的 <% … %> 标签/.test(m))],
  ['EJS：控制结构不闭合被拦', () => errors('ejs_build', F('ejs', "<% if (getvar('x')) { %>ok<% } %>")).some((m) => /控制代码/.test(m)) === false && errors('ejs_build', F('ejs', "<% if (getvar('x')) { %>ok")).some((m) => /控制代码/.test(m))],
  ['EJS：输出表达式语法错被拦', () => errors('ejs_build', F('ejs', '<%= (1 + %>')).some((m) => /输出表达式/.test(m))],
  // 文本类与开场白
  ['文本类：缺结束标签被本地补好（repair）', () => repairs('airp_basic_information', '<甲_基础信息>\n正文').some((m) => /补全正文结束标签/.test(m))],
  ['开场白：文风约定混入正文被拦', () => errors('opening_style_then_draft', F('text', '<开场白_文风约定>\n冷静克制\n</开场白_文风约定>')).some((m) => /文风约定/.test(m))],
  ['外壳：围栏数为奇数被本地补好（repair）', () => repairs('mvu_schema_compilation', '```javascript\n' + SCHEMA_OK).some((m) => /补全代码块结尾/.test(m))],
  // 工作区模式
  ['工作区：MVU 缺文件被指出', () => {
    const result = checkWorkspace(projectWith({ mvu: { schemaSource: SCHEMA_OK } }), 'mvu', { area: 'crossCheck' });
    return result.issues.some((m) => /尚未完成/.test(m));
  }],
  ['工作区：状态栏依赖 MVU 未齐被指出', () => {
    const result = checkWorkspace(projectWith({ statusbar: { kind: 'vue', source: STATUSBAR_OK } }), 'statusbar', {});
    return result.issues.some((m) => /MVU 三份文件尚未齐全/.test(m));
  }],
];

function selfTest() {
  let failed = 0;
  for (const [name, run] of CASES) {
    let ok = false;
    let detail = '';
    try { ok = run() === true; } catch (error) { detail = String(error?.message ?? error); }
    if (!ok) failed += 1;
    console.log(`${ok ? '  ✓' : '  ✗'} ${name}${detail ? `  ← ${detail}` : ''}`);
  }
  console.log(`\n${failed ? '✗' : '✓'} 自测 ${CASES.length - failed}/${CASES.length} 通过`);
  return failed ? 1 : 0;
}

// ── main ──────────────────────────────────────────────────────────────
async function main() {
  const { _, flags } = parseArgs(process.argv.slice(2));
  if (flags['self-test']) return selfTest();
  jsonMode = Boolean(flags.json);
  jsonOutPath = flags.out && flags.out !== true ? flags.out : '';

  const project = loadProject(flags.project);

  // ── 作品结构检查（等价墨月 validateProject，对应「检查与导出」页）──
  if (flags.project && !flags.domain && !flags.workspace && !flags.file && !flags.id) {
    const { validateProject } = await import('./lib/validate.mjs');
    const issues = validateProject(project);
    const ready = issues.filter((item) => item.level === 'ready');
    const errors = issues.filter((item) => item.level === 'error');
    const warnings = issues.filter((item) => item.level === 'warning');
    if (jsonMode) { emitJson({ command: 'validate', ok: errors.length === 0, issues }); return errors.length ? 1 : 0; }
    const mark = { error: '✗', warning: '·', ready: '✓' };
    for (const item of issues) console.log(`${mark[item.level]} [${item.section}] ${item.title}｜${item.detail}`);
    console.log('');
    if (ready.length) console.log('✓ 结构检查通过：当前正式资料已经满足角色卡打包条件。');
    else console.log(`共 ${errors.length} 个阻断问题、${warnings.length} 个提醒。`);
    console.log('· 这是结构检查，不代表已经在酒馆运行。');
    return errors.length ? 1 : 0;
  }

  if (flags.workspace) {
    const domain = flags.domain ?? _[0];
    if (!domain) { console.error('用法：--workspace --domain <域> [--project 作品.json] [--focus-area <栏目>]'); return 2; }
    const result = checkWorkspace(project, domain, { area: flags['focus-area'] });
    if (!result) {
      if (jsonMode) { emitJson({ command: 'workspace', domain, ok: true, checked: [], limitations: [], issues: [], note: `域「${domain}」没有代码工作区检查。` }); return 0; }
      console.log(`域「${domain}」没有代码工作区检查（只有 mvu / statusbar / frontend / ejs 有）。`);
      return 0;
    }
    if (jsonMode) {
      emitJson({ command: 'workspace', domain, ok: result.issues.length === 0, checked: result.checked, limitations: result.limitations, issues: result.issues });
      return result.issues.length ? 1 : 0;
    }
    console.log(`已检查：${result.checked.join('、') || '（无）'}`);
    console.log(`\n${result.limitations.map((l) => '· ' + l).join('\n')}`);
    if (result.issues.length) {
      console.log(`\n✗ 发现 ${result.issues.length} 个问题：\n`);
      console.log(formatArtifactIssues(result.issues));
      return 1;
    }
    console.log('\n✓ 未发现问题（本地静态检查，不代表已在酒馆运行通过）');
    return 0;
  }

  const taskId = _[0];
  if (!taskId) {
    console.error('用法：node 工具/check.mjs <taskId> --file <成品文件> [--contract <合同文件>] [--project <作品.json>]');
    console.error('      node 工具/check.mjs --workspace --project <作品.json> [--domain mvu]');
    console.error('      node 工具/check.mjs --project <作品.json>              # 作品结构检查');
    console.error('      node 工具/check.mjs --self-test');
    console.error('任一条都可加 --json [--out <结果.json>] 输出机器可读结果（供 prompt.mjs --repair 消费）。');
    return 2;
  }
  const content = readIf(flags.file);
  if (!content) { console.error('缺少 --file <成品文件>（或文件为空）'); return 2; }
  const contract = readIf(flags.contract) || (typeof flags.contract === 'string' ? flags.contract : '');
  const review = workspaceArtifactReview(project, taskId, content, contract);
  return report(review, { label: `「${taskId}」`, taskId });
}

process.exit(await main());
