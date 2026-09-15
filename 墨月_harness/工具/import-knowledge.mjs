#!/usr/bin/env node
/**
 * 墨月 Harness · 知识层导入器
 *
 * 从墨月的 prompt-bundle.json 与 catalog.ts 生成 墨月_harness/知识库/。
 * 可复现：任何时刻重跑都得到同样结果；手工修订应写进 _override/ 而不是改生成物。
 *
 * 用法：
 *   node 工具/import-knowledge.mjs            # 生成
 *   node 工具/import-knowledge.mjs --check    # 只校验，不写入
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHECK_ONLY = process.argv.includes('--check');

const SRC = {
  bundle: path.join(ROOT, '知识库', '_源_prompt-bundle.json'),
  catalog: path.join(ROOT, '知识库', '_源_catalog.ts'),
};
const OUT = path.join(ROOT, '知识库');

/** 与墨月 compileWebPromptText() 等价：剥离酒馆宏外壳，正文一字不动。 */
function clean(value) {
  return value
    .replace(/^\s*\{\{(?:addvar|setvar)::[^\n]*$/gmu, '')
    .replace(/^\s*\}\}\{\{trim\}\}\s*$/gmu, '')
    .replace(/\{\{getvar::active_workshop_task\}\}/g, '')
    .replace(/<active_workshop_task>\s*<\/active_workshop_task>/gi, '')
    .replace(/<#\/?escape-ejs>/g, '')
    .replace(/哥哥/g, '作者')
    .replace(/明月秋青写卡工坊/g, '墨月写卡器')
    .replace(/QiuqingziWorkshop/g, 'MoyuWorkshop')
    .trim();
}

/** 与墨月 webPromptEntryParts() 等价：合同 / 知识 / 范例 三段分离。 */
function splitParts(content) {
  const source = clean(content);
  const contract = source.match(/<workshop_task\b[^>]*>[\s\S]*?<\/workshop_task>/i)?.[0] ?? '';
  const knowledgeBlocks = [...source.matchAll(/<(knowledge_[A-Za-z0-9_-]+)(?:\s[^>]*)?>[\s\S]*?<\/\1>/gi)].map((m) => m[0]);
  const examples = [...source.matchAll(/<reference_examples(?:\s[^>]*)?>[\s\S]*?<\/reference_examples>/gi)].map((m) => m[0]);
  const knowledge = knowledgeBlocks.length
    ? knowledgeBlocks.join('\n\n')
    : source.replace(/<workshop_task\b[^>]*>[\s\S]*?<\/workshop_task>/gi, '').trim();
  return { contract, knowledge, examples: examples.join('\n\n') };
}

/** 墨月的 group → harness 的领域目录。mvu_statusbar_* 属状态栏域。 */
const DOMAIN = {
  '核心': '核心',
  '人物生境': '人物',
  '世界观': '世界',
  '通用创作': '通用',
  'MVU': 'MVU',
  '前端': '前端',
  'EJS': 'EJS',
};
function domainOf(task) {
  if (task.id.startsWith('mvu_statusbar_')) return '状态栏';
  if (task.id === 'creation_rules') return '规则';
  if (task.id === 'opening_style_then_draft') return '开场白';
  if (task.id === 'free_creation') return '通用';
  return DOMAIN[task.group] ?? task.group;
}

/** 00 与 95 在网页版是死代码（酒馆宏残留），保留但标记，便于 1:1 对照。 */
const LEGACY_CORE = new Set(['00_任务变量初始化', '95_本轮用户输入锚点-尾部']);

function taskFile(task, kind) {
  const { contract, knowledge, examples } = splitParts(task.content);
  const domain = kind === 'core' ? '核心' : domainOf(task);
  const fmLines = [
    '---',
    `id: ${task.id}`,
    `kind: ${kind}`,
    `group: ${task.group}`,
    `domain: ${domain}`,
    `name: ${task.name}`,
    `has_contract: ${contract ? 'true' : 'false'}`,
  ];
  if (kind === 'core' && LEGACY_CORE.has(task.id)) fmLines.push('legacy_st_macro: true');
  fmLines.push('---');
  const fm = fmLines.join('\n') + '\n\n';
  const body = [
    `# ${task.name}`,
    '',
    contract ? `## 合同（本轮唯一执行依据）\n\n${contract}` : '_本条无独立合同。_',
    '',
    `## 知识\n\n${knowledge}`,
    examples ? `\n## 参考例（隔离区：只提供结构，不作为建议内容）\n\n${examples}` : '',
    '',
  ].join('\n');
  return { domain, path: path.join(OUT, domain, `${task.id}.md`), text: fm + body };
}

function specialtyFile(s) {
  const fm = [
    '---',
    `id: ${s.id}`,
    'kind: specialty',
    `group: ${s.group}`,
    'domain: 脚本工坊',
    `name: ${s.name}`,
    `requires: [${s.requires.join(', ')}]`,
    '---',
  ].join('\n') + '\n\n';
  const body = [
    `# ${s.name}`,
    '',
    `**依赖**：${s.requires.length ? s.requires.join('、') : '无'}`,
    '',
    `## 业务边界\n\n${s.knowledge}`,
    '',
    `## 必测\n\n${s.checks.map((c) => `- ${c}`).join('\n')}`,
    '',
  ].join('\n');
  return { path: path.join(OUT, '脚本工坊', `${s.id}.md`), text: fm + body, group: s.group };
}

// ── 载入源 ────────────────────────────────────────────────────────────
const bundle = JSON.parse(fs.readFileSync(SRC.bundle, 'utf8'));
const catalog = await import(`file://${SRC.catalog.replace(/\\/g, '/')}`);

const files = [
  ...bundle.core.map((t) => taskFile(t, 'core')),
  ...bundle.tasks.map((t) => taskFile(t, 'task')),
  ...catalog.specialties.map(specialtyFile),
];
const extra = [{
  path: path.join(OUT, '核心', 'oldAssistantPrefill.md'),
  text: `---\nid: oldAssistantPrefill\nkind: core\ndomain: 核心\nname: assistant 预填充头部\n---\n\n# assistant 预填充头部\n\n> 仅 assistant-prefill 路由（Gemini 3.1 Pro / DeepSeek）使用；作为 messages 末尾的 assistant 消息，\n> 并从中截出 \`<thinking>\\n\` 作为 responsePrefix。\n\n\`\`\`text\n${bundle.oldAssistantPrefill}\n\`\`\`\n`,
}];
files.push(...extra);

// ── 索引 ──────────────────────────────────────────────────────────────
const byDomain = {};
for (const f of files) {
  const id = path.basename(f.path, '.md');
  const domain = path.basename(path.dirname(f.path));
  (byDomain[domain] = byDomain[domain] || []).push(id);
}
const summary = {
  core: bundle.core.length,
  tasks: bundle.tasks.length,
  specialties: catalog.specialties.length,
  total: bundle.core.length + bundle.tasks.length + catalog.specialties.length,
};

const index = [
  '# 墨月 Harness · 知识库索引',
  '',
  `> 由 \`工具/import-knowledge.mjs\` 从墨月源文件生成：核心 ${summary.core} + 专项 ${summary.tasks} + 脚本工坊 ${summary.specialties} = **${summary.total} 条**。`,
  '> 每条 = 合同（唯一执行依据）+ 知识 + 参考例隔离区。**知识正文不能自行激活其他任务。**',
  '',
  '| 域 | 条数 | 条目 |',
  '|---|---|---|',
  ...Object.entries(byDomain).sort().map(([d, ids]) => `| ${d} | ${ids.length} | ${ids.join(' ')} |`),
  '',
  '## 与墨月网页版的对应',
  '',
  '| 墨月 | Harness |',
  '|---|---|',
  '| `<workshop_task>` | 文件 `## 合同` 段 |',
  '| `<knowledge_*>` | 文件 `## 知识` 段 |',
  '| `<reference_examples>` | 文件 `## 参考例` 段（隔离区） |',
  '| `{{addvar::active_workshop_task}}` | 已剥离（ST 宏，无对应物） |',
  '| 00 / 95 两条核心 | 保留并标记 `legacy_st_macro: true`（网页版为死代码） |',
  '| 99 直接进入预设思维 | 保留，仅 user-direct 路由使用 |',
  '',
  `## 脚注`,
  '',
  '- `_源_prompt-bundle.json` 与 `_源_catalog.ts` 是**唯一事实来源**，只读。',
  '- 重新生成：`node 工具/import-knowledge.mjs`；校验一致性：加 `--check`。',
  '',
].join('\n');

files.push({ path: path.join(OUT, '_索引.md'), text: index });

// ── 写入 / 校验 ───────────────────────────────────────────────────────
let written = 0;
const problems = [];
for (const f of files) {
  const exists = fs.existsSync(f.path);
  if (CHECK_ONLY) {
    if (!exists) problems.push(`缺失: ${path.relative(ROOT, f.path)}`);
    else if (fs.readFileSync(f.path, 'utf8') !== f.text) problems.push(`不同步: ${path.relative(ROOT, f.path)}`);
    continue;
  }
  fs.mkdirSync(path.dirname(f.path), { recursive: true });
  fs.writeFileSync(f.path, f.text, 'utf8');
  written++;
}

if (CHECK_ONLY) {
  if (problems.length) {
    console.error(`✗ ${problems.length} 处不一致`);
    for (const p of problems.slice(0, 20)) console.error('  ' + p);
    process.exit(1);
  }
  console.log(`✓ 知识库与源文件一致（${files.length} 个文件）`);
} else {
  console.log(`✓ 写入 ${written} 个文件`);
  console.log(`  核心 ${summary.core} · 专项 ${summary.tasks} · 脚本工坊 ${summary.specialties} · 合计 ${summary.total}`);
  console.log('  域分布: ' + Object.entries(byDomain).sort().map(([d, i]) => `${d}=${i.length}`).join(', '));
}
