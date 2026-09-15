/**
 * 确认写入 —— 移植墨月 `workspace.ts` 的 applyArtifact() 与 `batch-artifact.ts` 的整组写入。
 *
 * 纪律：这是**唯一**允许改动作品内容的入口。它不接受校验未通过的稿件。
 */
import { configuredTextBlocks, configuredTextArtifactIssue } from './configured.mjs';
import { reviewArtifactContent, parseImportedCardArtifact } from './review.mjs';
import { checkMvuFiles } from './mvu.mjs';

const BATCH_MAX_CHARACTERS = 16_000;
const BATCH_MAX_WORLDBOOK_ITEMS = 8;
const BATCH_MAX_ENTRY_CHARACTERS = 4_000;
export const MVU_BATCH_TASKS = {
  mvu_schema_compilation: 'schemaSource',
  mvu_initvar_formatting: 'initvarSource',
  mvu_update_rule_formatting: 'updateRulesSource',
};

// ── 构造器（移植 workspace.ts） ────────────────────────────────────────
export function createCharacter(name = '') {
  const now = new Date().toISOString();
  return { id: crypto.randomUUID(), name: name.trim() || '未命名角色', basicInformation: '', lifeStructure: '', characterNature: '', sceneExpression: '', clothingStyle: '', notes: '', createdAt: now, updatedAt: now };
}

export function createWorldbookEntry() {
  const now = new Date().toISOString();
  return { id: crypto.randomUUID(), title: '未命名设定', content: '', keys: [], secondaryKeys: [], activation: 'always', placement: 'before_character', depth: 0, order: 100, probability: 100, enabled: true, createdAt: now, updatedAt: now };
}

export function createRule() {
  const now = new Date().toISOString();
  return { id: crypto.randomUUID(), title: '未命名规则', content: '', placement: 'system_depth', depth: 0, order: 100, enabled: true, createdAt: now, updatedAt: now };
}

export function createEjsCharacter(name = '未命名 EJS') {
  return { id: crypto.randomUUID(), name, entryName: `[EJS] ${name}`, entryOrder: 1, requirements: '', contract: '', source: '' };
}

export function importedCardData(project) {
  const root = project.importedCard?.raw;
  if (!root) return undefined;
  const nested = objectValue(root.data);
  return Object.keys(nested).length ? nested : root;
}

// ── 单份写入 ──────────────────────────────────────────────────────────
export function applyArtifact(project, artifact, characterId) {
  if (artifact.batch) throw new Error('批量成品需要整组确认，不能按单条写入。');
  const blocks = codeBlocks(artifact.content);
  const primary = blocks.at(-1)?.content || artifact.content.trim();
  const finish = (message) => { project.updatedAt = new Date().toISOString(); return message; };
  const character = project.characters.find((item) => item.id === characterId) ?? project.characters[0];
  const ejsTarget = project.ejsCharacters.find((item) => item.id === characterId);
  const characterFields = {
    airp_basic_information: 'basicInformation',
    airp_life_structure: 'lifeStructure',
    airp_character_nature: 'characterNature',
    airp_scene_expression: 'sceneExpression',
    airp_clothing_style: 'clothingStyle',
  };
  const field = characterFields[artifact.taskId];

  if (artifact.taskId === 'free_creation' && project.importedCard && artifact.area && /^(?:field|regex|script):/.test(artifact.area)) {
    const payload = parseImportedCardArtifact(artifact.content, artifact.area);
    if (!payload) throw new Error('待确认内容无法写入当前原卡位置');
    const data = importedCardData(project);
    if (!data) throw new Error('没有找到可修改的原卡资料');
    if (artifact.area.startsWith('field:')) {
      const key = artifact.area.slice(6);
      const allowed = new Set(['description', 'personality', 'scenario', 'mes_example', 'system_prompt', 'post_history_instructions']);
      if (!allowed.has(key) || typeof payload.value !== 'string') throw new Error('这份内容不能写入当前人物原文');
      data[key] = payload.value;
      return finish('已写入当前人物原文');
    }
    const extensions = objectValue(data.extensions);
    if (data.extensions !== extensions) data.extensions = extensions;
    if (artifact.area.startsWith('regex:')) {
      const index = Number(artifact.area.slice(6));
      const items = array(extensions.regex_scripts);
      const current = objectValue(items[index]);
      if (!Number.isInteger(index) || !items[index] || !objectPayload(payload.value)) throw new Error('没有找到要修改的原卡正则');
      items[index] = { ...current, ...payload.value };
      extensions.regex_scripts = items;
      return finish('已写入当前原卡正则');
    }
    const index = Number(artifact.area.slice(7));
    const tavernHelper = objectValue(extensions.tavern_helper);
    const items = array(tavernHelper.scripts);
    const current = objectValue(items[index]);
    if (!Number.isInteger(index) || !items[index] || !objectPayload(payload.value)) throw new Error('没有找到要修改的原卡脚本');
    items[index] = { ...current, ...payload.value };
    tavernHelper.scripts = items;
    extensions.tavern_helper = tavernHelper;
    return finish('已写入当前原卡脚本');
  }
  if (field) {
    if (!character) throw new Error('请先建立并选择要写入的人物');
    character[field] = primary;
    character.updatedAt = new Date().toISOString();
    return finish(`已写入 ${character.name} · ${fieldLabel(field)}`);
  }
  if (artifact.taskId === 'npc_light_habitat') {
    const tagName = primary.match(/^<([^>]+)>/m)?.[1]?.replace(/_(?:人物生境|基础信息)$/, '') || '新人物';
    const createdCharacter = createCharacter(tagName);
    createdCharacter.basicInformation = primary;
    project.characters.push(createdCharacter);
    return finish(`已建立人物 ${createdCharacter.name}`);
  }
  if (/^worldview_(?:small|medium|large)$/.test(artifact.taskId)) {
    const issue = configuredTextArtifactIssue(artifact.content) || worldbookConfigIssue(artifact.content);
    if (issue) throw new Error(issue);
    const configured = configuredTextBlocks(artifact.content);
    const targetId = artifact.targetId ?? characterId;
    const target = targetId ? project.worldbook.find((entry) => entry.id === targetId) : undefined;
    if (targetId && !target) throw new Error('原先选中的世界书条目已不存在，请重新选择后生成。');
    const matching = target ? configured.filter((block) => block.config['条目名称'] === target.title || block.tag === target.title) : [];
    if (target && (matching.length > 1 || (configured.length > 1 && !matching.length && target.content.trim()))) {
      throw new Error('这份成品包含多个条目，无法确定哪一条替换当前设定。请让 AI 明确当前条目的名称后重新生成。');
    }
    const replacement = target ? matching[0] ?? configured[0] : undefined;
    for (const block of configured) {
      const entry = createWorldbookEntry();
      entry.title = block.config['条目名称'] || block.tag || artifact.title;
      entry.content = block.content;
      entry.enabled = booleanConfig(block.config['启用'], true);
      entry.activation = /绿灯|关键词/.test(block.config['激活策略'] || '') ? 'keyword' : 'always';
      entry.keys = keywordConfig(block.config['关键词']);
      entry.order = integerConfig(block.config.order, 100);
      entry.probability = boundedConfig(block.config['激活概率'], 0, 100, 100);
      entry.scale = artifact.taskId.slice('worldview_'.length);
      if (/待动态加载/.test(block.config['激活策略'] || '')) entry.enabled = false;
      if (target && block === replacement) {
        // 保留条目身份与导入扩展；仅更新本次成品明确交付的字段。
        Object.assign(target, {
          title: entry.title, content: entry.content, enabled: entry.enabled,
          activation: entry.activation, keys: entry.keys, order: entry.order,
          probability: entry.probability, scale: entry.scale, updatedAt: entry.updatedAt,
        });
      } else project.worldbook.push(entry);
    }
    return finish(target ? `已更新 ${target.title}${configured.length > 1 ? `，另加入 ${configured.length - 1} 条设定` : ''}` : `已加入 ${configured.length} 条世界书设定`);
  }
  if (artifact.taskId === 'creation_rules') {
    const issue = configuredTextArtifactIssue(artifact.content) || ruleConfigIssue(artifact.content);
    if (issue) throw new Error(issue);
    const configured = configuredTextBlocks(artifact.content);
    for (const block of configured) {
      const rule = createRule();
      rule.title = block.config['条目名称'] || block.tag || artifact.title;
      rule.content = block.content;
      rule.enabled = booleanConfig(block.config['启用'], true);
      rule.placement = /角色定义前/.test(block.config['插入位置'] || '') ? 'before_character'
        : /角色定义后/.test(block.config['插入位置'] || '') ? 'after_character'
          : 'system_depth';
      rule.depth = boundedConfig(block.config.depth, 0, 99, 0);
      rule.order = integerConfig(block.config.order, 100);
      project.rules.push(rule);
    }
    return finish(`已加入 ${configured.length} 条创作规则`);
  }
  if (artifact.taskId === 'opening_style_then_draft') {
    if (/<开场白_文风约定>/.test(primary)) throw new Error('文风约定只用于 AI 解答区协作，不能写入首条消息');
    if (!primary) throw new Error('没有找到能够写入首条消息的完整开场白');
    project.opening.firstMessage = primary;
    return finish('已写入首条开场白');
  }
  if (artifact.taskId === 'airp_intake_router' || artifact.taskId === 'airp_test_diagnosis_router' || artifact.taskId === 'worldview_scale_router' || artifact.taskId === 'free_creation') {
    const now = new Date().toISOString();
    const sourceSection = artifact.taskId.startsWith('airp_') ? 'character'
      : artifact.taskId === 'worldview_scale_router' ? 'worldbook'
        : undefined;
    project.materials.push({
      id: crypto.randomUUID(), sourceSection, sourceTaskId: artifact.taskId,
      targetId: artifact.targetId ?? characterId,
      title: artifact.title.replace(/·待确认$/, ''), content: artifact.content.trim(), pinned: true,
      createdAt: now, updatedAt: now,
    });
    return finish('已保存为后续专项可读取的创作资料');
  }
  if (artifact.taskId === 'mvu_initvar_design') project.mvu.initvarDesign = primary;
  else if (artifact.taskId === 'mvu_update_rule_design') project.mvu.updateRuleDesign = primary;
  else if (artifact.taskId === 'mvu_initvar_formatting') project.mvu.initvarSource = primary;
  else if (artifact.taskId === 'mvu_update_rule_formatting') project.mvu.updateRulesSource = primary;
  else if (artifact.taskId === 'mvu_schema_compilation') project.mvu.schemaSource = primary;
  else if (artifact.taskId === 'mvu_statusbar_briefing') project.statusbar.contract = primary;
  else if (artifact.taskId === 'mvu_statusbar_native_build' || artifact.taskId === 'mvu_statusbar_vue_build') {
    project.statusbar.source = [...blocks].reverse().find((block) => block.language === 'html')?.content || primary;
    if (project.statusbar.kind !== 'none') project.statusbar.kind = artifact.taskId === 'mvu_statusbar_vue_build' ? 'vue' : 'native';
  }
  else if (artifact.taskId === 'frontend_briefing') project.frontend.contract = primary;
  else if (artifact.taskId === 'frontend_build') {
    project.frontend.source = blocks.find((block) => block.language === 'text' || !block.language)?.content || blocks[0]?.content || primary;
    project.frontend.previewHtml = [...blocks].reverse().find((block) => block.language === 'html')?.content || '';
  } else if (artifact.taskId === 'ejs_briefing') {
    const target = ejsTarget ?? project.ejsCharacters[0] ?? createEjsCharacter('未命名 EJS');
    if (!project.ejsCharacters.some((item) => item.id === target.id)) project.ejsCharacters.push(target);
    target.contract = primary;
  } else if (artifact.taskId === 'ejs_build') {
    const target = ejsTarget ?? project.ejsCharacters[0] ?? createEjsCharacter('未命名 EJS');
    if (!project.ejsCharacters.some((item) => item.id === target.id)) project.ejsCharacters.push(target);
    target.source = blocks.find((block) => ['js', 'javascript', 'ejs'].includes(block.language))?.content || primary;
  } else {
    throw new Error('这份结果属于讨论或分流，不应直接写入正式资料');
  }
  return finish('已写入当前作品的对应位置');
}

// ── 整组写入 ──────────────────────────────────────────────────────────
export function applyPreparedArtifact(project, artifact, targetId) {
  if (!artifact.batch) return applyArtifact(project, artifact, targetId);
  if (artifact.confirmed) throw new Error('这批内容已经写入，不要重复确认。');
  const batch = artifact.batch;
  if (batch.section === 'mvu') {
    if (Object.entries(mvuBase(project)).some(([field, content]) => batch.base[field] !== content)) {
      throw new Error('MVU 文件在生成后有改动，请让 Agent 按最新内容重新整理，当前文件未改变。');
    }
  } else {
    for (const item of batch.items) {
      if (item.targetId && (!Object.hasOwn(batch.base, item.targetId) || !worldbookBase(project, item.targetId) || batch.base[item.targetId] !== worldbookBase(project, item.targetId))) {
        throw new Error(`「${item.title}」在生成后被修改或删除，请按最新内容重新整理；整批尚未写入。`);
      }
    }
  }
  const { staged } = stageBatch(project, batch);
  // 此处之前没有改动作品。全组通过后同步提交，保留未涉及对象的身份与内容。
  if (batch.section === 'worldbook') {
    const existingIds = new Set(project.worldbook.map((item) => item.id));
    for (const item of batch.items) {
      if (item.targetId) Object.assign(project.worldbook.find((entry) => entry.id === item.targetId), staged.worldbook.find((entry) => entry.id === item.targetId));
    }
    project.worldbook.push(...staged.worldbook.filter((item) => !existingIds.has(item.id)));
    // 墨月在此把首个世界书条目绑定到当前页面会话；harness 尚无页面会话模型，故不绑定。
  } else {
    for (const item of batch.items) {
      const field = MVU_BATCH_TASKS[item.taskId];
      project.mvu[field] = staged.mvu[field];
    }
  }
  artifact.confirmed = true;
  project.updatedAt = artifact.updatedAt = new Date().toISOString();
  return `已一起写入 ${batch.items.length} ${batch.section === 'worldbook' ? '条世界书内容' : '份 MVU 文件'}`;
}

/** 在副本上完成全组校验，旧的上下游文件不会误拦同批的新结构。 */
export function stageBatch(project, batch) {
  validateItems(batch.section, batch.items);
  const staged = { ...project, worldbook: project.worldbook.map((item) => ({ ...item })), mvu: { ...project.mvu } };
  const diagnostics = [];
  const items = batch.items.map((item) => {
    const original = item.targetId ? project.worldbook.find((entry) => entry.id === item.targetId) : undefined;
    if (item.targetId && !original) throw new Error(`「${item.title}」的目标已不存在，请按目录中的准确 ID 读取后重做待确认稿。`);
    if (batch.section === 'worldbook' && original) {
      const configured = configuredTextBlocks(item.content);
      if (configured.length > 1) throw new Error(`「${item.title}」混入了多个条目，请分别列入 items。`);
      const body = configured[0]?.content ?? item.content.trim().replace(/^```(?:text|markdown|xml)?\s*\n([\s\S]*?)\n```$/i, '$1').trim();
      if (!body) throw new Error(`「${original.title}」缺少完整正文。`);
      const updated = staged.worldbook.find((entry) => entry.id === original.id);
      // 本功能只批量改正文；名称、发送设置和未知扩展均采用确认时的原对象。
      updated.content = body;
      if (body !== original.content) updated.updatedAt = new Date().toISOString();
      return { ...item, title: original.title, content: body };
    }
    const review = reviewArtifactContent(item.taskId, item.content);
    const errors = review.diagnostics.filter((issue) => issue.severity === 'error');
    if (errors.length) throw new Error(`「${item.title}」：${errors.map((issue) => `${issue.detail} ${issue.fix}`).join('\n')}`);
    diagnostics.push(...review.diagnostics);
    const content = review.content;
    if (batch.section === 'worldbook' && configuredTextBlocks(content).length !== 1) throw new Error(`「${item.title}」必须只含一个正文与配对配置；多条内容分别放入 items。`);
    applyArtifact(staged, { ...item, content, id: '', format: 'text', confirmed: false, createdAt: '', updatedAt: '' });
    const title = batch.section === 'worldbook'
      ? configuredTextBlocks(content)[0].config['条目名称'] || item.title
      : ({ mvu_schema_compilation: '变量结构 · schema.js', mvu_initvar_formatting: '开局值 · initvar.yaml', mvu_update_rule_formatting: '变化规则 · 变量更新规则.yaml' }[item.taskId] ?? item.title);
    return { ...item, title, content };
  });
  if (batch.section === 'mvu') {
    const result = checkMvuFiles(staged.mvu);
    if (result.issues.length) throw new Error(`MVU 整组核对未通过：${result.issues.join('；')}。请修正对应文件后重新提交完整的一组。`);
  }
  return { staged, items, diagnostics };
}

export function prepareBatchArtifact(project, section, items) {
  for (const item of items) {
    if (typeof item?.taskId !== 'string' || typeof item?.title !== 'string' || !item.title || typeof item?.content !== 'string' || !item.content) {
      throw new Error('每项都需要 taskId、title 和完整 content，已有世界书条目还需 targetId。');
    }
  }
  const base = section === 'mvu' ? mvuBase(project) : Object.fromEntries(items.filter((item) => item.targetId).map((item) => [item.targetId, worldbookBase(project, item.targetId)]));
  const batch = { section, items, base };
  const checked = stageBatch(project, batch);
  validateItems(section, checked.items);
  batch.items = checked.items;
  return {
    title: `${section === 'worldbook' ? '世界书' : 'MVU'} · ${items.length} 项待确认`,
    content: checked.items.map((item) => `【${item.title}】\n${item.content}`).join('\n\n'),
    format: 'text', batch, diagnostics: checked.diagnostics,
  };
}

function validateItems(section, items) {
  if (items.length < 2 || items.length > (section === 'mvu' ? 3 : BATCH_MAX_WORLDBOOK_ITEMS)) {
    throw new Error(section === 'mvu' ? '小批 MVU 一次处理两到三份文件。' : '世界书一次处理 2 到 8 个条目，请按主题分组。');
  }
  if (items.reduce((sum, item) => sum + item.content.length, 0) > BATCH_MAX_CHARACTERS) {
    throw new Error('这组成品超过 16000 字符，请按独立主题分组；不要截断内容或删除必要规则来凑数。');
  }
  const targets = new Set();
  for (const item of items) {
    const validTask = section === 'mvu' ? Object.hasOwn(MVU_BATCH_TASKS, item.taskId) : /^worldview_(small|medium|large)$/.test(item.taskId);
    if (!validTask || (section === 'mvu' && item.targetId)) throw new Error('批量目标只能是当前页面的世界书条目或 MVU 三份文件，不能混入其他栏目。');
    const key = section === 'mvu' ? item.taskId : item.targetId;
    if (key && targets.has(key)) throw new Error('同一目标不能在一批中重复提交。');
    if (key) targets.add(key);
    if (section === 'worldbook' && item.content.length > BATCH_MAX_ENTRY_CHARACTERS) throw new Error(`「${item.title}」超过单条 4000 字符，请单独处理这份长条目。`);
  }
}

function mvuBase(project) {
  return Object.fromEntries(Object.values(MVU_BATCH_TASKS).map((field) => [field, project.mvu[field]]));
}

function worldbookBase(project, id) {
  const entry = project.worldbook.find((item) => item.id === id);
  // 只比较将被覆盖的字段；发送配置与目录顺序始终采用确认时的最新值。
  return entry ? JSON.stringify({ title: entry.title, content: entry.content }) : '';
}

// ── 配置解析（移植 workspace.ts） ──────────────────────────────────────
function worldbookConfigIssue(content) {
  for (const block of configuredTextBlocks(content)) {
    const config = block.config;
    if (!config['条目名称']) return `${block.tag} 的配置缺少条目名称`;
    if (!/^(?:蓝灯|绿灯|待动态加载)/.test(config['激活策略'] || '')) return `${block.tag} 的配置缺少明确激活策略`;
    if (config['插入位置'] !== '角色定义前') return `${block.tag} 必须放在角色定义前`;
    if (!exactInteger(config.order)) return `${block.tag} 的 order 必须是明确整数`;
    if (!boundedInteger(config['激活概率'], 0, 100)) return `${block.tag} 的激活概率必须是 0—100 的整数`;
    if (/绿灯|关键词/.test(config['激活策略']) && !keywordConfig(config['关键词']).length) return `${block.tag} 使用关键词触发时必须提供关键词`;
  }
  return '';
}

function ruleConfigIssue(content) {
  for (const block of configuredTextBlocks(content)) {
    const config = block.config;
    if (!config['条目名称']) return `${block.tag} 的配置缺少条目名称`;
    if (!/^(?:蓝灯|绿灯)/.test(config['激活策略'] || '')) return `${block.tag} 的配置缺少明确激活策略`;
    if (!/^(?:指定深度|角色定义前|角色定义后)$/.test(config['插入位置'] || '')) return `${block.tag} 的配置缺少明确插入位置`;
    if (!exactInteger(config.order)) return `${block.tag} 的 order 必须是明确整数`;
    if (config['插入位置'] === '指定深度' && !boundedInteger(config.depth, 0, 99)) return `${block.tag} 的 depth 必须是 0—99 的整数`;
  }
  return '';
}

function keywordConfig(value = '') {
  if (!value || /^(?:无|不适用|null)$/i.test(value)) return [];
  return value.split(/[,，、]/).map((item) => item.trim()).filter(Boolean);
}

function booleanConfig(value, fallback) {
  if (value === undefined || value === '') return fallback;
  return !/^(?:false|否|关闭|0)$/i.test(value);
}

function exactInteger(value) { return /^-?\d+$/.test(value || ''); }
function boundedInteger(value, minimum, maximum) { return exactInteger(value) && Number(value) >= minimum && Number(value) <= maximum; }
function integerConfig(value, fallback) { return exactInteger(value) ? Number(value) : fallback; }
function boundedConfig(value, minimum, maximum, fallback) { return boundedInteger(value, minimum, maximum) ? Number(value) : fallback; }

function objectValue(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function array(value) { return Array.isArray(value) ? value : []; }
function objectPayload(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function codeBlocks(content) {
  return [...content.matchAll(/```([a-z0-9_+-]*)\s*\r?\n([\s\S]*?)```/gi)]
    .map((match) => ({ language: (match[1] || '').toLowerCase(), content: (match[2] || '').trim() }))
    .filter((block) => block.content);
}
function fieldLabel(field) {
  return ({ basicInformation: '基础信息', lifeStructure: '生活结构', characterNature: '人物性情', sceneExpression: '场景表达', clothingStyle: '穿衣风格' })[field];
}
