/**
 * 代码块与工件外壳工具 —— 逐字移植墨月 `response.ts` 的相关部分。
 * 任何对墨月行为的偏离都必须在此注明。
 */
import { configuredTextBlocks } from './configured.mjs';

export function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 取指定语言标记的第一个闭合代码块内容。 */
export function codeBlock(content, ...languages) {
  for (const match of content.matchAll(/^```([a-z0-9_+-]*)\s*\r?\n([\s\S]*?)^```\s*$/gim)) {
    if (languages.includes((match[1] || '').toLowerCase())) return (match[2] || '').trim();
  }
  return '';
}

/** 指定语言则取该语言的块；否则取 text/txt/无标记的块；再否则整段去围栏。 */
export function singleArtifactSource(content, ...languages) {
  const matched = languages.length ? codeBlock(content, ...languages) : codeBlock(content, 'text', 'txt', '');
  if (matched) return matched;
  const trimmed = content.trim();
  const onlyFence = trimmed.match(/^```[a-z0-9_+-]*\s*\r?\n([\s\S]*?)\r?\n?```$/i);
  return (onlyFence?.[1] ?? trimmed).trim();
}

/** 清理 qk-unit 控制注释（正文写入前必经）。 */
export function stripArtifactControlMarkers(content) {
  return content
    .replace(/<!--\s*@qk-unit\b[\s\S]*?-->\s*/gi, '')
    .replace(/\/\*\s*@qk-unit\b[\s\S]*?\*\/\s*/gi, '')
    .replace(/<%#\s*@qk-unit\b[\s\S]*?%>\s*/gi, '')
    .replace(/^\s*(?:#|\/\/)\s*@qk-unit\b.*(?:\r?\n|$)/gim, '')
    .trim();
}

export function textArtifactTask(taskId) {
  return taskId.startsWith('airp_') || taskId === 'npc_light_habitat' || taskId === 'opening_style_then_draft';
}

export function detectFormat(content) {
  return content.match(/^```([a-z0-9_-]+)/im)?.[1] || (/^\s*</.test(content) ? 'xml' : 'text');
}

/**
 * repair 级规范化：网页能百分百确定的外层结构，本地直接补好，不让模型重生成。
 * 返回 { content, diagnostics }，diagnostics 均为 severity='repair'。
 */
export function normalizeArtifactContent(taskId, content) {
  let normalized = stripArtifactControlMarkers(content);
  const diagnostics = [];
  const repaired = (code, title, detail, fix) => {
    diagnostics.push({
      code, severity: 'repair', title, location: '成品外层结构', detail,
      impact: '网页已经在本地补好，不需要模型重新生成。', fix,
    });
  };

  if (taskId === 'frontend_build') {
    const before = normalized;
    normalized = normalized
      .replace(/^```(?:txt|plaintext)\s*$/gim, '```text')
      .replace(/^```(?:htm|xhtml)\s*$/gim, '```html');
    if (normalized !== before) repaired('canonical-fence-language', '已统一代码块名称', '模型使用了可识别的同义代码块名称。', '已把 txt/plaintext 统一为 text，把 htm/xhtml 统一为 html。');
  }

  const fenceCount = normalized.match(/^```[a-z0-9_+-]*\s*$/gim)?.length ?? 0;
  if (fenceCount % 2 === 1) {
    normalized = `${normalized.trimEnd()}\n\n\`\`\``;
    repaired('close-code-fence', '已补全代码块结尾', '回复只有一个明确未闭合的代码围栏。', '已在成品末尾补上缺少的代码围栏。');
  }

  if (/^worldview_(?:small|medium|large)$/.test(taskId) || taskId === 'creation_rules') {
    const before = normalized;
    const yamlStart = normalized.search(/^```ya?ml\s*$/im);
    if (yamlStart > 0 && !normalized.slice(0, yamlStart).includes('```')) {
      const textPart = normalized.slice(0, yamlStart).trimEnd();
      const opening = textPart.match(/^<([^<>\s/]+)(?:\s[^>]*)?>/);
      const tag = opening?.[1] ?? '';
      if (tag && !new RegExp(`<\\/${escapeRegex(tag)}\\s*>\\s*$`, 'i').test(textPart)) {
        normalized = `${textPart}\n</${tag}>\n\n${normalized.slice(yamlStart)}`;
        repaired('close-configured-tag', '已补全世界书正文结束标签', `正文以 <${tag}> 开始，配套 YAML 的边界清楚，但正文缺少 </${tag}>。`, `已在 YAML 之前补上 </${tag}>；正文内容与配置没有改动。`);
      }
    }
    if (!configuredTextBlocks(normalized).length) {
      normalized = normalized.replace(
        /(^|\n)(<([^\s<>/]+)(?:\s[^>]*)?>[\s\S]*?<\/\3>\s*)(?=\n?```ya?ml\b)/gi,
        (_match, prefix, body) => `${prefix}\`\`\`text\n${body.trim()}\n\`\`\`\n`,
      );
    }
    if (normalized !== before) repaired('wrap-configured-text', '已补全世界书正文代码块', '正文标签完整，且后方存在配套 YAML，只缺少 text 代码块外壳。', '已在不改动正文与配置的前提下补上 text 代码块。');
  }

  if (textArtifactTask(taskId) && !normalized.includes('```')) {
    const opening = normalized.match(/^<([^<>\s/]+)(?:\s[^>]*)?>/);
    const tag = opening?.[1] ?? '';
    if (tag && !new RegExp(`<\\/${escapeRegex(tag)}\\s*>\\s*$`, 'i').test(normalized)) {
      normalized = `${normalized.trimEnd()}\n</${tag}>`;
      repaired('close-outer-tag', '已补全正文结束标签', `正文以 <${tag}> 开始，且末尾没有对应结束标签。`, `已在末尾补上 </${tag}>；正文内容没有改动。`);
    }
  }

  return { content: normalized.trim(), diagnostics };
}
