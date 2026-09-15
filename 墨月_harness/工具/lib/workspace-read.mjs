/**
 * 工作区按需查阅 —— 等价墨月 agent-tools.ts 的
 * `moyu_read_authorized_context` 与 `moyu_search_workspace` 两个工具的数据面。
 *
 * 为什么需要它们：装配时虽然会带上当前对象与固定关联，但跨对象检索（"这个词在哪出现过"）
 * 与"读其它页面的某个对象"仍要按需进行。墨月靠工具串 target_id 做，这里落到 CLI。
 *
 * 语义照抄墨月：
 *   · 首次给目录（id + 名称），按 target_id 读正文；长内容用 offset/limit 续读；
 *   · 搜索是**字面文字**检索，不是正则；命中返回前后各 80/180 字符的片段；
 *   · 只搜当前作品，不搜其他作品与连接密钥。
 */

export function sectionTargetIds(project, domain) {
  if (domain === 'carddata') {
    const data = project.importedCard?.raw;
    if (!data) return [];
    const nested = objectValue(data.data);
    const root = Object.keys(nested).length ? nested : data;
    const extensions = objectValue(root.extensions);
    const helper = objectValue(extensions.tavern_helper);
    return [
      ...['description', 'personality', 'scenario', 'mes_example', 'system_prompt', 'post_history_instructions']
        .map((key) => `field:${key}`),
      ...(Array.isArray(extensions.regex_scripts) ? extensions.regex_scripts.map((_, index) => `regex:${index}`) : []),
      ...(Array.isArray(helper.scripts) ? helper.scripts.map((_, index) => `script:${index}`) : []),
    ];
  }
  if (domain === 'character') return (project.characters ?? []).map((item) => item.id);
  if (domain === 'worldbook') return (project.worldbook ?? []).map((item) => item.id);
  if (domain === 'rules') return (project.rules ?? []).map((item) => item.id);
  if (domain === 'ejs') return (project.ejsCharacters ?? []).map((item) => item.id);
  return [];
}

/** 目录项：id + 人可读名称（等价墨月首次返回的目录）。 */
export function targets(project, domain) {
  return sectionTargetIds(project, domain).map((id) => ({ target_id: id, title: targetTitle(project, domain, id) }));
}

export function targetTitle(project, domain, id) {
  if (domain === 'character') return project.characters.find((item) => item.id === id)?.name ?? id;
  if (domain === 'worldbook') return project.worldbook.find((item) => item.id === id)?.title ?? id;
  if (domain === 'rules') return project.rules.find((item) => item.id === id)?.title ?? id;
  if (domain === 'ejs') return project.ejsCharacters.find((item) => item.id === id)?.name ?? id;
  return id;
}

/** 读一个目标对象的正文（等价墨月 targets[target_id] 里的那段 JSON）。 */
export function readTarget(project, domain, targetId) {
  if (domain === 'character') {
    const character = project.characters.find((item) => item.id === targetId);
    if (!character) return undefined;
    return JSON.stringify({
      id: character.id, name: character.name,
      basic_information: character.basicInformation, life_structure: character.lifeStructure,
      character_nature: character.characterNature, scene_expression: character.sceneExpression,
      clothing_style: character.clothingStyle, test_notes: character.notes,
    });
  }
  if (domain === 'worldbook') {
    const entry = project.worldbook.find((item) => item.id === targetId);
    if (!entry) return undefined;
    return JSON.stringify({
      id: entry.id, title: entry.title, content: entry.content, keys: entry.keys,
      secondary_keys: entry.secondaryKeys, activation: entry.activation, placement: entry.placement,
      depth: entry.depth, order: entry.order, probability: entry.probability, enabled: entry.enabled,
      ...(entry.scale ? { scale: entry.scale } : {}),
    });
  }
  if (domain === 'rules') {
    const rule = project.rules.find((item) => item.id === targetId);
    return rule ? JSON.stringify(rule) : undefined;
  }
  if (domain === 'ejs') {
    const item = project.ejsCharacters.find((entry) => entry.id === targetId);
    return item ? JSON.stringify(item) : undefined;
  }
  if (domain === 'carddata') {
    const data = project.importedCard?.raw;
    if (!data) return undefined;
    const nested = objectValue(data.data);
    const root = Object.keys(nested).length ? nested : data;
    if (targetId.startsWith('field:')) {
      const key = targetId.slice(6);
      return typeof root[key] === 'string' ? root[key] : JSON.stringify(root[key] ?? null, null, 2);
    }
    const extensions = objectValue(root.extensions);
    if (targetId.startsWith('regex:')) {
      return JSON.stringify(objectValue(extensions.regex_scripts?.[Number(targetId.slice(6))]) ?? null, null, 2);
    }
    if (targetId.startsWith('script:')) {
      const helper = objectValue(extensions.tavern_helper);
      return JSON.stringify(objectValue(helper.scripts?.[Number(targetId.slice(7))]) ?? null, null, 2);
    }
  }
  return undefined;
}

/** 页面级内容（不带 target_id 时读这一页）。 */
export function readSection(project, domain) {
  if (domain === 'overview') return `<project title="${project.title}">\n<summary>${project.summary}</summary>\n</project>`;
  if (domain === 'package') return JSON.stringify({ page: '检查与导出', note: '这是结构检查，不代表已经在酒馆运行。' });
  if (domain === 'opening') return JSON.stringify(project.opening);
  if (domain === 'mvu') return JSON.stringify(project.mvu);
  if (domain === 'statusbar') return JSON.stringify(project.statusbar);
  if (domain === 'frontend') return JSON.stringify(project.frontend);
  const list = targets(project, domain);
  return JSON.stringify({ [domain]: list });
}

/**
 * 字面搜索（等价 moyu_search_workspace）。query 不是正则。
 * @returns {{ matches: Array<{section,target_id?,excerpt}>, total, next_offset }}
 */
export function searchWorkspace(project, domains, query, offset = 0, limit = 30) {
  const needle = String(query).toLocaleLowerCase();
  if (!needle) return { matches: [], total: 0, next_offset: null };
  const matches = [];
  for (const domain of domains) {
    const entries = [['', readSection(project, domain)], ...targets(project, domain).map((item) => [item.target_id, readTarget(project, domain, item.target_id) ?? ''])];
    for (const [targetId, content] of entries) {
      const index = content.toLocaleLowerCase().indexOf(needle);
      if (index < 0) continue;
      matches.push({
        section: domain,
        ...(targetId ? { target_id: targetId } : {}),
        excerpt: content.slice(Math.max(0, index - 80), index + needle.length + 180),
      });
    }
  }
  return {
    matches: matches.slice(offset, offset + limit),
    total: matches.length,
    next_offset: offset + limit < matches.length ? offset + limit : null,
  };
}

export function sliceContent(content, offset = 0, limit = 12_000) {
  return {
    content: content.slice(offset, offset + limit),
    offset,
    total_characters: content.length,
    next_offset: offset + limit < content.length ? offset + limit : null,
  };
}

export const MAX_READ_LENGTH = 24_000;

/** 等价墨月 allowedMoyuAgentTools 的裁剪规则：哪些工具本轮可用。 */
export function allowedTools({ hasContexts, artifactIntent, workspaceCheck, selfCheck, batch }) {
  const names = [];
  if (hasContexts) names.push('moyu_read_authorized_context', 'moyu_search_workspace');
  if (workspaceCheck) names.push('moyu_check_current_workspace');
  if (artifactIntent) names.push('moyu_prepare_artifact');
  if (artifactIntent && batch && !selfCheck) names.push('moyu_prepare_batch');
  return names;
}

function objectValue(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}
