#!/usr/bin/env node
/**
 * 墨月 Harness · 会话存档（按对象分区）
 *
 * 分工（重要）：**上下文压缩是 harness 的职责**，本工具不做 token 估算、不按阈值自动压缩。
 * 这里只负责 harness 不知道的那部分：
 *   · 按 (域, 专项, 焦点对象) 分区持久保存作者对话；
 *   · 把该对象的既有讨论与记忆注入请求；
 *   · 摘要委托给正在跑的 agent，工作区只守墨月那条安全阀（空/超长/没变短 → 整份丢弃）。
 *
 * 用法：
 *   node 工具/thread.mjs --show  --domain character --task airp_character_nature --target char-1
 *   node 工具/thread.mjs --append --role user --file 本轮发言.txt   （同上定位参数）
 *   node 工具/thread.mjs --append --role assistant --file 回复.md
 *   node 工具/thread.mjs --plan                              # 打印待压缩原文与将覆盖的消息 id
 *   node 工具/thread.mjs --commit --summary 摘要.txt          # 走安全阀后写入记忆记录
 *   node 工具/thread.mjs --list
 *   node 工具/thread.mjs --self-test
 *
 * 定位参数：--domain --task --target --area（与 _路由表.md 的输入四元组一致）
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { ensureThread, readThread, writeThread, listThreads, appendThreadMessage } from './lib/pending.mjs';
import { conversationScopeKey, measureThread, planCompaction, compactionSource, commitCompaction, scopeLabel, conversationPromptMessages, linkedConversationThreads, MIN_RECENT_MESSAGES } from './lib/threads.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

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

const opt = (v) => (v && v !== true ? v : undefined);

function locate(flags, { create = false } = {}) {
  const section = opt(flags.domain);
  const taskId = opt(flags.task);
  if (!section || !taskId) throw new Error('需要 --domain 与 --task 定位专项（可选 --target / --area）。');
  const focus = { targetId: opt(flags.target), area: opt(flags.area) };
  const scopeKey = conversationScopeKey(section, taskId, focus);
  const label = scopeLabel(section, taskId, focus);
  if (create) return ensureThread(ROOT, { scopeKey, section, taskId, focus, label });
  const thread = readThread(ROOT, scopeKey);
  if (!thread) {
    if (!flags.list) throw new Error(`还没有这个对象的会话存档：${label}。先 append 一条，或先用 --list 看看。`);
    return undefined;
  }
  return thread;
}

function selfTest() {
  const cases = [
    ['scopeKey 区分不同焦点对象', conversationScopeKey('character', 'airp_basic_information', { targetId: 'a' })
      !== conversationScopeKey('character', 'airp_basic_information', { targetId: 'b' })],
    ['scopeKey 区分不同专项', conversationScopeKey('character', 'a') !== conversationScopeKey('character', 'b')],
    ['scopeKey 稳定', conversationScopeKey('character', 'a', { area: 'x' }) === conversationScopeKey('character', 'a', { area: 'x' })],
    ['压缩只取最近 N 条以外', (() => {
      const thread = { messages: Array.from({ length: 10 }, (_, i) => ({ id: `m${i}`, role: 'user', content: 'x' })), memoryRecords: [] };
      const plan = planCompaction(thread, { keepRecent: 4 });
      return plan.messages.length === 6 && plan.coveredMessageIds.length === 6;
    })()],
    ['已覆盖的消息不再进入下一次计划', (() => {
      const thread = {
        messages: Array.from({ length: 10 }, (_, i) => ({ id: `m${i}`, role: 'user', content: 'x' })),
        memoryRecords: [{ content: '旧记忆', coveredMessageIds: ['m0', 'm1', 'm2', 'm3', 'm4', 'm5'] }],
      };
      return planCompaction(thread, { keepRecent: 4 }) === undefined;
    })()],
    ['安全阀：摘要没变短 → 拒绝', (() => {
      const thread = { messages: [], memoryRecords: [] };
      const plan = { previousSummary: '', messages: [], coveredMessageIds: [], sourceCharacters: 10 };
      try { commitCompaction(thread, plan, '这是一个明显比原文更长的摘要内容'); return false; }
      catch (error) { return /没有有效缩短/.test(error.message) && thread.memoryRecords.length === 0; }
    })()],
    ['安全阀：空摘要 → 拒绝', (() => {
      const thread = { messages: [], memoryRecords: [] };
      try { commitCompaction(thread, { previousSummary: '', messages: [], coveredMessageIds: [], sourceCharacters: 100 }, '   '); return false; }
      catch (error) { return /没有返回可用的任务记忆/.test(error.message); }
    })()],
    ['安全阀：超长摘要 → 拒绝', (() => {
      const thread = { messages: [], memoryRecords: [] };
      try { commitCompaction(thread, { previousSummary: '', messages: [], coveredMessageIds: [], sourceCharacters: 1e9 }, 'x'.repeat(24_001)); return false; }
      catch (error) { return /超过 24000 字符/.test(error.message); }
    })()],
    ['合格摘要被记录且覆盖标记落盘', (() => {
      const thread = { messages: [], memoryRecords: [] };
      const plan = { previousSummary: '', messages: [], coveredMessageIds: ['m1', 'm2'], sourceCharacters: 500 };
      const record = commitCompaction(thread, plan, '一句话摘要');
      return thread.memoryRecords.length === 1 && record.coveredMessageIds.length === 2 && record.summaryCharacters === 5;
    })()],
    ['注入时记忆在前、被覆盖消息被跳过', (() => {
      const thread = {
        messages: [{ id: 'm1', role: 'user', content: '旧的' }, { id: 'm2', role: 'user', content: '新的' }],
        memoryRecords: [{ content: '记忆内容', coveredMessageIds: ['m1'] }],
      };
      const out = conversationPromptMessages(thread);
      return out.length === 2 && out[0].content.includes('<task_memory>') && out[1].content.includes('新的');
    })()],
    ['关联讨论：目标栏目还没定稿 → 带出', (() => {
      const project = { characters: [{ id: 'c1', basicInformation: '', characterNature: '有' }] };
      const threads = [{ id: 't2', section: 'character', taskId: 'airp_basic_information', targetId: 'c1', area: 'basicInformation', scopeKey: 'k2', messages: [{ role: 'user', content: 'x' }], memoryRecords: [], updatedAt: '2026-01-01' }];
      const hit = linkedConversationThreads(project, 'character', { targetId: 'c1', area: 'characterNature' }, 'airp_character_nature', 't1', threads);
      return hit.length === 1;
    })()],
    ['关联讨论：目标栏目已定稿 → 不带出旧讨论', (() => {
      const project = { characters: [{ id: 'c1', basicInformation: '已定稿', characterNature: '有' }] };
      const threads = [{ id: 't2', section: 'character', taskId: 'airp_basic_information', targetId: 'c1', area: 'basicInformation', scopeKey: 'k2', messages: [{ role: 'user', content: 'x' }], memoryRecords: [], updatedAt: '2026-01-01' }];
      const hit = linkedConversationThreads(project, 'character', { targetId: 'c1', area: 'characterNature' }, 'airp_character_nature', 't1', threads);
      return hit.length === 0;
    })()],
    ['关联讨论：起点分流材料即使已定稿也带出', (() => {
      const project = { characters: [{ id: 'c1', basicInformation: '已定稿', characterNature: '有' }] };
      const threads = [{ id: 't3', section: 'character', taskId: 'airp_intake_router', targetId: 'c1', area: '', scopeKey: 'k3', messages: [{ role: 'user', content: 'x', taskId: 'airp_intake_router' }], memoryRecords: [], updatedAt: '2026-01-02' }];
      const hit = linkedConversationThreads(project, 'character', { targetId: 'c1', area: 'characterNature' }, 'airp_character_nature', 't1', threads);
      return hit.length === 1;
    })()],
    ['关联讨论：当前会话自身不重复注入', (() => {
      const project = { characters: [{ id: 'c1', basicInformation: '', characterNature: '有' }] };
      const threads = [{ id: 't1', section: 'character', taskId: 'airp_basic_information', targetId: 'c1', area: 'basicInformation', scopeKey: 'k1', messages: [{ role: 'user', content: 'x' }], memoryRecords: [], updatedAt: '2026-01-03' }];
      return linkedConversationThreads(project, 'character', { targetId: 'c1', area: 'characterNature' }, 'airp_character_nature', 't1', threads).length === 0;
    })()],
    ['关联讨论：workspace_read 不注入任何承接', (() => {
      const project = { characters: [{ id: 'c1', basicInformation: '' }] };
      const threads = [{ id: 't2', section: 'character', taskId: 'airp_basic_information', targetId: 'c1', area: 'basicInformation', scopeKey: 'k2', messages: [{ role: 'user', content: 'x' }], memoryRecords: [], updatedAt: '2026-01-01' }];
      return linkedConversationThreads(project, 'character', { targetId: 'c1' }, 'workspace_read', 't1', threads).length === 0;
    })()],
  ];
  let failed = 0;
  for (const [name, ok] of cases) {
    if (!ok) failed += 1;
    console.log(`${ok ? '  ✓' : '  ✗'} ${name}`);
  }
  console.log(`\n${failed ? '✗' : '✓'} 会话存档自测 ${cases.length - failed}/${cases.length} 通过`);
  return failed ? 1 : 0;
}

function main() {
  const flags = parseArgs(process.argv.slice(2));
  if (flags['self-test']) return selfTest();

  if (flags.list) {
    const all = listThreads(ROOT);
    if (!all.length) { console.log('（还没有会话存档）'); return 0; }
    for (const thread of all) {
      const m = measureThread(thread);
      console.log(`${thread.label || thread.scopeKey}\n  ${thread.section}·${thread.taskId}｜消息 ${m.messages}（未覆盖 ${m.uncovered}）｜记忆 ${m.memoryRecords} 条｜${thread.updatedAt}`);
    }
    return 0;
  }

  const thread = locate(flags, { create: Boolean(flags.append || flags.plan || flags.commit || flags.ensure) });

  if (flags.show || flags.ensure) {
    const m = measureThread(thread);
    console.log(`分区：${thread.label || thread.scopeKey}`);
    console.log(`消息 ${m.messages} 条（未覆盖 ${m.uncovered} 条 / ${m.uncoveredCharacters} 字符）｜记忆 ${m.memoryRecords} 条`);
    console.log('· 这是给 agent 的信号，不是上下文预算判据——预算归 harness 管。');
    if (flags.show) for (const message of thread.messages) console.log(`  [${message.role}] ${message.content.slice(0, 60).replace(/\n/g, ' ')}…`);
    return 0;
  }

  if (flags.append) {
    const role = opt(flags.role);
    if (role !== 'user' && role !== 'assistant') { console.error('需要 --role user|assistant'); return 2; }
    const content = opt(flags.file)
      ? fs.readFileSync(path.resolve(flags.file), 'utf8')
      : opt(flags.text);
    if (!content || !content.trim()) { console.error('需要 --file <文件> 或 --text <内容>'); return 2; }
    const message = appendThreadMessage(thread, { role, content: content.trim() });
    writeThread(ROOT, thread);
    console.log(`✓ 已追加 [${role}] 到「${thread.label}」（id ${message.id.slice(0, 8)}…，当前 ${thread.messages.length} 条）`);
    return 0;
  }

  if (flags.plan) {
    const plan = planCompaction(thread, { keepRecent: MIN_RECENT_MESSAGES });
    if (!plan) { console.log('没有可压缩的消息（最近 4 条以外没有未被覆盖的内容）。'); return 0; }
    console.log(`将覆盖 ${plan.messages.length} 条消息（合计 ${plan.sourceCharacters} 字符），保留最近 ${MIN_RECENT_MESSAGES} 条。`);
    console.log(`覆盖后的 coveredMessageIds：${plan.coveredMessageIds.join(', ')}`);
    console.log('\n· 把下面这段交给正在跑的 agent 做摘要，再把结果用 --commit --summary 提交：\n');
    console.log(compactionSource(plan));
    return 0;
  }

  if (flags.commit) {
    const file = opt(flags.summary);
    if (!file) { console.error('需要 --summary <摘要文件>'); return 2; }
    const plan = planCompaction(thread, { keepRecent: MIN_RECENT_MESSAGES });
    if (!plan) { console.log('没有可压缩的消息，未写入记忆。'); return 0; }
    try {
      const record = commitCompaction(thread, plan, fs.readFileSync(path.resolve(file), 'utf8'), opt(flags.model) ?? '');
      writeThread(ROOT, thread);
      console.log(`✓ 记忆已写入：覆盖 ${record.coveredMessageIds.length} 条，${record.sourceCharacters} → ${record.summaryCharacters} 字符`);
      return 0;
    } catch (error) {
      console.error(`✗ ${error.message}`);
      return 1;
    }
  }

  console.error('用法：--show | --append | --plan | --commit | --list | --self-test（详见文件头）');
  return 2;
}

process.exit(main());
