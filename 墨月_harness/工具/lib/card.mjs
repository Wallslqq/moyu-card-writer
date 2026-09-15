/**
 * 角色卡组装 —— 逐字移植墨月 `character-card.ts` 的 projectCard() 及其辅助函数。
 *
 * 已移植：世界书条目 / 创作规则条目 / 人物六栏目 → 角色定义后条目 / MVU 四条目 /
 *         消息前端运行提示词 / EJS 条目 / 脚本工坊运行包与配套世界书 / 六类固定注入
 *         （initvar 条目、变量列表、变量输出格式、MVU 加载器与变量结构脚本、变量清洗正则、
 *         状态栏与前端显示正则）/ 稳定 ID / 内嵌世界书 / 导入卡字段保留 / 封面与首楼占位符。
 *
 * 脚本工坊部分走 `lib/workshop.mjs` → vendored 墨月原件（理由见该文件）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stableId } from './ids.mjs';
import { exportScript, phoneDisplayRegex, relatedCompanions } from './workshop.mjs';
import { escapeRegex } from './fences.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const MVU_SCRIPT_ID = '961f366d-e403-45c2-8155-3d14ec86de53';
const MVU_REGEX_IDS = {
  prompt: '136c29f6-6ef4-48d7-b5c1-11653d8b04ae',
  display: '0cb92e0f-b6b0-446d-a2c1-2d3894e3a6a7',
  placeholder: '0fdb49d7-597d-4e6a-a247-fb2c57279969',
};
const MVU_VARIABLE_LIST = [
  '---',
  '<status_current_variable>',
  '{{format_message_variable::stat_data}}',
  '</status_current_variable>',
].join('\n');
const MVU_UPDATE_FORMAT = [
  '---',
  '变量输出格式:',
  '  rule:',
  '    - you must output the update analysis and the actual update commands at once in the end of the next reply',
  '    - the update commands works like the **JSON Patch (RFC 6902)** standard, must be a valid JSON array containing operation objects, but supports the following operations instead:',
  '      - replace: replace the value of existing paths',
  '      - delta: update the value of existing number paths by a delta value',
  '      - insert: insert new items into an object or array (using `-` as array index intends appending to the end)',
  '      - remove',
  '      - move',
  "    - don't update field names starts with `_` as they are readonly, such as `_变量`",
  '  format: |-',
  '    <UpdateVariable>',
  '    <Analysis>$(IN ENGLISH, no more than 80 words)',
  '    - ${calculate time passed: ...}',
  "    - ${decide whether dramatic updates are allowed as it's in a special case or the time passed is more than usual: yes/no}",
  '    - ${analyze every variable based on its corresponding `check`, according only to current reply instead of previous plots: ...}',
  '    </Analysis>',
  '    <JSONPatch>',
  '    [',
  '      { "op": "replace", "path": "${/path/to/variable}", "value": "${new_value}" },',
  '      { "op": "delta", "path": "${/path/to/number/variable}", "value": "${positive_or_negative_delta}" },',
  '      { "op": "insert", "path": "${/path/to/object/new_key}", "value": "${new_value}" },',
  '      { "op": "insert", "path": "${/path/to/array/-}", "value": "${new_value}" },',
  '      { "op": "remove", "path": "${/path/to/object/key}" },',
  '      { "op": "remove", "path": "${/path/to/array/0}" },',
  '      { "op": "move", "from": "${/path/to/variable}", "to": "${/path/to/another/path}" },',
  '      ...',
  '    ]',
  '    </JSONPatch>',
  '    </UpdateVariable>',
].join('\n');

/**
 * 状态栏文档：为声明式 Vue 状态栏补上完整 Vue 运行时。
 * 墨月把编码后的 runtime 内联进 <head>；harness 从 vendored vue 读取同一份文件。
 */
let vueRuntimeCache;
function vueGlobalRuntime() {
  if (vueRuntimeCache !== undefined) return vueRuntimeCache;
  const file = path.join(HERE, '..', 'node_modules', 'vue', 'dist', 'vue.global.prod.js');
  vueRuntimeCache = fs.readFileSync(file, 'utf8');
  return vueRuntimeCache;
}

export function statusbarDocument(source) {
  if (!/\bVue\b/.test(source) || source.includes('data-moyu-vue-runtime')) return source;
  const vueScript = `<script data-moyu-vue-runtime>(0,eval)(decodeURIComponent("${encodeURIComponent(vueGlobalRuntime())}"));</script>`;
  if (/<head(?:\s[^>]*)?>/i.test(source)) return source.replace(/<head(?:\s[^>]*)?>/i, (tag) => tag + vueScript);
  return vueScript + source;
}

export function projectCard(project) {
  const now = project.updatedAt;
  // 作品进入 Vue 界面后会变成响应式 Proxy；角色卡内容本来就是 JSON 数据，按 JSON 复制才能稳定导出。
  const importedRoot = project.importedCard ? jsonClone(project.importedCard.raw) : {};
  // 导出结果也会成为回传基准；嵌套脚本和正则不能继续引用正在编辑的原卡。
  const nestedData = objectValue(importedRoot.data);
  const importedData = Object.keys(nestedData).length ? nestedData : importedRoot;
  const importedExtensions = objectValue(importedData.extensions);
  const statusbarSource = project.statusbar.kind === 'none' ? '' : project.statusbar.source;
  const frontendTag = frontendOuterTag(project);
  const workshopIds = new Set(project.scriptProjects.map((item) => stableId(project.id, `workshop:${item.id}`)));
  const workshopScripts = [];
  const phoneRegexId = stableId(project.id, 'workshop-phone');
  let hasWorkshopPhone = false;
  const entries = [];
  let id = 0;
  const usedIds = new Set();
  const pushEntry = (entry) => {
    const preferred = Number(entry.sourceRaw?.id);
    while (usedIds.has(id)) id += 1;
    const cardId = Number.isInteger(preferred) && preferred >= 0 && !usedIds.has(preferred) ? preferred : id++;
    usedIds.add(cardId);
    entries.push(lorebookEntry({ id: cardId, ...entry }));
  };

  const worldbookEntries = project.worldbook
    .filter((entry) => !workshopIds.has(text(objectValue(entry.sourceRaw?.extensions).moyu_script_project)))
    .filter((entry) => !(project.mvu.enabled && isMvuWorldbookEntry(entry.title)))
    .filter((entry) => !(project.frontend.source.trim() && isMoyuFrontendWorldbookEntry(entry.title)));
  for (const entry of worldbookEntries) {
    if (!entry.content.trim() && !entry.sourceRaw) continue;
    pushEntry({
      title: entry.title, content: entry.content, keys: entry.keys, secondaryKeys: entry.secondaryKeys,
      activation: entry.activation, placement: entry.placement, depth: entry.depth, order: entry.order,
      probability: entry.probability, enabled: entry.enabled, sourceRaw: entry.sourceRaw,
    });
  }
  for (const rule of project.rules) {
    if (!rule.content.trim()) continue;
    pushEntry({
      title: `[规则] ${rule.title}`, content: rule.content, keys: [], secondaryKeys: [],
      activation: 'always', placement: rule.placement, depth: rule.depth, order: rule.order,
      probability: 100, enabled: rule.enabled,
    });
  }
  for (const [index, character] of project.characters.entries()) {
    const content = characterDocument(character);
    if (!content) continue;
    pushEntry({
      title: `[人物] ${character.name}`, content, keys: [], secondaryKeys: [], activation: 'always',
      placement: 'after_character',
      // 酒馆角色定义后的有效顺序只有 1–8；人物超过八个时循环复用，而不是导出无效的 9、10……
      depth: 0, order: (index % 8) + 1, probability: 100, enabled: true,
    });
  }
  if (project.mvu.enabled) {
    pushEntry({ title: '[initvar]变量初始化勿开', content: project.mvu.initvarSource, keys: [], secondaryKeys: [], activation: 'always', placement: 'before_character', depth: 0, order: 14720, probability: 100, enabled: false });
    pushEntry({ title: '[mvu_update]变量更新规则', content: project.mvu.updateRulesSource, keys: [], secondaryKeys: [], activation: 'always', placement: 'system_depth', depth: 0, order: 14720, probability: 100, enabled: true });
    pushEntry({ title: '变量列表', content: MVU_VARIABLE_LIST, keys: [], secondaryKeys: [], activation: 'always', placement: 'system_depth', depth: 0, order: 14720, probability: 100, enabled: true });
    pushEntry({ title: '[mvu_update]变量输出格式', content: MVU_UPDATE_FORMAT, keys: [], secondaryKeys: [], activation: 'always', placement: 'system_depth', depth: 0, order: 14720, probability: 100, enabled: true });
  }
  if (project.frontend.source.trim()) {
    pushEntry({ title: '[界面] 消息前端运行提示词', content: project.frontend.source, keys: [], secondaryKeys: [], activation: 'always', placement: 'system_depth', depth: 0, order: 14810, probability: 100, enabled: true });
  }
  for (const item of [...project.ejsCharacters].sort((a, b) => a.entryOrder - b.entryOrder)) {
    if (!item.source.trim()) continue;
    pushEntry({
      title: item.entryName, content: item.source, keys: [], secondaryKeys: [], activation: 'always',
      placement: 'after_character', depth: 0, order: item.entryOrder, probability: 100, enabled: true,
    });
  }

  for (const workshop of project.scriptProjects) {
    const completed = workshop.modules.filter((item) => item.source.trim());
    if (!completed.length) continue;
    const scriptId = stableId(project.id, `workshop:${workshop.id}`);
    // 运行包仅含确认后的成品；工程、历史和待确认稿留在作品备份，不发给玩家。
    workshopScripts.push({ ...exportScript({ ...workshop, id: scriptId }, undefined, true), id: scriptId });
    const companions = relatedCompanions(workshop.worldbook, completed.map((item) => item.id));
    for (const entry of companions) {
      if (!entry.content.trim()) continue;
      if (entry.content.includes('<moyu_phone>')) hasWorkshopPhone = true;
      pushEntry({
        title: entry.title, content: entry.content, keys: entry.keys, secondaryKeys: [],
        activation: entry.constant ? 'always' : 'keyword',
        placement: entry.position === 4 ? 'system_depth' : entry.position === 1 ? 'after_character' : 'before_character',
        depth: entry.depth, order: entry.order, probability: 100, enabled: entry.enabled,
        sourceRaw: {
          extensions: {
            moyu_script_project: scriptId, moyu_script_entry: entry.id,
            role: { system: 0, user: 1, assistant: 2 }[entry.role],
          },
        },
      });
    }
  }

  const importedTavernHelper = objectValue(importedExtensions.tavern_helper);
  const scripts = array(importedTavernHelper.scripts).map(objectValue)
    .filter((item) => !(project.mvu.enabled && isMoyuScript(item)))
    .filter((item) => !workshopIds.has(text(item.id)));
  scripts.push(...workshopScripts);
  if (project.mvu.enabled) {
    scripts.push(script('MVU', MVU_SCRIPT_ID, "import'https://testingcf.jsdelivr.net/gh/MagicalAstrogy/MagVarUpdate/artifact/bundle.js';"));
    scripts.push(script('墨月·变量结构', stableId(project.id, 'mvu-schema'), project.mvu.schemaSource));
  }
  const frontendActive = Boolean(frontendTag && project.frontend.source.trim() && project.frontend.previewHtml.trim());
  const regexScripts = [
    ...array(importedExtensions.regex_scripts).map(objectValue)
      .filter((item) => !(project.mvu.enabled && isMvuRegex(item)))
      .filter((item) => !(project.scriptProjects.length && item.id === phoneRegexId))
      .filter((item) => !(frontendActive && isMoyuFrontendRegex(item))),
    ...(project.mvu.enabled ? mvuRegex(statusbarSource) : []),
    ...(frontendActive ? [frontendRegex(project, frontendTag)] : []),
    ...(hasWorkshopPhone ? [{ ...phoneDisplayRegex(project.title), id: phoneRegexId }] : []),
  ];
  const hasImportedRegexScripts = Object.hasOwn(importedExtensions, 'regex_scripts');
  const hasImportedTavernHelper = Object.hasOwn(importedExtensions, 'tavern_helper');
  const mainName = project.title;
  const creatorNotes = project.importedCard ? project.summary : project.summary.trim() || '由墨月写卡器在用户浏览器本地制作';
  const firstMessage = withStatusPlaceholder(project.opening.firstMessage, statusbarSource);
  const importedBook = objectValue(importedData.character_book);
  const hasEmbeddedBook = entries.length > 0 || Object.keys(importedBook).length > 0;
  const bookName = text(importedBook.name) || `${project.title}·世界书`;
  const data = {
    ...importedData,
    name: mainName,
    description: text(importedData.description),
    personality: text(importedData.personality),
    scenario: text(importedData.scenario),
    first_mes: firstMessage,
    creator_notes: creatorNotes,
    system_prompt: text(importedData.system_prompt),
    post_history_instructions: text(importedData.post_history_instructions),
    alternate_greetings: (project.importedCard ? project.opening.alternateGreetings : project.opening.alternateGreetings.filter((item) => item.trim()))
      .map((item) => withStatusPlaceholder(item, statusbarSource)),
    tags: project.importedCard ? stringArray(importedData.tags) : ['墨月'],
    creator: project.importedCard ? text(importedData.creator) : '三明月',
    character_version: project.importedCard ? text(importedData.character_version) : now.slice(0, 10),
    extensions: {
      ...importedExtensions,
      // 酒馆导入内嵌世界书后沿用同名绑定；已有绑定与作者显式选择仍优先。
      ...(!text(importedExtensions.world) && hasEmbeddedBook ? { world: bookName } : {}),
      ...(project.worldbookBinding !== undefined ? { world: project.worldbookBinding } : {}),
      ...(!project.importedCard || hasImportedRegexScripts || regexScripts.length ? { regex_scripts: regexScripts } : {}),
      ...(!project.importedCard || hasImportedTavernHelper || scripts.length ? {
        tavern_helper: {
          ...importedTavernHelper,
          scripts,
          ...(!project.importedCard || Object.hasOwn(importedTavernHelper, 'variables')
            ? { variables: importedTavernHelper.variables ?? {} }
            : {}),
        },
      } : {}),
      ...(project.importedCard ? {} : { moyu: { format_version: 3, project_id: project.id, exported_at: now } }),
    },
    character_book: hasEmbeddedBook ? {
      ...importedBook,
      name: bookName,
      description: text(importedBook.description),
      scan_depth: finiteNumber(importedBook.scan_depth, 4),
      token_budget: finiteNumber(importedBook.token_budget, 2048),
      recursive_scanning: importedBook.recursive_scanning === true,
      extensions: objectValue(importedBook.extensions),
      entries,
    } : undefined,
  };
  return {
    ...importedRoot,
    name: mainName,
    description: text(data.description),
    first_mes: firstMessage,
    creatorcomment: creatorNotes,
    spec: 'chara_card_v3',
    spec_version: '3.0',
    data,
  };
}

export function frontendOuterTag(project) {
  const contractLine = project.frontend.contract.match(/唯一外层标签\s*[：:]\s*`?<?([^\s<>/`]+)[^>\r\n]*>?`?/i)?.[1];
  if (contractLine && containsTagPair(project.frontend.source, contractLine)) return contractLine;
  const openingTags = [...project.frontend.source.matchAll(/<([^\s/><]+)(?:\s[^>]*)?>/g)].map((match) => match[1] || '');
  return openingTags.find((tag) => containsTagPair(project.frontend.source, tag)) || '';
}

export function containsTagPair(source, tag) {
  const escaped = escapeRegex(tag);
  return new RegExp(`<${escaped}(?:\\s[^>]*)?>[\\s\\S]*?<\\/${escaped}\\s*>`, 'i').test(source);
}

function characterDocument(character) {
  const sections = ([
    ['基础信息', character.basicInformation],
    ['生活结构', character.lifeStructure],
    ['人物性情', character.characterNature],
    ['场景表达', character.sceneExpression],
    ['穿衣风格', character.clothingStyle],
  ]).filter(([, content]) => content.trim());
  return sections.map(([label, content]) => characterSection(character.name, label, content)).join('\n\n');
}

function characterSection(characterName, label, content) {
  const value = content.trim();
  const existing = value.match(/^<([^<>\r\n]+)>\s*([\s\S]*?)\s*<\/\1>\s*$/);
  const body = existing?.[1]?.endsWith(`_${label}`) ? existing[2].trim() : value;
  const tag = `${safeTagPart(characterName)}_${label}`;
  return `<${tag}>\n${body}\n</${tag}>`;
}

function lorebookEntry(input) {
  const atDepth = input.placement === 'system_depth';
  const after = input.placement === 'after_character';
  const sourceExtensions = objectValue(input.sourceRaw?.extensions);
  const source = jsonClone(input.sourceRaw ?? {});
  const sourceHasDisable = Object.hasOwn(source, 'disable');
  const sourceHasOrder = Object.hasOwn(source, 'order');
  const sourceHasTopLevelDepth = Object.hasOwn(source, 'depth');
  const sourceHasTopLevelProbability = Object.hasOwn(source, 'probability');
  return {
    use_regex: false,
    ...source,
    id: input.id,
    keys: input.keys,
    secondary_keys: input.secondaryKeys,
    comment: input.title,
    content: input.sourceRaw ? input.content : input.content.trim(),
    constant: input.activation === 'always',
    selective: input.activation === 'keyword',
    insertion_order: input.order,
    ...(sourceHasOrder ? { order: input.order } : {}),
    enabled: input.enabled,
    ...(sourceHasDisable ? { disable: !input.enabled } : {}),
    position: after ? 'after_char' : 'before_char',
    ...(sourceHasTopLevelDepth ? { depth: input.depth } : {}),
    ...(sourceHasTopLevelProbability ? { probability: input.probability } : {}),
    extensions: {
      exclude_recursion: true,
      prevent_recursion: true,
      display_index: input.id,
      group: '', group_override: false, group_weight: 100,
      vectorized: false, sticky: null, cooldown: null, delay: null,
      role: 0,
      selectiveLogic: 0,
      ...sourceExtensions,
      position: atDepth ? 4 : after ? 1 : 0,
      depth: input.depth,
      probability: input.probability,
      useProbability: sourceExtensions.useProbability === false ? false : true,
    },
  };
}

function isMoyuScript(item) {
  return item.id === MVU_SCRIPT_ID || item.name === 'MVU' || item.name === '墨月·变量结构';
}

function isMvuRegex(item) {
  return Object.values(MVU_REGEX_IDS).includes(text(item.id))
    || /^\[(?:不发送|不显示|显示)\](?:去除变量更新|界面占位符|墨月状态栏)/.test(text(item.scriptName));
}

function isMoyuFrontendRegex(item) {
  return /^\[显示\]墨月消息前端/.test(text(item.scriptName));
}

function isMvuWorldbookEntry(title) {
  return ['[initvar]变量初始化勿开', '[mvu_update]变量更新规则', '变量列表', '[mvu_update]变量输出格式'].includes(title.trim());
}

function isMoyuFrontendWorldbookEntry(title) {
  return title.trim() === '[界面] 消息前端运行提示词';
}

function script(name, id, content) {
  return { type: 'script', enabled: true, name, id, content: content.trim(), info: '由墨月写卡器在浏览器本地写入', button: { enabled: false, buttons: [] }, data: {} };
}

function mvuRegex(statusHtml) {
  const entries = [
    regex(MVU_REGEX_IDS.prompt, '[不发送]去除变量更新', '/<update(?:variable)?>(?:(?!.*<\\/update(?:variable)?>).*$|.*<\\/update(?:variable)?>)/gsi', false, true),
    regex(MVU_REGEX_IDS.display, '[不显示]去除变量更新', '/<update(?:variable)?>(?:(?!.*<\\/update(?:variable)?>).*$|.*<\\/update(?:variable)?>)/gsi', true, false),
  ];
  if (statusHtml.trim()) {
    entries.push(regex(MVU_REGEX_IDS.placeholder, '[不发送]界面占位符', '/<StatusPlaceHolderImpl\\s*\\/>/g', false, true));
    entries.push(regex(stableId('moyu-status-display', statusHtml), '[显示]墨月状态栏', '/<StatusPlaceHolderImpl\\s*\\/>/g', true, false, codeFence(statusbarDocument(statusHtml))));
  }
  return entries;
}

function regex(id, name, findRegex, markdownOnly, promptOnly, replaceString = '') {
  return { id, scriptName: name, findRegex, replaceString, trimStrings: [], placement: [2], disabled: false, markdownOnly, promptOnly, runOnEdit: true, substituteRegex: 0, minDepth: null, maxDepth: null };
}

function frontendRegex(project, tag) {
  const escaped = escapeRegex(tag);
  return regex(stableId(project.id, `frontend:${tag}`), `[显示]墨月消息前端·${tag}`, `/<${escaped}(?:\\s[^>]*)?>[\\s\\S]*?<\\/${escaped}\\s*>/g`, true, false, codeFence(project.frontend.previewHtml));
}

function codeFence(html) { return `\`\`\`html\n${html.trim()}\n\`\`\``; }

function withStatusPlaceholder(message, statusHtml) {
  if (!statusHtml.trim()) return message;
  const value = message.trim();
  return value && !/<StatusPlaceHolderImpl\s*\/>/.test(value) ? `${value}\n\n<StatusPlaceHolderImpl/>` : value;
}

function safeTagPart(value) {
  const normalized = value.normalize('NFKC').trim().replace(/[^\p{L}\p{N}_.-]+/gu, '_').replace(/^[^\p{L}_]+/u, '角色_').slice(0, 64);
  return normalized || '角色';
}

function objectValue(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function jsonClone(value) { return JSON.parse(JSON.stringify(value)); }
function array(value) { return Array.isArray(value) ? value : []; }
function text(value) { return typeof value === 'string' ? value : ''; }
function stringArray(value) { return Array.isArray(value) ? value.map(text).filter(Boolean) : []; }
function finiteNumber(value, fallback) { const result = Number(value); return Number.isFinite(result) ? result : fallback; }
