/**
 * 成品审阅总入口 —— 逐字移植墨月 `response.ts` 的 review 部分
 * 与 `workspace-validation.ts` 的 workspaceArtifactReview（交叉检查联动）。
 */
import { codeBlock, singleArtifactSource, normalizeArtifactContent } from './fences.mjs';
import { configuredTextArtifactIssues, configuredTextBlocks } from './configured.mjs';
import { inspectYamlMapping } from './yaml.mjs';
import { mvuSchemaIssues, checkMvuFiles } from './mvu.mjs';
import { statusbarArtifactIssues } from './html.mjs';
import { frontendArtifactIssues } from './html.mjs';
import { ejsArtifactIssues } from './ejs.mjs';
import { issueDiagnostic, advisoryArtifactDiagnostics, mvuCrossDiagnostic } from './diagnostics.mjs';

export function artifactCompletionIssues(taskId, content, contract = '') {
  return reviewArtifactContent(taskId, content, contract).diagnostics
    .filter((item) => item.severity === 'error')
    .map((item) => item.detail);
}

export function reviewArtifactContent(taskId, content, contract = '') {
  const normalized = normalizeArtifactContent(taskId, content);
  const blocking = blockingArtifactIssues(taskId, normalized.content, contract)
    .map((message, index) => issueDiagnostic(message, index));
  const warnings = advisoryArtifactDiagnostics(taskId, normalized.content);
  return {
    content: normalized.content,
    diagnostics: [...normalized.diagnostics, ...blocking, ...warnings],
  };
}

export function blockingArtifactIssues(taskId, content, contract = '') {
  if (taskId === 'free_creation' && contract.startsWith('moyu-card-edit:')) {
    const issue = importedCardArtifactIssue(content, contract.slice('moyu-card-edit:'.length));
    return issue ? [issue] : [];
  }
  if (!content.trim()) return ['没有收到可以写入当前目标的成品'];
  const issues = [];
  const languages = [...content.matchAll(/^```([a-z0-9_+-]*)\s*$/gim)].map((match) => (match[1] || '').toLowerCase());
  const has = (...expected) => languages.some((language) => expected.includes(language));
  if (taskId === 'mvu_initvar_formatting' || taskId === 'mvu_update_rule_formatting') {
    const yaml = singleArtifactSource(content, 'yaml', 'yml');
    if (!yaml) issues.push('没有找到完整 YAML 工件');
    else {
      const yamlIssue = inspectYamlMapping(yaml).issue;
      if (yamlIssue) issues.push(yamlIssue);
    }
  } else if (taskId === 'opening_style_then_draft') {
    if (/<开场白_文风约定>/.test(content)) issues.push('文风约定只属于 AI 解答区的协作过程，不能写入中央开场白');
    if (!singleArtifactSource(content)) issues.push('没有找到可以写入首条消息的开场白正文');
  } else if (/^worldview_(?:small|medium|large)$/.test(taskId)) {
    issues.push(...configuredTextArtifactIssues(content));
    const blocks = configuredTextBlocks(content);
    if (taskId === 'worldview_small' && blocks.length !== 1) issues.push('小型世界观只能建立一个世界书条目');
    for (const block of blocks) {
      const config = block.config;
      if (!config['条目名称']) issues.push(`${block.tag} 的配置缺少条目名称`);
      if (!/^(?:蓝灯|绿灯|待动态加载)/.test(config['激活策略'] || '')) issues.push(`${block.tag} 的配置缺少明确激活策略`);
      if (config['插入位置'] !== '角色定义前') issues.push(`${block.tag} 必须放在角色定义前`);
      if (!/^\d+$/.test(config.order || '')) issues.push(`${block.tag} 的 order 必须是明确整数`);
      const probability = config['激活概率'] || '';
      if (!/^\d+$/.test(probability) || Number(probability) > 100) issues.push(`${block.tag} 的激活概率必须是 0—100 的整数`);
      if (/绿灯|关键词/.test(config['激活策略']) && !config['关键词']?.trim()) issues.push(`${block.tag} 使用关键词触发时必须提供关键词`);
    }
  } else if (taskId === 'creation_rules') {
    issues.push(...configuredTextArtifactIssues(content));
    for (const block of configuredTextBlocks(content)) {
      const config = block.config;
      if (!config['条目名称']) issues.push(`${block.tag} 的配置缺少条目名称`);
      if (!/^(?:蓝灯|绿灯)/.test(config['激活策略'] || '')) issues.push(`${block.tag} 的配置缺少明确激活策略`);
      if (!/^(?:指定深度|角色定义前|角色定义后)$/.test(config['插入位置'] || '')) issues.push(`${block.tag} 的配置缺少明确插入位置`);
      if (!/^\d+$/.test(config.order || '')) issues.push(`${block.tag} 的 order 必须是明确整数`);
      if (config['插入位置'] === '指定深度' && !/^\d+$/.test(config.depth || '')) issues.push(`${block.tag} 的 depth 必须是明确整数`);
    }
  } else if (taskId === 'mvu_schema_compilation') {
    const script = singleArtifactSource(content, 'js', 'javascript');
    if (!script) issues.push('没有找到完整变量结构脚本');
    else issues.push(...mvuSchemaIssues(script));
  } else if (taskId === 'mvu_statusbar_native_build' || taskId === 'mvu_statusbar_vue_build') {
    const html = singleArtifactSource(content, 'html');
    if (!html) issues.push('没有找到完整状态栏 HTML');
    else issues.push(...statusbarArtifactIssues(html, taskId === 'mvu_statusbar_vue_build' ? 'vue' : 'native'));
  } else if (taskId === 'frontend_build') {
    if (!has('text')) issues.push('消息前端缺少独立的运行提示词代码块');
    if (!has('html')) issues.push('消息前端缺少独立的完整 HTML 代码块');
    if (has('text') && has('html')) issues.push(...frontendArtifactIssues(codeBlock(content, 'text'), codeBlock(content, 'html'), contract));
  } else if (taskId === 'ejs_build') {
    const source = singleArtifactSource(content, 'js', 'javascript', 'ejs');
    if (!source) issues.push('没有找到完整 EJS 工件');
    else issues.push(...ejsArtifactIssues(source));
  }
  return [...new Set(issues)];
}

/**
 * 工作区版审阅：在 blocking 通过后，再按当前作品的另外两份文件做交叉检查。
 * 各专项只看它需要的上游，不让旧文件阻挡当前修订。
 */
export function workspaceArtifactReview(project, taskId, content, contract = '') {
  const review = reviewArtifactContent(taskId, content, contract);
  if (review.diagnostics.some((item) => item.severity === 'error')) return review;
  let crossCheck;
  if (taskId === 'mvu_schema_compilation') {
    // 结构是第一份文件；后续文件还没生成不构成结构脚本错误。
    crossCheck = checkMvuFiles({ ...project.mvu, schemaSource: singleArtifactSource(review.content, 'js', 'javascript') }, false);
  } else if (taskId === 'mvu_initvar_formatting') {
    // 开局值对照已保存结构，不让旧变化规则阻挡当前初值修订。
    crossCheck = checkMvuFiles({ ...project.mvu, initvarSource: singleArtifactSource(review.content, 'yaml', 'yml'), updateRulesSource: '' }, false);
  } else if (taskId === 'mvu_update_rule_formatting') {
    crossCheck = checkMvuFiles({ ...project.mvu, updateRulesSource: singleArtifactSource(review.content, 'yaml', 'yml') }, false);
  } else return review;
  const crossDiagnostics = [...new Set(crossCheck.issues)].map((message, index) => mvuCrossDiagnostic(message, index));
  return { content: review.content, diagnostics: [...review.diagnostics, ...crossDiagnostics] };
}

export function parseImportedCardArtifact(content, target) {
  if (target.startsWith('field:')) {
    const value = singleArtifactSource(content);
    return value ? { value } : undefined;
  }
  const trimmed = content.trim();
  const fenced = trimmed.match(/^```json\s*\r?\n([\s\S]*?)\r?\n?```$/i);
  const source = fenced?.[1]?.trim() ?? trimmed;
  try {
    const value = JSON.parse(source);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    return { value };
  } catch {
    return undefined;
  }
}

function importedCardArtifactIssue(content, expectedTarget) {
  const artifact = parseImportedCardArtifact(content, expectedTarget);
  if (!artifact) return expectedTarget.startsWith('field:') ? '人物原文不能为空' : '正则或脚本必须是一个完整 JSON 对象';
  if (expectedTarget.startsWith('field:')) {
    if (typeof artifact.value !== 'string') return '人物原文必须是完整文本';
    return '';
  }
  if (expectedTarget.startsWith('regex:') || expectedTarget.startsWith('script:')) {
    if (!artifact.value || typeof artifact.value !== 'object' || Array.isArray(artifact.value)) return '正则或脚本必须是完整对象';
    return '';
  }
  return '当前原卡位置不能由 AI 直接写入';
}
