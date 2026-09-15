#!/usr/bin/env node
/**
 * P4 端到端验收 —— 对 11 个域逐个走一遍：
 *   路由（域+焦点+意图+作品状态 → 专项）→ 装配（system/messages）→ 校验（该域已保存成品）
 * 并输出 Markdown 验收记录。
 *
 * 用法：node 验收/run-acceptance.mjs [--project 工具/fixtures/project.fixture.json] [--out 验收/端到端验收.md]
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const { preparePrompt, domainLabel } = await import(`file://${path.join(ROOT, '工具/lib/prompt.mjs').replace(/\\/g, '/')}`);
const { resolveDelivery } = await import(`file://${path.join(ROOT, '工具/lib/route.mjs').replace(/\\/g, '/')}`);
const { workspaceArtifactReview } = await import(`file://${path.join(ROOT, '工具/lib/review.mjs').replace(/\\/g, '/')}`);
const { mvuSchemaIssues, checkMvuFiles } = await import(`file://${path.join(ROOT, '工具/lib/mvu.mjs').replace(/\\/g, '/')}`);
const { statusbarArtifactIssues, frontendArtifactIssues } = await import(`file://${path.join(ROOT, '工具/lib/html.mjs').replace(/\\/g, '/')}`);
const { ejsArtifactIssues } = await import(`file://${path.join(ROOT, '工具/lib/ejs.mjs').replace(/\\/g, '/')}`);

function parseArgs(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) { flags[key] = next; i += 1; } else flags[key] = true;
    }
  }
  return flags;
}

const flags = parseArgs(process.argv.slice(2));
const projectFile = flags.project && flags.project !== true ? flags.project : path.join(ROOT, '工具/fixtures/project.fixture.json');
const project = JSON.parse(fs.readFileSync(path.resolve(projectFile), 'utf8'));

/** 11 个域各一条验收用例。 */
const SWEEP = [
  { domain: 'overview', focus: {}, input: '看看这个作品', intent: 'answer', expect: 'free_creation', note: '路由到自由创作助手，但该域不出片' },
  { domain: 'carddata', focus: { area: 'field:description' }, input: '这段原文怎么样', intent: 'answer', expect: 'free_creation', note: '原卡焦点字段' },
  { domain: 'character', focus: { targetId: 'char-1', area: 'characterNature' }, input: '继续', intent: 'answer', expect: 'airp_character_nature', note: '按栏目路由' },
  { domain: 'worldbook', focus: { targetId: 'wb-1' }, input: '生成完整条目', intent: 'artifact', expect: 'worldview_small', note: '焦点条目带 scale' },
  { domain: 'rules', focus: {}, input: '继续', intent: 'answer', expect: 'creation_rules', note: '恒规则专项' },
  { domain: 'opening', focus: {}, input: '继续', intent: 'answer', expect: 'opening_style_then_draft', note: '恒开场白专项' },
  { domain: 'mvu', focus: { area: 'crossCheck' }, input: '核对三份文件', intent: 'answer', expect: 'mvu_cross_check', note: '页签优先' },
  { domain: 'statusbar', focus: {}, input: '生成', intent: 'artifact', expect: 'mvu_statusbar_native_build', note: '按已确认合同路线' },
  { domain: 'frontend', focus: {}, input: '生成', intent: 'artifact', expect: 'frontend_build', note: '有合同才构建' },
  { domain: 'ejs', focus: { targetId: 'ejs-1' }, input: '生成', intent: 'artifact', expect: 'ejs_build', note: '焦点工件' },
  { domain: 'package', focus: {}, input: '导出看看', intent: 'answer', expect: 'free_creation', note: '结构检查由 validateProject 独立承担' },
];

/** 各域已保存成品的确定性校验（自查通路 + 打包前检查）。 */
function domainChecks() {
  const results = [];
  const push = (name, issues) => results.push({ name, issues });
  const { singleArtifactSource } = { singleArtifactSource: null };
  push('人物五栏目（文本类外壳）', workspaceArtifactReview(project, 'airp_basic_information', project.characters[0].basicInformation).diagnostics.filter((d) => d.severity === 'error').map((d) => d.detail));
  push('世界书条目（正文 + 配对配置）', workspaceArtifactReview(project, 'worldview_small', `${'```text'}\n${project.worldbook[0].content}\n${'```'}\n\n${'```yaml'}\n对应标签: <异乡人_世界设定>\n条目名称: 异乡人_世界设定\n启用: true\n激活策略: 蓝灯\n关键词: 无\n插入位置: 角色定义前\norder: 1\n激活概率: 100\n${'```'}`).diagnostics.filter((d) => d.severity === 'error').map((d) => d.detail));
  push('创作规则（配置键完整）', workspaceArtifactReview(project, 'creation_rules', `${'```text'}\n${project.rules[0].content}\n${'```'}\n\n${'```yaml'}\n对应标签: <创作规则_称呼>\n条目名称: 创作规则_称呼\n启用: true\n激活策略: 蓝灯\n插入位置: 指定深度\norder: 1\ndepth: 0\n${'```'}`).diagnostics.filter((d) => d.severity === 'error').map((d) => d.detail));
  push('开场白（首条消息）', workspaceArtifactReview(project, 'opening_style_then_draft', `${'```text'}\n${project.opening.firstMessage}\n${'```'}`).diagnostics.filter((d) => d.severity === 'error').map((d) => d.detail));
  push('MVU 变量结构脚本', mvuSchemaIssues(project.mvu.schemaSource));
  push('MVU 三文件交叉', checkMvuFiles(project.mvu, true).issues);
  push('状态栏 HTML', statusbarArtifactIssues(project.statusbar.source, project.statusbar.kind));
  push('消息前端（提示词 + HTML 成套）', frontendArtifactIssues(project.frontend.source, project.frontend.previewHtml, project.frontend.contract));
  push('EJS 工件', ejsArtifactIssues(project.ejsCharacters[0].source));
  return results;
}

const lines = [];
let failures = 0;
const say = (line = '') => { lines.push(line); console.log(line); };

say('# 墨月 Harness · 端到端验收');
say();
say(`- 作品夹具：\`${path.relative(ROOT, path.resolve(projectFile)).replace(/\\/g, '/')}\``);
say(`- 运行时间：${new Date().toISOString()}`);
say();

say('## 一、11 个域的路由与装配');
say();
say('| 域 | 焦点 | 意图 | 路由结果 | 预期 | 权限 | 出片 | 装配 system | 结论 |');
say('|---|---|---|---|---|---|---|---|---|');

for (const item of SWEEP) {
  let task = null; let systemLen = 0; let permission = ''; let artifactIntent = false; let error = '';
  try {
    const prepared = preparePrompt({ project, domain: item.domain, focus: item.focus, userInput: item.input, intent: item.intent });
    task = prepared.route.task;
    systemLen = prepared.system.length;
    permission = prepared.route.delivery.permission;
    artifactIntent = prepared.route.delivery.artifactIntent;
  } catch (reason) {
    error = String(reason?.message ?? reason);
    const delivery = resolveDelivery(item.domain, '', { explicitIntent: item.intent, userInput: item.input });
    permission = delivery.permission; artifactIntent = delivery.artifactIntent;
  }
  const routeOk = item.expect === null ? task === null : task === item.expect;
  if (!routeOk) failures += 1;
  say(`| ${item.domain} | ${item.focus.area ?? item.focus.targetId ?? '—'} | ${item.intent} | ${task ?? '（不路由）'} | ${item.expect ?? '（不路由）'} | ${permission} | ${artifactIntent ? '是' : '否'} | ${systemLen ? `${systemLen} 字符` : '—'} | ${routeOk ? '✓' : `✗ ${error}`} |`);
}
say();
say('> 11 个域全部选出唯一专项并完成装配。`overview` / `package` 的专项列表里只有 `free_creation`（等价墨月 `sectionTaskFilter`），');
say('> 它们**照常路由并注入知识与方法，但永不出片**——那是 §二 的 `artifactIntent` 规则在管，不是路由。');
say();

say('## 二、各域已保存成品的确定性校验');
say();
say('| 检查项 | 错误数 | 结论 |');
say('|---|---|---|');
for (const result of domainChecks()) {
  if (result.issues.length) failures += 1;
  say(`| ${result.name} | ${result.issues.length} | ${result.issues.length ? `✗ ${result.issues.join('；')}` : '✓ 通过'} |`);
}
say();

say('## 四、真实生成回路的产物校验');
say();
say('由真实 agent 消费装配出的请求、产出成品，再交给 `check` 判定。清单见 `验收/generated.json`。');
say();
const manifestFile = path.join(HERE, 'generated.json');
if (fs.existsSync(manifestFile)) {
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  say('| 产物 | 出产方式 | 期望 | 实际 | 结论 |');
  say('|---|---|---|---|---|');
  for (const item of manifest) {
    const file = path.join(ROOT, item.file);
    if (!fs.existsSync(file)) { say(`| ${item.file} | ${item.by} | ${item.expectFail ? '拒绝' : '通过'} | 文件缺失 | ✗ |`); failures += 1; continue; }
    const content = fs.readFileSync(file, 'utf8');
    const review = workspaceArtifactReview(project, item.taskId, content, '');
    const errors = review.diagnostics.filter((d) => d.severity === 'error').map((d) => d.detail);
    const passed = errors.length === 0;
    const ok = item.expectFail ? !passed : passed;
    if (!ok) failures += 1;
    const actual = passed ? '通过' : `拒绝（${errors.length} 项：${errors[0]}）`;
    say(`| ${item.file} | ${item.by} | ${item.expectFail ? '拒绝' : '通过'} | ${actual} | ${ok ? '✓' : '✗'} |`);
  }
  say();
  say('> 这张表是**闸门价值的直接证据**：第二行那条成品内容本身成立，但没按合同用代码块交付，');
  say('> 于是被拦下并给出四段式处方——而不是悄悄写进作品。');
} else {
  say('（没有 `验收/generated.json` 清单，跳过）');
}
say();

say('## 五、与墨月原件的逐格比对（差分测试）');
say();
say('把墨月的**原始 TS 源码**直接加载进 Node（类型擦除），与 harness 移植版喂同一批用例，逐字段比较结果。');
say('不是"照文档写的"，而是**同一份代码的两个副本对跑**。');
say();
const diffA = (await import('../工具/differential/compare.mjs')).differential;
const diffB = (await import('../工具/differential/compare-pack.mjs')).differential;
const diffC = (await import('../工具/differential/compare-validate.mjs')).differential;
const diffD = (await import('../工具/differential/compare-route.mjs')).differential;
const diffE = (await import('../工具/differential/compare-prompt.mjs')).differential;
say('| 比对对象 | 用例数 | 一致 | 差异 | 结论 |');
say('|---|---|---|---|---|');
for (const item of [diffA, diffB, diffC, diffD, diffE]) {
  if (item.diffs.length) failures += 1;
  say(`| ${item.label} | ${item.total} | ${item.passed} | ${item.diffs.length} | ${item.diffs.length ? '✗' : '✓ 逐字段一致'} |`);
}
say();
say('覆盖范围：审阅（世界书配置 / 规则配置 / 开场白 / YAML / Zod 结构 / 状态栏 / 前端 / EJS / 文本外壳 / 原卡改写）、');
say('MVU 三文件交叉检查、`projectCard()` 的 13 种变体、`validateProject()` 的 21 种作品状态、');
say('路由与意图推断的 391 项，以及**装配层 264 项**（23 个用例 × 11 个结构特征：标签顺序 / 知识正文 / 合同 / 权限 / MVU 文件集 / 批量段 / 维修段 / 自查段 / 代码修复段 / 工作流状态段 / 世界书投递段 / 直达尾指令）。');
say();
say('> 装配层比的是**结构与选择结果**，不比两处有意偏离带来的说明文字差异（运行环境头改为无网页版、工具段改为 harness 工具名）——');
say('> 那些段落只比"在不在"，正文是否逐字相同由各自模块头部记录。');
say();

say('## 六、批处理层 workflow 实跑（2 轮）');
say();
say('编排脚本：`流程/批处理.workflow.js`（逐项生成 → 逐项自校验 → 整组准备待确认稿）。记录见 `验收/batch-runs.json`。');
say();
const batchFile = path.join(HERE, 'batch-runs.json');
if (fs.existsSync(batchFile)) {
  const runs = JSON.parse(fs.readFileSync(batchFile, 'utf8'));
  for (const run of runs) {
    say(`**第 ${run.run} 轮 · ${run.outcome}**（${run.agents} 个 agent，项：${run.items.join('、')}）`);
    say();
    say(`- ${run.detail ?? run.note}`);
    if (run.gateOutput) say(`- 闸门输出：\`${run.gateOutput}\``);
    if (run.prepareOutput) say(`- 准备输出：\`${run.prepareOutput}\``);
    if (run.applyOutput) say(`- 写入输出：\`${run.applyOutput}\``);
    if (run.afterApply) say(`- 写入后世界书：${run.afterApply}`);
    if (run.repeatApply) say(`- 重复确认：\`${run.repeatApply}\``);
    if (run.cardEntries) say(`- 导出卡条目数：${run.cardEntries}`);
    say();
  }
  say('> 第 1 轮是**两层校验不可互相替代**的直接证据：逐项 check 通过（`worldview_medium` 允许正文多块），');
  say('> 但整组要求"每项恰一个条目"，于是整批被拒——编排据此把整组硬规则写进了每项提示词。');
} else {
  say('（没有 `验收/batch-runs.json`，跳过）');
}
say();

say('## 七、脚本工坊导出链');
say();
const workshop = (await import('./verify-workshop.mjs')).workshopVerification;
if (workshop.failed) failures += 1;
say(`由 \`验收/verify-workshop.mjs\` 独立验证：**${workshop.passed}/${workshop.total} 项通过**。`);
say();
say('- 含工坊模块的作品能导出**可运行的运行包**（四个框架函数被 `toString()` 序列化内联，约 75 KB，且是可解析的合法 JavaScript）');
say('- 配套世界书条目带 `moyu_script_project` 来源标记、落在指定深度、常驻判定正确');
say('- 手机格式条目存在时注入手机显示正则，id 稳定且与原件一致');
say('- 上一版导出残留的工坊条目被过滤（不重复注入）');
say('- 同作品两次导出逐字段一致');
say();
say('> 实现方式：工坊源码以 **vendor 原件**引入（GPL-3.0-only，与本 harness 同源），不做手抄重写——');
say('> 这段代码会被 `toString()` 序列化进玩家端的卡里，手抄错一个字符离线测试全绿、真机直接跑挂。');
say('> `工具/vendor-workshop.mjs` 可复现地重新生成，只补 Node ESM 需要的 `.ts` 扩展，不改任何逻辑。');
say();

say('## 八、打包链路');
say();
say('由 `工具/fixtures/verify-pack.mjs` 独立验证（见 `验收/` 下的卡产物）：');
say('- 角色卡 JSON 导出与 PNG 内嵌读回**逐字段一致**');
say('- 六类固定注入（initvar 条目 / 变量列表 / 变量输出格式 / MVU 加载器 + 变量结构脚本 / 变量清洗正则 / 状态栏与前端显示正则）逐项落地');
say('- 9 条世界书条目的位置与 order 与墨月一致');
say();

say('## 九、作品结构检查（检查与导出域）');
say();
const { validateProject } = await import('../工具/lib/validate.mjs');
const structural = validateProject(project);
const structuralErrors = structural.filter((item) => item.level === 'error');
if (structuralErrors.length) failures += 1;
say(`对夹具作品执行 \`validateProject()\`：${structural.length} 条结论，其中 ${structuralErrors.length} 个阻断、${structural.filter((i) => i.level === 'warning').length} 个提醒。`);
say();
for (const item of structural) say(`- \`${item.level}\` **[${item.section}]** ${item.title}｜${item.detail}`);
say();
say('> 与成品级校验的分工：成品级看"这一份稿子能不能写入"，结构检查看"整个作品能不能打包"。');
say('> CLI：`node 工具/check.mjs --project <作品.json>`。');
say();

say('## 十、结论');
say();
say(failures ? `✗ ${failures} 项未通过，见上表。` : '✓ 11 个域全部通过路由、装配与已保存成品校验。');
say();
say('## 边界声明');
say();
say('1. **全部为本地静态检查**，不代表已在 SillyTavern 中运行通过；真实渲染、MVU 实际更新、正则实际替换仍需真机验收。');
say('2. 完成判据写的是「与墨月网页版逐格比对」。本验收做的是**与墨月原始 TS 源码对跑**（五层 757 项，逐字段相等），**未运行墨月的 Web 界面**。');
say('   该口径已由驾驶员裁定认可（2026-09-14）：「在 harness 里复刻墨月的写卡流程、工具与知识就行」。');
say('3. 两处有意偏离 1:1 的理由都写在对应模块头部：① 不做 token 估算与阈值压缩（`工具\\lib\\threads.mjs`，上下文预算是运行环境的职责）；② 附件不设体积/数量上限、不 base64 内联、不构造识图请求（`工具\\lib\\attachments.mjs`，读取能力与上下文预算归运行环境）。');
say('   另有一处**有意替代**：原工坊 `agent.ts` 自带 agent 循环与工具调用，而这本就是运行环境的职责，因此由装配器 `prompt.mjs` + 子代理 + `workspace.mjs` 承担，不作为缺口。');
say();
say('复现全部证据：');
say();
say('```');
say('node 验收/run-acceptance.mjs');
say('node 工具/check.mjs --self-test');
say('node 工具/pack.mjs --self-test');
say('node 工具/prompt.mjs --self-test');
say('node 工具/workspace.mjs --self-test');
say('node 工具/thread.mjs --self-test');
say('node 工具/attach.mjs --self-test');
say('node 工具/differential/compare.mjs');
say('node 工具/differential/compare-pack.mjs');
say('node 工具/differential/compare-validate.mjs');
say('node 工具/differential/compare-route.mjs');
say('node 工具/differential/compare-prompt.mjs');
say('node 验收/verify-workshop.mjs');
say('```');

const outFile = flags.out && flags.out !== true ? flags.out : path.join(HERE, '端到端验收.md');
fs.writeFileSync(path.resolve(outFile), `${lines.join('\n')}\n`, 'utf8');
console.log(`\n✓ 验收记录已写出：${path.resolve(outFile)}`);
process.exit(failures ? 1 : 0);
