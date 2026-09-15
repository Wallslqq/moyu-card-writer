/**
 * 卡片档案层：开卡过程的**项目级事实源 + 进程状态**。
 *
 * 两层结构（借鉴 tavern-cards 的「创作规划.yaml + state.json」双文件分工）：
 *   · `_规划.md` —— 项目级**事实源**：这张卡要长什么样。只记决策，不写正文。
 *                   **任何修改必须先改规划，再改正文**（tavern-cards 的铁律）。
 *   · `_进度.md` —— 进程状态：做到哪了、下一步能干什么。带机器可读标记。
 *
 * 为什么需要它们：墨月网页版靠三栏 UI 记住"当前页面／当前页签"，DSH 没有 UI。
 * 缺这一层时 agent 只能凭对话记忆推进，表现为漏条目、跳步骤、反复纠结归类
 * （2026-09-15 实测踩到）。
 *
 * 与作品工程 JSON 的分界：
 *   · card 档案 = 进程层。人类可读，agent 可直接写，**不构成成品交付**。
 *   · 工程 JSON = 唯一账本。仍只有 `pack --apply` 能改。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const HARNESS_ROOT = path.resolve(HERE, '..', '..');
export const PROJECT_DIR = path.join(HARNESS_ROOT, '状态', '作品');

/**
 * 卡片档案根 = 工具所在仓库的根（`<harness>/..`），**不用 process.cwd()**。
 *
 * 每次 pwsh 都是全新进程，cwd 不保证等于会话工作区根；一旦算出的路径落在
 * 沙箱边界外就会被拒（2026-09-15 实测踩到，且被误判成"ACL 拒绝"）。
 * 工具在哪，"card" 就跟着在哪，与 cwd 无关。
 */
let cardRootOverride;
/** 传路径则覆盖；传 undefined／null 则**清除**覆盖（回到按工具位置推导）。 */
export function setCardRoot(override) {
  cardRootOverride = override ? path.resolve(override) : undefined;
}
export function cardRoot() {
  if (cardRootOverride) return cardRootOverride;
  if (process.env.MOYU_CARD_ROOT) return path.resolve(process.env.MOYU_CARD_ROOT);
  return path.resolve(HARNESS_ROOT, '..', 'card');
}

/** 人物五栏。顺序来自知识库四处写死的拼接顺序。 */
export const CHARACTER_AREAS = [
  { id: 'basicInformation', label: '基础信息', order: 1, required: true, knowledge: 'airp_basic_information' },
  { id: 'clothingStyle', label: '穿衣风格', order: 2, required: false, optional: true, knowledge: 'airp_clothing_style' },
  { id: 'lifeStructure', label: '生活结构', order: 3, required: false, knowledge: 'airp_life_structure' },
  { id: 'characterNature', label: '人物性情', order: 4, required: false, knowledge: 'airp_character_nature' },
  { id: 'sceneExpression', label: '场景表达', order: 5, required: false, knowledge: 'airp_scene_expression' },
];

/** 第六栏「测试笔记」只在真机实测后由诊断专项回流，不属开卡。 */
export const TEST_NOTES_AREA = { id: 'notes', label: '测试笔记', knowledge: 'airp_test_diagnosis_router' };

/** 八个模块目录。次序与 status.mjs 的 WORK_ORDER 一致。 */
export const MODULES = [
  { key: 'character', label: '人物', dir: '人物' },
  { key: 'worldbook', label: '世界书', dir: '世界书' },
  { key: 'rules', label: '创作规则', dir: '创作规则' },
  { key: 'opening', label: '开场白', dir: '开场白' },
  { key: 'mvu', label: 'MVU 变量', dir: 'MVU' },
  { key: 'statusbar', label: '状态栏', dir: '状态栏' },
  { key: 'frontend', label: '消息前端', dir: '前端' },
  { key: 'ejs', label: 'EJS 工件', dir: 'EJS' },
];

const PLANNING_NAME = '_规划.md';
const PROGRESS_NAME = '_进度.md';
const INDEX_NAME = '_索引.md';
const README_NAME = 'README.md';

/**
 * 「未定项」标记：[待细化]。
 *
 * 不用 [待细化] 那种写法——`#` 是 Markdown 标题符，直接写在正文里既不整齐，
 * 也让"计数"没法把**真标记**和模板说明行区分开（旧实现把自己模板里的示例算成了 1 处，
 * 2026-09-15 实测踩到，计数永远不归零）。
 * 现在标记是方括号形式，出现在行首或列表项之后才算；模板说明里提到它时不是这个形态。
 */
export const REFINE_MARK = '[待细化]';

/**
 * 计数：只认"**行首**"或"**列表项／表格单元之后**"出现的标记。
 *
 * 判定方式不看标记紧跟什么，而是看**它前面这一小段**：若从行首到标记之间出现过
 * `- ` 或 `|`（列表项／表格单元），或者中间根本没有别的汉字（纯行首），就算数。
 * 这样 `- [待细化]`、`- 规模判断：[待细化]`、`| [待细化] |` 都算，
 * 而说明行里"未定项写 [待细化]；本行提到它但不算数"不算。
 */
const REFINE_MARK_LEN = REFINE_MARK.length;
function countInLine(line) {
  let count = 0;
  let from = 0;
  for (;;) {
    const at = line.indexOf(REFINE_MARK, from);
    if (at < 0) break;
    const head = line.slice(0, at);
    const isListOrCell = /(?:^|\s)-\s[^|]*$/.test(head) || /\|/.test(head);
    const isBareHead = !/[\u4e00-\u9fff]/.test(head);
    if (isListOrCell || isBareHead) count += 1;
    from = at + REFINE_MARK_LEN;
  }
  return count;
}
const EXPORT_DIR = '导出';

export const MARK_START = '<!-- moyu-progress';
export const MARK_END = 'moyu-progress -->';

export const AREA_DONE = 'done';
export const AREA_SKIPPED = 'skipped';
export const AREA_TODO = 'todo';
const AREA_MARK = { [AREA_DONE]: '■', [AREA_SKIPPED]: '－', [AREA_TODO]: '□' };

const orderPrefix = (order) => String(order).padStart(2, '0');

// ── 路径 ─────────────────────────────────────────────────────────────
export const cardDir = (title) => path.join(cardRoot(), title);
export const planningFile = (title) => path.join(cardDir(title), PLANNING_NAME);
export const progressFile = (title) => path.join(cardDir(title), PROGRESS_NAME);

export function areaFile(title, character, areaId) {
  const area = CHARACTER_AREAS.find((one) => one.id === areaId || one.label === areaId);
  if (!area) throw new Error(`未知栏位：${areaId}`);
  return path.join(cardDir(title), '人物', character, `${orderPrefix(area.order)} ${area.label}.md`);
}
export const worldbookFile = (title, entry) => path.join(cardDir(title), '世界书', `${entry}.md`);
export function moduleFile(title, moduleKey) {
  const module = MODULES.find((one) => one.key === moduleKey);
  if (!module) throw new Error(`未知模块：${moduleKey}`);
  return path.join(cardDir(title), module.dir, `${module.label}.md`);
}

// ── 状态 ─────────────────────────────────────────────────────────────
export function parseProgress(text) {
  const start = text.indexOf(MARK_START);
  if (start < 0) return undefined;
  const end = text.indexOf(MARK_END, start);
  if (end < 0) return undefined;
  try {
    return JSON.parse(text.slice(start + MARK_START.length, end).trim());
  } catch {
    return undefined;
  }
}

export const serializeProgress = (state) => `${MARK_START}\n${JSON.stringify(state, null, 2)}\n${MARK_END}`;

const freshAreas = () => Object.fromEntries(CHARACTER_AREAS.map((area) => [area.id, AREA_TODO]));

/** 规划状态。`mode` 对应 tavern-cards 的"对齐模式"，在开卡第一轮问作者。 */
export const ALIGN_MODES = {
  unset: { label: '未定', hint: '还没问作者' },
  rough: { label: '粗略规划', hint: '细节留到创作时确认' },
  full: { label: '一次确认', hint: '一开始就把信息定齐' },
};

function freshState(title) {
  const now = new Date().toISOString();
  return {
    version: 2,
    title,
    /** 规划层：**先谈定全局，再动笔** */
    planning: { mode: 'unset', confirmed: false, refinements: 0 },
    activeModule: 'character',
    activeItem: undefined,
    modules: {
      character: { items: {} },
      worldbook: { blueprintConfirmed: false, items: {} },
      rules: { done: false },
      opening: { done: false },
      mvu: { done: false },
      statusbar: { done: false },
      frontend: { done: false },
      ejs: { done: false },
    },
    createdAt: now,
    updatedAt: now,
  };
}

export function readState(title) {
  const file = progressFile(title);
  if (!fs.existsSync(file)) return undefined;
  return parseProgress(fs.readFileSync(file, 'utf8'));
}

export const isCharacterSettled = (areas) => CHARACTER_AREAS.every((area) => (areas[area.id] ?? AREA_TODO) !== AREA_TODO);
export const progressBar = (areas) => CHARACTER_AREAS.map((area) => AREA_MARK[areas[area.id] ?? AREA_TODO]).join('');

// ── 渲染 ─────────────────────────────────────────────────────────────
/** 数 `_规划.md` 里真正待补的未定项。模板说明行不算（见 countInLine）。 */
export function countRefinements(title) {
  const file = planningFile(title);
  if (!fs.existsSync(file)) return 0;
  const text = fs.readFileSync(file, 'utf8');
  if (!text.includes(REFINE_MARK)) return 0;
  return text.split('\n').reduce((sum, line) => sum + countInLine(line), 0);
}

function renderPlanning(state, title) {
  const { mode, confirmed } = state.planning;
  const refinements = countRefinements(title);
  const lines = ['## 规划（`_规划.md`）', ''];
  lines.push(`- 对齐模式：**${ALIGN_MODES[mode]?.label ?? mode}**${mode === 'unset' ? '　← 尚未问作者，开卡第一轮必问' : `（${ALIGN_MODES[mode]?.hint ?? ''}）`}`);
  lines.push(`- 规划定稿确认：${confirmed ? '✅ 已确认' : '❌ 未确认'}`);
  lines.push(`- 未定项 \`[待细化]\`：${refinements} 处${refinements ? '　← 创作阶段遇到必须先追问作者' : '（没有未定项）'}`);
  if (!confirmed) {
    lines.push('');
    lines.push('> **规划未确认通过前，不许开始写任何正文条目。** 先把 `_规划.md` 补全，再请作者确认。');
  }
  lines.push('');
  return lines.join('\n');
}

export function renderProgress(state) {
  const characters = state.modules.character.items;
  const names = Object.keys(characters);
  const settled = names.filter((name) => isCharacterSettled(characters[name].areas)).length;
  const worldbook = state.modules.worldbook;
  const wbNames = Object.keys(worldbook.items);

  const lines = [];
  lines.push(`# 进度 · ${state.title}`);
  lines.push('');
  lines.push('> 本文件是开卡流程的**进程状态**。**每轮开工先读这里**，不要凭对话记忆推进。');
  lines.push('> 规划与决策在 `_规划.md`（项目级事实源）。**改任何正文前，先改规划。**');
  lines.push('>');
  lines.push('> `■` 已填　`－` 作者确认无需　`□` 待定　　（方框只统计人物五栏）');
  lines.push('');
  lines.push(renderPlanning(state, state.title));

  lines.push(`## 模块一 · 人物（${names.length} 人，${settled} 人已闭合）`);
  lines.push('');
  if (!names.length) {
    lines.push('（还没有人物。收到材料后由 agent 直接建档，不需要作者手动新建。）');
    lines.push('');
  } else {
    lines.push('| 人物 | 五栏 | 已完成 | 待办 |');
    lines.push('|---|---|---|---|');
    for (const name of names) {
      const item = characters[name];
      const done = CHARACTER_AREAS.filter((area) => item.areas[area.id] === AREA_DONE).map((area) => area.label);
      const todo = CHARACTER_AREAS.filter((area) => (item.areas[area.id] ?? AREA_TODO) === AREA_TODO).map((area) => area.label);
      const skipped = CHARACTER_AREAS.filter((area) => item.areas[area.id] === AREA_SKIPPED).length;
      const todoText = todo.length ? todo.join('、') : (skipped ? `已闭合（${skipped} 栏确认无需）` : '已闭合');
      lines.push(`| ${name}${state.activeItem === name ? ' ←当前' : ''} | ${progressBar(item.areas)} | ${done.join('、') || '（无）'} | ${todoText} |`);
    }
    lines.push('');
  }

  lines.push(`## 模块二 · 世界书（${wbNames.length} 条，蓝图${worldbook.blueprintConfirmed ? '已确认' : '未确认'}）`);
  lines.push('');
  if (!wbNames.length) {
    lines.push('（尚未建立条目。先出蓝图给作者确认，再由 agent 建条目。）');
  } else {
    lines.push('| 条目 | 状态 |');
    lines.push('|---|---|');
    for (const name of wbNames) lines.push(`| ${name} | ${worldbook.items[name].done ? '已完成' : '待撰写'} |`);
  }
  lines.push('');

  lines.push('## 模块三之后');
  lines.push('');
  lines.push('| 模块 | 状态 |');
  lines.push('|---|---|');
  for (const module of MODULES.slice(2)) {
    lines.push(`| ${module.label} | ${state.modules[module.key]?.done ? '✅ 已完成' : '未完成'} |`);
  }
  lines.push('');

  lines.push('## 当前可做');
  lines.push('');
  lines.push(...renderNextActions(state));
  lines.push('');

  lines.push(serializeProgress(state));
  lines.push('');
  return lines.join('\n');
}

/** 「当前可做」：每轮回复都必须照抄这段，回答"现在在哪、下一步能干什么"。 */
export function renderNextActions(state) {
  const actions = [];
  const { mode, confirmed } = state.planning;

  if (mode === 'unset') {
    actions.push('· **开卡第一轮：先问作者对齐模式**（粗略规划／一次确认）');
    actions.push('· 然后把 `_规划.md` 补到与模式相称的完整度，请作者确认');
    actions.push('· 规划未确认前，不许开始写正文条目');
    actions.push('· 随时说「审阅」，agent 给出当前全部档案的 unified diff');
    return actions;
  }
  if (!confirmed) {
    actions.push('· **规划尚未确认**：补全 `_规划.md` 并请作者确认');
    actions.push('· 随时说「审阅」，agent 给出当前全部档案的 unified diff');
    return actions;
  }

  const characters = state.modules.character.items;
  const names = Object.keys(characters);
  const current = state.activeItem && characters[state.activeItem] ? state.activeItem : undefined;

  if (!names.length) {
    actions.push('· 人物模块还没开始：先与作者讨论**总体名单**（几个人、都是谁、各自位置、粒度）');
  } else if (current) {
    const item = characters[current];
    const area = CHARACTER_AREAS.find((one) => (item.areas[one.id] ?? AREA_TODO) === AREA_TODO);
    if (area) actions.push(`· 继续 ${current} 的「${area.label}」`);
    const rest = CHARACTER_AREAS.filter((one) => (item.areas[one.id] ?? AREA_TODO) === AREA_TODO && one !== area);
    if (rest.length) actions.push(`· 或跳到 ${current} 的「${rest[0].label}」`);
    if (isCharacterSettled(item.areas)) actions.push(`· 「${current} 就这样，下一个人物」`);
    else actions.push(`· 或「${current} 先到这里，换人」`);
  } else {
    const open = names.filter((name) => !isCharacterSettled(characters[name].areas));
    if (open.length) actions.push(`· 选一位继续：${open.join('、')}`);
  }

  const worldbook = state.modules.worldbook;
  const anyOpen = names.some((name) => !isCharacterSettled(characters[name].areas));
  if (!anyOpen && names.length) {
    if (!Object.keys(worldbook.items).length) actions.push('· 人物模块已闭合 → 进世界书：先出**蓝图**给作者确认');
    else if (!worldbook.blueprintConfirmed) actions.push('· 等待作者确认世界书蓝图');
    else {
      const pending = Object.keys(worldbook.items).filter((name) => !worldbook.items[name].done);
      if (pending.length) actions.push(`· 撰写世界书条目：${pending.join('、')}`);
      else actions.push('· 世界书已完成 → 依次进创作规则／开场白／MVU／状态栏／前端／EJS');
    }
  }

  actions.push('· 随时说「审阅」，agent 给出当前全部档案的 unified diff');
  return actions;
}

function renderIndex(state) {
  const lines = [`# ${state.title} · 档案索引`, '', '| 模块 | 条目 | 状态 |', '|---|---|---|'];
  const characters = state.modules.character.items;
  for (const name of Object.keys(characters)) {
    const have = CHARACTER_AREAS.filter((area) => characters[name].areas[area.id] === AREA_DONE).map((area) => area.label);
    lines.push(`| 人物 | ${name} | ${have.join('、') || '尚无材料'} |`);
  }
  for (const name of Object.keys(state.modules.worldbook.items)) {
    lines.push(`| 世界书 | ${name} | ${state.modules.worldbook.items[name].done ? '已完成' : '待撰写'} |`);
  }
  if (lines.length === 4) lines.push('| — | — | 还没有任何条目 |');
  lines.push('');
  return lines.join('\n');
}

function renderReadme(title) {
  return `# ${title} · 档案说明

这份档案是开卡过程的**项目记录**，人类可读。它与作品工程 JSON 是两层：

- **本档案（card 档案）**：规划、材料与进度。agent 可直接落盘，随时可看、可改。
- **作品工程 JSON**（\`墨月_harness\\状态\\作品\\${title}.json\`）：唯一账本，只有 \`pack --apply\` 能改。

## 目录约定

\`\`\`
_规划.md    ← 【事实源】这张卡要长什么样。改任何正文前，先改这里。
_进度.md    ← 【进程】做到哪了、下一步能干什么。每轮先读。
_索引.md    ← 有哪些材料、缺哪些
人物\\<人物名>\\01 基础信息.md  02 穿衣风格.md  03 生活结构.md  04 人物性情.md  05 场景表达.md
世界书\\_蓝图.md  <条目名>.md
创作规则\\ 开场白\\ MVU\\ 状态栏\\ 前端\\ EJS\\
导出\\
\`\`\`

## 五栏与顺序

顺序来自知识库四处写死的拼接顺序：

> 基础信息 → 穿衣风格（如有）→ 生活结构 → 人物性情 → 场景表达

- **① 基础信息是必填**，其余四栏可填、也可由作者明确"无需"。
- \`notes\`／**测试笔记**不在开卡流程内，只在真机实测后由 \`airp_test_diagnosis_router\` 回流。
- 只写作者真正写出的内容。拿不准的按最可能栏位归档，行尾加 \`<!-- 存疑 -->\`，并在 \`待归类.md\` 汇总。
`;
}

/** 规划文档骨架。只记决策，不写正文（同 tavern-cards 的 创作规划.yaml）。 */
function renderPlanningTemplate(title) {
  return `# 创作规划 · ${title}

> **项目级事实源。** 这张卡要长什么样，先在这里谈定。
> **任何修改必须先改本文件，再改正文条目。** 不许反过来。
> 只记决策，不写正文。
> 未定项在那一行写 [待细化]；创作阶段遇到该标记**必须先追问作者补全再动笔**。
> （计数只认行首或列表项上的 [待细化]，本说明行里的不算。）

## 一、对齐模式

- 模式：**未定**　← 开卡第一轮问作者：粗略规划（细节留到创作时）／一次确认（一开始就定齐）
- 定了之后改掉上面那行，并按模式补足下面各段的完整度

## 二、作品设置（overview）

- 标题：
- 一句话简介：
- 形式：角色卡 / 世界书
- 头像：有 / 无
- MVU：[待细化]（要 / 不要）
- EJS：[待细化]（要 / 不要）

## 三、人物（character）

> 先谈**总体**：几个人、分别是谁、各自什么位置、谁是主要人物谁是不重要配角、每人用哪种粒度（细扣／速写）。
> 名单确认后才逐个推进。

| 人物 | 位置与作用 | 粒度 | 备注 |
|---|---|---|---|
|  |  |  |  |

## 四、世界书（worldbook）

- 规模判断：[待细化]（小型 / 中型 / 大型）
- 条目蓝图（确认后才建条目）：

| # | 条目名 | 蓝/绿灯 | order | 唯一职责 |
|---|---|---|---|---|
|  |  |  |  |  |

## 五、创作规则（rules）

- [待细化]

## 六、开场白（opening）

- 首条数量 / 备用条数：[待细化]
- 文风要求：

## 七、MVU 变量

- 是否需要：[待细化]
- 结构要点：

## 八、状态栏

- 路线：[待细化]（原生 / Vue / 不需要）

## 九、消息前端

- [待细化]

## 十、EJS 工件

- [待细化]
`;
}

// ── 建卡 ─────────────────────────────────────────────────────────────
function writeIfAbsent(file, content) {
  if (fs.existsSync(file)) return false;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, 'utf8');
  return true;
}

export function writeState(title, state) {
  state.updatedAt = new Date().toISOString();
  const dir = cardDir(title);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(progressFile(title), renderProgress(state), 'utf8');
  fs.writeFileSync(path.join(dir, INDEX_NAME), renderIndex(state), 'utf8');
  return state;
}

export function initCard(title, { force = false } = {}) {
  const dir = cardDir(title);
  if (fs.existsSync(progressFile(title)) && !force) {
    throw new Error(`卡片档案已存在：${dir}（要重建加 --force）`);
  }
  const state = freshState(title);
  writeState(title, state);
  writeIfAbsent(planningFile(title), renderPlanningTemplate(title));
  writeIfAbsent(path.join(dir, README_NAME), renderReadme(title));
  for (const module of MODULES) fs.mkdirSync(path.join(dir, module.dir), { recursive: true });
  fs.mkdirSync(path.join(dir, EXPORT_DIR), { recursive: true });
  return state;
}

// ── 推进 ─────────────────────────────────────────────────────────────
export function setPlanning(title, { mode, confirmed, refinements } = {}) {
  const state = readState(title);
  if (!state) throw new Error(`找不到卡片档案：${cardDir(title)}`);
  if (mode !== undefined) {
    if (!(mode in ALIGN_MODES)) throw new Error(`未知对齐模式：${mode}（可用：${Object.keys(ALIGN_MODES).join(' / ')}）`);
    state.planning.mode = mode;
  }
  if (confirmed !== undefined) state.planning.confirmed = Boolean(confirmed);
  if (refinements !== undefined) state.planning.refinements = Number(refinements) || 0;
  writeState(title, state);
  return state.planning;
}

/** 规划未确认时**拒绝推进正文**——这是"先谈定全局再动笔"的硬闸。 */
function assertPlanningConfirmed(state, title) {
  if (state.planning.mode === 'unset') {
    throw new Error('规划还没开始：开卡第一轮必须先问作者对齐模式，再补 `_规划.md`。');
  }
  if (!state.planning.confirmed) {
    throw new Error('规划尚未确认：先把 `_规划.md` 补全并请作者确认，才能写正文条目。\n'
      + `  确认后跑：node 工具/material.mjs --plan --card "${title}" --confirmed`);
  }
}

export function markArea(title, character, areaId, action) {
  const state = readState(title);
  if (!state) throw new Error(`找不到卡片档案：${cardDir(title)}`);
  const area = CHARACTER_AREAS.find((one) => one.id === areaId || one.label === areaId);
  if (!area) throw new Error(`未知栏位：${areaId}`);

  // 撤销不需要过规划硬闸：它只是把状态退回去，不产生正文。
  if (action === 'undo') {
    const item = state.modules.character.items[character];
    if (!item) throw new Error(`档案里没有这个人物：${character}`);
    item.areas[area.id] = AREA_TODO;
    state.activeModule = 'character';
    state.activeItem = character;
    writeState(title, state);
    return { area, state };
  }

  assertPlanningConfirmed(state, title);
  if (action === 'skip' && area.required) throw new Error(`「${area.label}」是必填栏位，不能被标为无需。`);

  const file = areaFile(title, character, area.id);
  if (action !== 'skip') {
    // 没落盘不能算完成（对应 tavern-cards 的「文件存在但未注册 = 未完成」）
    if (!fs.existsSync(file) || !fs.readFileSync(file, 'utf8').trim()) {
      throw new Error(`「${area.label}」的文件不存在或为空，不能标记完成：${file}\n  先把内容写进去。`);
    }
  }

  state.modules.character.items[character] ??= { areas: freshAreas(), createdAt: new Date().toISOString() };
  state.modules.character.items[character].areas[area.id] = action === 'skip' ? AREA_SKIPPED : AREA_DONE;
  state.activeModule = 'character';
  state.activeItem = character;
  writeState(title, state);
  return { area, state };
}

/**
 * 单独设置世界书蓝图确认状态。
 *
 * 旧实现只能在 `--worldbook --entry X` 顺带传 `--blueprint-confirmed`，
 * 且后续任何一次 upsert 不传该参数就会把它覆盖回默认值（2026-09-15 实测踩到）。
 * 现在拆成独立操作，蓝图确认与条目登记互不干扰。
 */
export function setBlueprint(title, confirmed = true) {
  const state = readState(title);
  if (!state) throw new Error(`找不到卡片档案：${cardDir(title)}`);
  assertPlanningConfirmed(state, title);
  state.modules.worldbook.blueprintConfirmed = Boolean(confirmed);
  writeState(title, state);
  return state.modules.worldbook;
}

export function upsertWorldbook(title, entry, { done = false, blueprintConfirmed } = {}) {
  const state = readState(title);
  if (!state) throw new Error(`找不到卡片档案：${cardDir(title)}`);
  assertPlanningConfirmed(state, title);
  const worldbook = state.modules.worldbook;
  // 只有显式传值才改蓝图状态，避免"登记条目"顺手把它打回 false。
  if (blueprintConfirmed !== undefined) worldbook.blueprintConfirmed = Boolean(blueprintConfirmed);
  worldbook.items[entry] ??= { done: false, createdAt: new Date().toISOString() };
  worldbook.items[entry].done = Boolean(done);
  writeState(title, state);
  return state;
}

export function markModule(title, moduleKey, done = true) {
  const state = readState(title);
  if (!state) throw new Error(`找不到卡片档案：${cardDir(title)}`);
  if (!state.modules[moduleKey]) throw new Error(`未知模块：${moduleKey}`);
  // 撤销不需要过规划硬闸；标记完成要过（2026-09-15：早先漏了这道，模块能在规划未定时被标完成）。
  if (done) assertPlanningConfirmed(state, title);
  state.modules[moduleKey].done = Boolean(done);
  state.activeModule = moduleKey;
  writeState(title, state);
  return state;
}

export { PLANNING_NAME, PROGRESS_NAME, INDEX_NAME, README_NAME, EXPORT_DIR };
