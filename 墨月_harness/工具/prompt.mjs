#!/usr/bin/env node
/**
 * 墨月 Harness · 提示词装配器（交互层载体）
 *
 * 把「域 + 焦点 + 意图 + 作品状态」变成一份可直接交给任意 agent 的完整请求：
 *   node 工具/prompt.mjs --project 状态/作品.json --domain worldbook \
 *        [--focus-area entry] [--focus-target wb-1] [--intent answer|artifact|self-check] \
 *        --input "作者原话" [--out 请求.json] [--out-md 请求.md] [--route-only] [--thread]
 *
 * 维修轮（闸门拦下之后）：
 *   node 工具/prompt.mjs --project 状态/作品.json --domain worldbook --task <上一轮专项> \
 *        --repair 检查结果.json [--previous-artifact 上一版成品.md] --out-md 维修请求.md
 *   · --repair 直接吃 `check.mjs --json --out 结果.json` 的产物；给定时本轮的
 *     `--input` 不再参与（维修只依据错误清单 + 上一版成品），意图默认按 artifact。
 *   · --task 会锁定专项，避免维修轮被重新路由到别处。
 *
 *   node 工具/prompt.mjs --self-test
 *
 * 退出码：0 成功；1 路由失败/自测失败；2 用法错误。
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { preparePrompt, knowledgeIndex, readKnowledge, domainLabel, HARNESS_ROOT } from './lib/prompt.mjs';
import { resolveConversationTask, resolveDelivery, resolvePageTask, requestsArtifact } from './lib/route.mjs';
import { conversationScopeKey } from './lib/threads.mjs';
import { readThread, listThreads, readAttachmentSet } from './lib/pending.mjs';

/** --thread：按 (域, 专项, 焦点) 读该对象的存档，并按墨月规则收集可承接的其他讨论。 */
function makeThreadStore(flags) {
  return {
    excludeMessageId: typeof flags['exclude-message'] === 'string' ? flags['exclude-message'] : undefined,
    read: (scopeKey) => readThread(HARNESS_ROOT, scopeKey),
    readAll: () => listThreads(HARNESS_ROOT),
  };
}

function parseArgs(argv) {
  const out = { flags: {} };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token.startsWith('--')) {
      const key = token.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) { out.flags[key] = next; i += 1; }
      else out.flags[key] = true;
    }
  }
  return out;
}

function emptyProject(overrides = {}) {
  return {
    id: 'p', title: '测试作品', summary: '', characters: [], worldbook: [], rules: [],
    opening: { firstMessage: '', alternateGreetings: [] },
    mvu: { enabled: false, initvarDesign: '', updateRuleDesign: '', initvarSource: '', updateRulesSource: '', schemaSource: '' },
    statusbar: { kind: 'none', requirements: '', contract: '', source: '' },
    frontend: { requirements: '', contract: '', source: '', previewHtml: '', testMessage: '' },
    ejsCharacters: [], materials: [], artifacts: [], importedCard: undefined,
    ...overrides,
  };
}

// ── 自测：路由分支逐条复核 ────────────────────────────────────────────
const CASES = [
  ['路由：原卡资料恒为自由创作', () => resolvePageTask('carddata', emptyProject(), {}, '随便问问') === 'free_creation'],
  ['路由：人物 NPC 关键词', () => resolvePageTask('character', emptyProject({ characters: [{ id: 'c1' }] }), { area: 'basicInformation' }, '帮我写个配角') === 'npc_light_habitat'],
  ['路由：人物实测关键词', () => resolvePageTask('character', emptyProject({ characters: [{ id: 'c1' }] }), {}, '跑卡结果分析') === 'airp_test_diagnosis_router'],
  ['路由：无人物时走起点分流', () => resolvePageTask('character', emptyProject(), {}, '你好') === 'airp_intake_router'],
  ['路由：人物按栏目选专项', () => resolvePageTask('character', emptyProject({ characters: [{ id: 'c1' }] }), { area: 'characterNature' }, '继续') === 'airp_character_nature'],
  ['路由：世界书显式中型', () => resolvePageTask('worldbook', emptyProject(), {}, '要做中型世界观') === 'worldview_medium'],
  ['路由：世界书多档并存走分流', () => resolvePageTask('worldbook', emptyProject(), {}, '中型还是大型好') === 'worldview_scale_router'],
  ['路由：世界书焦点条目带 scale', () => resolvePageTask('worldbook', emptyProject({ worldbook: [{ id: 'w1', scale: 'large' }] }), { targetId: 'w1' }, '继续') === 'worldview_large'],
  ['路由：正文提到国家不能改档', () => resolvePageTask('worldbook', emptyProject(), {}, '这个国家有很多城邦', false, 'worldview_medium') === 'worldview_medium'],
  ['路由：世界书无依据时走规模分流', () => resolvePageTask('worldbook', emptyProject(), {}, '继续写') === 'worldview_scale_router'],
  ['路由：规则与开场白固定', () => resolvePageTask('rules', emptyProject(), {}, 'x') === 'creation_rules' && resolvePageTask('opening', emptyProject(), {}, 'x') === 'opening_style_then_draft'],
  ['路由：MVU 页签优先', () => resolvePageTask('mvu', emptyProject(), { area: 'crossCheck' }, '顺便看下开局值') === 'mvu_cross_check'],
  ['路由：MVU 开局值页签 + 要成品', () => resolvePageTask('mvu', emptyProject(), { area: 'initvarSource' }, '生成文件', true) === 'mvu_initvar_formatting'],
  ['路由：MVU 开局值页签 + 讨论设计', () => resolvePageTask('mvu', emptyProject(), { area: 'initvarSource' }, '讨论一下设计') === 'mvu_initvar_design'],
  ['路由：MVU 无文件时按缺什么推荐', () => resolvePageTask('mvu', emptyProject(), {}, '继续') === 'mvu_schema_compilation'],
  ['路由：MVU 齐全后落到交叉检查', () => {
    const p = emptyProject({ mvu: { enabled: true, schemaSource: 's', initvarDesign: 'a', initvarSource: 'b', updateRuleDesign: 'c', updateRulesSource: 'd' } });
    return resolvePageTask('mvu', p, {}, '继续') === 'mvu_cross_check';
  }],
  ['路由：状态栏规划焦点走需求判定', () => resolvePageTask('statusbar', emptyProject({ statusbar: { kind: 'vue', contract: '技术路线：单 HTML Vue', source: 'x' } }), { area: 'requirements' }, '继续') === 'mvu_statusbar_briefing'],
  ['路由：状态栏按合同路线选 Vue 构建', () => resolvePageTask('statusbar', emptyProject({ statusbar: { kind: 'native', contract: '技术路线：单 HTML Vue', source: 'x' } }), {}, '生成', true) === 'mvu_statusbar_vue_build'],
  ['路由：状态栏 kind 描述源码，无合同时不据其生成', () => resolvePageTask('statusbar', emptyProject({ statusbar: { kind: 'vue', contract: '', source: '' } }), {}, '继续') === 'mvu_statusbar_briefing'],
  ['路由：前端有合同 + 要成品 → 构建', () => resolvePageTask('frontend', emptyProject({ frontend: { contract: '唯一外层标签：`x`' } }), {}, '生成', true) === 'frontend_build'],
  ['路由：前端无合同 → 需求判定', () => resolvePageTask('frontend', emptyProject(), {}, '继续') === 'frontend_briefing'],
  ['路由：EJS 无合同 → 需求判定', () => resolvePageTask('ejs', emptyProject({ ejsCharacters: [{ id: 'e1', contract: '' }] }), {}, '继续') === 'ejs_briefing'],
  ['路由：EJS 有合同 + 要成品 → 构建', () => resolvePageTask('ejs', emptyProject({ ejsCharacters: [{ id: 'e1', contract: 'c' }] }), {}, '生成', true) === 'ejs_build'],
  ['承接：规模分流给出结论才换档', () => resolveConversationTask('worldbook', emptyProject(), {}, '继续', false, 'worldview_scale_router', false, '世界观规模：中型')?.task === 'worldview_medium'],
  ['承接：锁定会话时只提示不擅换', () => {
    const r = resolveConversationTask('character', emptyProject({ characters: [{ id: 'c1' }] }), { area: 'basicInformation' }, '帮我写个配角', false, 'airp_basic_information', true);
    return r.task === 'airp_basic_information' && r.suggestedTask === 'npc_light_habitat';
  }],
  ['闸门：交叉检查与规模分流在无批量通道的域里确实被拦', () => !resolveDelivery('rules', 'mvu_cross_check', { explicitIntent: 'artifact' }).artifactIntent && !resolveDelivery('frontend', 'worldview_scale_router', { explicitIntent: 'artifact' }).artifactIntent],
  ['闸门（墨月原样）：世界书/MVU 域的批量通道会旁路该禁项', () => {
    // 忠实复刻：AssistantPanel 的条件是 Boolean(batchScope) || 非禁项，
    // 而 batchScope 在 worldbook/mvu 的 agent 轮恒为真 —— 该禁项在这两个域实际失效。
    // 真正的约束来自专项合同（cross_check 只报告不产第四份文件），不是闸门。
    return resolveDelivery('mvu', 'mvu_cross_check', { explicitIntent: 'artifact' }).artifactIntent === true
      && resolveDelivery('worldbook', 'worldview_scale_router', { explicitIntent: 'artifact' }).artifactIntent === true;
  }],
  ['闸门：作品设置与导出永不出片', () => !resolveDelivery('overview', 'free_creation', { explicitIntent: 'artifact' }).artifactIntent && !resolveDelivery('package', 'free_creation', { explicitIntent: 'artifact' }).artifactIntent],
  ['闸门：未声明意图时按输入推断', () => resolveDelivery('worldbook', 'worldview_small', { userInput: '帮我生成一份小型世界观' }).permission === 'artifact'],
  ['闸门：显式 answer 压过正则推断', () => resolveDelivery('worldbook', 'worldview_small', { explicitIntent: 'answer', userInput: '帮我生成一份小型世界观' }).permission === 'answer'],
  ['闸门：自查走 self-check 权限', () => resolveDelivery('mvu', 'mvu_initvar_formatting', { explicitIntent: 'self-check' }).permission === 'self-check'],
  ['闸门：世界书/MVU 出片时开批量通道', () => resolveDelivery('worldbook', 'worldview_small', { explicitIntent: 'artifact' }).batch === 'worldbook'],
  ['推断：否定分句不算成品请求', () => !requestsArtifact('先不要生成，我们再讨论一下')],
  ['推断：疑问句不算成品请求', () => !requestsArtifact('为什么还没有生成成品？')],
  ['知识库：75 个条目全部可读且非空', () => {
    const index = knowledgeIndex();
    if (index.size !== 75) return false;
    const empty = [...index.keys()].filter((id) => {
      if (id === 'oldAssistantPrefill') return false;
      const entry = readKnowledge(id);
      const hasSomething = Boolean(entry.knowledge || entry.examples || entry.contract);
      if (id === '00_任务变量初始化') return false; // 酒馆宏残留，正文本来就是空的
      return !hasSomething;
    });
    if (empty.length) { console.log('     空条目：' + empty.join(', ')); return false; }
    return true;
  }],
  ['知识库：28 条专项都带合同', () => {
    const index = knowledgeIndex();
    return [...index.keys()].filter((id) => readKnowledge(id).contract).length === 28;
  }],
  ['知识库：脚本工坊专项走「业务边界 + 必测」', () => {
    const entry = readKnowledge('shop');
    return entry.knowledge.includes('整笔交易') && entry.knowledge.includes('必测') && entry.meta.domain === '脚本工坊';
  }],
  ['装配：answer 权限不含交付尾部、artifact 含', () => {
    const project = emptyProject({ worldbook: [{ id: 'w1', title: '甲', content: 'x', keys: [], secondaryKeys: [], activation: 'always', placement: 'before_character', depth: 0, order: 1, probability: 100, enabled: true, scale: 'small' }] });
    const answer = preparePrompt({ project, domain: 'worldbook', focus: { targetId: 'w1' }, userInput: '这个设定怎么样', intent: 'answer' });
    const artifact = preparePrompt({ project, domain: 'worldbook', focus: { targetId: 'w1' }, userInput: '生成完整条目', intent: 'artifact' });
    return answer.system.includes('permission="answer"') && !answer.system.includes('qk_workshop_controller')
      && artifact.system.includes('permission="artifact"') && artifact.system.includes('qk_workshop_controller')
      && artifact.system.includes('agent_batch_delivery');
  }],
  ['装配：知识正文与合同同时注入且互不冒充', () => {
    const project = emptyProject({ worldbook: [{ id: 'w1', title: '甲', content: 'x', keys: [], secondaryKeys: [], activation: 'always', placement: 'before_character', depth: 0, order: 1, probability: 100, enabled: true, scale: 'small' }] });
    const { system } = preparePrompt({ project, domain: 'worldbook', focus: { targetId: 'w1' }, userInput: '生成', intent: 'artifact' });
    return system.includes('<page_knowledge>') && system.includes('<workshop_task id="worldview_small"')
      && system.includes('唯一有效的任务合同位于 active_workshop_task')
      && system.includes('<current_worldbook') && system.includes('<qk_current_request>') === false;
  }],
  ['装配：末条消息是本轮请求且含直达尾指令', () => {
    const project = emptyProject({ worldbook: [{ id: 'w1', title: '甲', content: 'x', keys: [], secondaryKeys: [], activation: 'always', placement: 'before_character', depth: 0, order: 1, probability: 100, enabled: true, scale: 'small' }] });
    const { messages } = preparePrompt({ project, domain: 'worldbook', focus: { targetId: 'w1' }, userInput: '作者原话', intent: 'answer' });
    const last = messages.at(-1);
    return last.role === 'user' && last.content.includes('<qk_current_request>') && last.content.includes('作者原话') && last.content.includes('/workshop-direct');
  }],
  ['装配：未知域明确报错', () => {
    try { preparePrompt({ project: emptyProject(), domain: '不存在的域', userInput: 'x', intent: 'answer' }); return false; }
    catch (error) { return /没有可用的专项/.test(error.message); }
  }],
  ['装配：overview 与 package 路由到自由创作助手但绝不出片', () => {
    const a = preparePrompt({ project: emptyProject(), domain: 'overview', userInput: 'x', intent: 'artifact' });
    const b = preparePrompt({ project: emptyProject(), domain: 'package', userInput: 'x', intent: 'artifact' });
    return a.route.task === 'free_creation' && b.route.task === 'free_creation'
      && !a.route.delivery.artifactIntent && !b.route.delivery.artifactIntent
      && a.system.includes('permission="answer"');
  }],
];

function selfTest() {
  let failed = 0;
  for (const [name, run] of CASES) {
    let ok = false; let detail = '';
    try { ok = run() === true; } catch (error) { detail = String(error?.message ?? error); }
    if (!ok) failed += 1;
    console.log(`${ok ? '  ✓' : '  ✗'} ${name}${detail ? `  ← ${detail}` : ''}`);
  }
  console.log(`\n${failed ? '✗' : '✓'} 装配器自测 ${CASES.length - failed}/${CASES.length} 通过`);
  return failed ? 1 : 0;
}

function main() {
  const { flags } = parseArgs(process.argv.slice(2));
  if (flags['self-test']) return selfTest();

  if (!flags.project || flags.project === true) { console.error('缺少 --project <作品.json>'); return 2; }
  if (!flags.domain || flags.domain === true) { console.error('缺少 --domain <域>'); return 2; }
  const project = JSON.parse(fs.readFileSync(path.resolve(flags.project), 'utf8'));
  const focus = {
    targetId: flags['focus-target'] && flags['focus-target'] !== true ? flags['focus-target'] : undefined,
    area: flags['focus-area'] && flags['focus-area'] !== true ? flags['focus-area'] : undefined,
    label: flags['focus-label'] && flags['focus-label'] !== true ? flags['focus-label'] : undefined,
  };
  const userInput = flags.input && flags.input !== true ? flags.input : '';

  // --task：锁定专项（维修轮必须用；空输入会让路由飘走）。
  const pinnedTask = flags.task && flags.task !== true ? flags.task : '';

  // --repair <检查结果.json>：维修轮。接受 check.mjs --json 的产物。
  let repair;
  if (flags.repair && flags.repair !== true) {
    let raw;
    try { raw = JSON.parse(fs.readFileSync(path.resolve(flags.repair), 'utf8')); }
    catch (error) { console.error(`✗ 读不了 --repair 的结果文件：${error.message}`); return 2; }
    const previousFromFlag = flags['previous-artifact'] && flags['previous-artifact'] !== true
      ? fs.readFileSync(path.resolve(flags['previous-artifact']), 'utf8') : '';
    repair = {
      diagnostics: Array.isArray(raw.diagnostics) ? raw.diagnostics : undefined,
      issues: Array.isArray(raw.issues) ? raw.issues : undefined,
      // check.mjs --json 会把"本地已补全结构"后的成品一并带出来；优先用它，
      // 否则维修轮会拿到未经归一化的原文。
      previousArtifact: typeof raw.content === 'string' && raw.content ? raw.content : previousFromFlag,
    };
    if (!repair.diagnostics && !repair.issues) { console.error('✗ --repair 的结果文件里既没有 diagnostics 也没有 issues。'); return 2; }
  }

  // 维修轮重新交付整份成品，因此默认按 artifact 算权限（显式 --intent 仍可压过）。
  const intent = (flags.intent && flags.intent !== true ? flags.intent : undefined) ?? (repair ? 'artifact' : undefined);

  // --attach-set：带上该轮的附件（图片以路径交付，见 工具/attach.mjs）。
  let attachments = [];
  let requestInput = userInput;
  if (flags['attach-set'] && flags['attach-set'] !== true) {
    const set = readAttachmentSet(HARNESS_ROOT, flags['attach-set']);
    attachments = set.attachments;
    if (!requestInput) requestInput = set.authorRequest;
  }

  let prepared;
  try {
    prepared = preparePrompt({
      project, domain: flags.domain, focus, userInput: requestInput, intent,
      attachments,
      preferredTaskId: flags['preferred-task'] && flags['preferred-task'] !== true ? flags['preferred-task'] : '',
      taskId: pinnedTask,
      repair,
      lockExistingConversation: Boolean(flags.lock),
      previousAnswer: flags['previous-answer'] && flags['previous-answer'] !== true ? flags['previous-answer'] : '',
      // --thread：带上该作者对象的会话存档与同对象的其他专项讨论（见 工具/thread.mjs）。
      threadStore: flags.thread ? makeThreadStore(flags) : undefined,
    });
  } catch (error) { console.error(`✗ ${error.message}`); return 1; }

  const { route } = prepared;
  console.log(`域：${route.domain}（${domainLabel(route.domain)}）`);
  console.log(`专项：${route.task}`);
  console.log(`权限：${route.delivery.permission}｜出片：${route.delivery.artifactIntent ? '是' : '否'}｜批量：${route.delivery.batch ?? '无'}｜纯输出：${route.delivery.pureOutput ? '是' : '否'}`);
  if (!repair) console.log(`推断：${route.delivery.inferred ? '识别为成品请求' : '非成品请求'}`);
  if (repair) {
    const list = repair.diagnostics ?? repair.issues ?? [];
    const blocking = list.filter((item) => typeof item === 'string' || item.severity === 'error').length;
    console.log(`本轮：维修轮（依据错误清单 + 上一版成品；本轮 --input 已忽略，阻断问题 ${blocking} 条）`);
  }

  if (flags['route-only']) return 0;

  const payload = {
    model_request: { system: prepared.system, messages: prepared.messages },
    route: { domain: route.domain, task: route.task, permission: route.delivery.permission, artifactIntent: route.delivery.artifactIntent, batch: route.delivery.batch ?? null },
  };
  if (flags['out-md'] && flags['out-md'] !== true) {
    // 可读形态：system 与 messages 逐行可读，不受 JSON 单行化影响——agent 直接消费这一份。
    const md = [
      `<!-- route: domain=${route.domain} task=${route.task} permission=${route.delivery.permission} artifactIntent=${route.delivery.artifactIntent} batch=${route.delivery.batch ?? 'none'} -->`,
      '', '# system', '', prepared.system, '', '# messages', '',
      ...prepared.messages.map((message, index) => `## ${index + 1}. ${message.role}\n\n${typeof message.content === 'string' ? message.content : '(多模态内容)'}\n`),
    ].join('\n');
    fs.mkdirSync(path.dirname(path.resolve(flags['out-md'])), { recursive: true });
    fs.writeFileSync(path.resolve(flags['out-md']), md, 'utf8');
    console.log(`\n✓ 已写出可读请求：${path.resolve(flags['out-md'])}（system ${prepared.system.length} 字符 / ${prepared.messages.length} 条消息）`);
  }
  if (flags.out && flags.out !== true) {
    fs.mkdirSync(path.dirname(path.resolve(flags.out)), { recursive: true });
    fs.writeFileSync(path.resolve(flags.out), `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    console.log(`\n✓ 已写出请求：${path.resolve(flags.out)}（system ${prepared.system.length} 字符 / ${prepared.messages.length} 条消息）`);
  } else {
    console.log(`\n───── system（${prepared.system.length} 字符）─────\n${prepared.system}`);
    console.log(`\n───── messages（${prepared.messages.length} 条）─────`);
    for (const message of prepared.messages) console.log(`[${message.role}]\n${typeof message.content === 'string' ? message.content : '(多模态)'}\n`);
  }
  return 0;
}

process.exit(main());
