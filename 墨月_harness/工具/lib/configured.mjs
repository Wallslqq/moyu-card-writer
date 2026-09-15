/**
 * 世界书「正文 + 配对 YAML 配置」解析 —— 逐字移植墨月 `configured-artifact.ts`。
 */

export function configuredTextBlocks(source) {
  const blocks = fencedBlocks(source);
  const texts = blocks.flatMap((block) => {
    if (block.language && block.language !== 'text') return [];
    const tag = completeOuterTag(block.content);
    return tag ? [{ ...block, tag }] : [];
  });
  const configs = blocks
    .filter((block) => block.language === 'yaml' || block.language === 'yml')
    .map((block) => ({ ...block, values: flatYaml(block.content) }));
  const unused = new Set(configs.map((_, index) => index));

  return texts.map((block) => {
    const exact = configs.findIndex((config, index) => (
      unused.has(index)
      && normalizeTag(config.values['对应标签']) === block.tag
    ));
    const following = configs.findIndex((config, index) => unused.has(index) && config.index > block.index);
    const configIndex = exact >= 0 ? exact : following;
    if (configIndex >= 0) unused.delete(configIndex);
    return { tag: block.tag, content: block.content, config: configs[configIndex]?.values ?? {} };
  });
}

export function configuredTextArtifactIssue(source) {
  return configuredTextArtifactIssues(source)[0] ?? '';
}

export function configuredTextArtifactIssues(source) {
  const blocks = configuredTextBlocks(source);
  if (!blocks.length) return ['没有找到独立且闭合的正文代码块'];
  return blocks.flatMap((block) => (
    Object.keys(block.config).length ? [] : [`<${block.tag}> 后缺少与它配对的 YAML 配置`]
  ));
}

function fencedBlocks(source) {
  return [...source.matchAll(/^```([a-z0-9_+-]*)\s*\r?\n([\s\S]*?)^```\s*$/gim)]
    .map((match) => ({
      language: (match[1] || '').toLowerCase(),
      content: (match[2] || '').trim(),
      index: match.index ?? 0,
    }))
    .filter((block) => block.content);
}

function completeOuterTag(content) {
  const match = content.match(/^<([^<>\s]+)(?:\s[^>]*)?>[\s\S]*<\/([^<>\s]+)>\s*$/);
  return match?.[1] && match[1] === match[2] ? match[1] : '';
}

function flatYaml(source) {
  const values = {};
  for (const line of source.split(/\r?\n/)) {
    const match = line.match(/^\s*([^:#][^:：]*?)\s*[：:]\s*(.*?)\s*$/);
    if (!match?.[1]) continue;
    values[match[1].trim()] = (match[2] || '').trim().replace(/^['"]|['"]$/g, '');
  }
  return values;
}

function normalizeTag(value = '') {
  return value.trim().replace(/^<|>$/g, '');
}
