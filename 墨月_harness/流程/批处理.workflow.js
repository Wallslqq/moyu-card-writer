/**
 * 墨月 Harness · 批处理层 workflow 编排（等价 moyu_prepare_batch 的 fan-out 版本）
 *
 * 用法：把它作为 `workflow` 工具的 script 传入，args 形如：
 *   {
 *     "project": "工具/fixtures/project.fixture.json",
 *     "section": "worldbook",
 *     "items": [
 *       { "taskId": "worldview_medium", "title": "钟楼", "targetId": null, "brief": "整点报时，钟声覆盖半城" },
 *       { "taskId": "worldview_medium", "title": "码头", "targetId": null, "brief": "货运集散，鱼市与暗巷并存" }
 *     ]
 *   }
 *
 * 三层结构与墨月一致：
 *   ① 逐项生成（pipeline，无 barrier）——每项独立产出完整成品
 *   ② 逐项自校验——每项成品先过 harness 的确定性校验器
 *   ③ 整组准备（单个 agent）——写 items JSON 并调用 pack --prepare-batch，得到待确认稿
 *
 * 两层校验不可互相替代（实跑得出的结论）：
 *   · 逐项 check 只看"这一份成品自身是否合法"；
 *   · 整组准备额外要求"每个 item 恰好一个条目"，且任意一项失败则整批不写。
 *   因此每项的提示词必须显式写清整组规则，否则模型很容易把多个条目塞进一个 item。
 *
 * 注意：workflow 脚本本身没有文件系统与 shell，所有读写与校验都由 agent 完成。
 */

phase('逐项生成');

const HARNESS = '墨月_harness';
const section = args.section ?? 'worldbook';
const project = args.project ?? `${HARNESS}/工具/fixtures/project.fixture.json`;
const items = args.items ?? [];

log(`批处理 ${section}：${items.length} 项`);

const ITEM_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'content', 'selfCheckPassed', 'selfCheckNote'],
  properties: {
    title: { type: 'string' },
    content: { type: 'string' },
    selfCheckPassed: { type: 'boolean' },
    selfCheckNote: { type: 'string' },
  },
};

function itemPrompt(item, index) {
  const file = `${HARNESS}/验收/batch-item-${index + 1}.md`;
  return [
    '你是墨月写卡 harness 的专项执行者。工作目录 C:\\AI\\DSH_workplace\\酒馆。',
    '',
    '本轮是【批处理】（等价墨月的 moyu_prepare_batch）：整组一起准备，作者确认后一起写入。',
    `批处理契约见 ${HARNESS}/流程/批处理层.md，专项知识与合同见 ${HARNESS}/知识库/ 下对应文件。`,
    '',
    '本项信息：',
    `- taskId: ${item.taskId}`,
    `- 标题: ${item.title}`,
    item.targetId
      ? `- 修改已有条目 targetId: ${item.targetId}（只提交完整正文，保留原名称与发送设置）`
      : '- 新增条目（正文 + 配对 YAML 配置）',
    `- 作者已确认的创意要点: ${item.brief ?? '（无，按合同处理）'}`,
    '',
    '要求：',
    `1. 先读取该 taskId 对应的知识文件（${HARNESS}/知识库/ 下按域分目录），严格按其中的合同与知识产出。`,
    '2. 【批处理独有硬规则】本项（这一个 item）必须**恰好包含一个**世界书条目：一个 text 正文代码块 + 一个按「对应标签」配对的 yaml 配置块。',
    '   若你认为需要多个条目，不要塞进本项：只产出本项这一个，并在 selfCheckNote 里写明「另需 N 条，建议追加 items」。',
    '   注意：逐项 check **不会**拦这件事（worldview_medium 允许正文多块），但整组准备会因此拒绝整批。',
    `3. 把成品写入临时文件 ${file}。`,
    `4. 然后运行校验：node ${HARNESS}/工具/check.mjs ${item.taskId} --file ${file}`,
    '5. 如果校验报错，按四段式处方**只修被点名的问题**，重写文件并重新校验，直到通过。',
    `6. 自查整组规则：yaml 配置里的「条目名称」应与本项标题「${item.title}」一致或同族，且正文代码块数量必须为 1。`,
    '7. 不要声称已经写入作品或在酒馆运行通过。',
    '',
    '返回：title（条目名称）、content（成品全文）、selfCheckPassed（校验是否通过）、selfCheckNote（校验输出摘要）。',
  ].join('\n');
}

const generated = await pipeline(items, async (_prev, item, index) => {
  const result = await agent(itemPrompt(item, index), { label: `生成：${item.title}`, phase: '逐项生成', schema: ITEM_SCHEMA });
  if (!result) return null;
  return { ...result, taskId: item.taskId, targetId: item.targetId ?? null };
});

const ok = generated.filter(Boolean);
const failedItems = generated.map((r, i) => (r ? null : items[i] && items[i].title)).filter(Boolean);
log(`生成完成：${ok.length}/${items.length}${failedItems.length ? `（失败：${failedItems.join('、')}）` : ''}`);

phase('整组校验与待确认');

const PREPARE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['prepared', 'pendingId', 'rawOutput'],
  properties: {
    prepared: { type: 'boolean' },
    pendingId: { type: 'string' },
    rawOutput: { type: 'string' },
  },
};

const itemsJson = JSON.stringify(
  ok.map((item) => ({
    taskId: item.taskId,
    ...(item.targetId ? { targetId: item.targetId } : {}),
    title: item.title,
    content: item.content,
  })),
  null,
  2,
);

const preparePrompt = [
  '你是墨月写卡 harness 的整组准备执行者。工作目录 C:\\AI\\DSH_workplace\\酒馆。',
  '',
  `下面是一批已经逐项生成并自校验过的成品。请原样写入 ${HARNESS}/验收/batch.items.json（不要改动内容）：`,
  '',
  '```json',
  itemsJson,
  '```',
  '',
  '然后运行整组准备：',
  '',
  `node ${HARNESS}/工具/pack.mjs --prepare-batch --project ${project} --section ${section} --items ${HARNESS}/验收/batch.items.json`,
  '',
  '把实际终端输出原样放进 rawOutput。若整组检查失败，说明哪一项失败以及原因，prepared 填 false、pendingId 填空串。',
  '若成功，pendingId 填输出里的待确认稿 id。**不要**执行 --apply（写入必须由作者确认）。',
].join('\n');

const prepared = await agent(preparePrompt, { label: '整组准备', phase: '整组校验与待确认', schema: PREPARE_SCHEMA });

log(prepared && prepared.prepared ? `整组准备成功：${prepared.pendingId}` : '整组准备未通过');

return {
  section,
  requested: items.length,
  generated: ok.length,
  failedItems,
  selfCheck: ok.map((item) => ({ title: item.title, passed: item.selfCheckPassed, note: item.selfCheckNote })),
  prepared: (prepared && prepared.prepared) || false,
  pendingId: (prepared && prepared.pendingId) || '',
  prepareOutput: (prepared && prepared.rawOutput) || '',
};
