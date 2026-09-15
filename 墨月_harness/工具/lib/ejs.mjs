/**
 * EJS 工件校验 —— 逐字移植墨月 `response.ts`。
 * 关键点：ST-Prompt-Template 的读取函数大小写固定为 getvar，且不提供 getMvuData/getVariables。
 */
import { ejsSyntaxIssues } from './syntax.mjs';

export function ejsArtifactIssue(source) {
  return ejsArtifactIssues(source)[0] ?? '';
}

export function ejsArtifactIssues(source) {
  const issues = [];
  const openCount = source.match(/<%/g)?.length ?? 0;
  const closeCount = source.match(/%>/g)?.length ?? 0;
  if (!openCount || openCount !== closeCount) issues.push('EJS 工件缺少闭合的 <% … %> 标签');
  if (/实际路径|实际初始值|实际比较条件|实际角色专属标签|完整差异正文/.test(source)) issues.push('EJS 仍含没有替换的明确模板字段');
  if (/\bgetVar\s*\(/.test(source)) issues.push('EJS 使用了不存在的 getVar；ST-Prompt-Template 的读取函数大小写固定为 getvar');
  if (/\b(?:getMvuData|getVariables)\s*\(/.test(source)) issues.push('EJS 使用了当前 ST-Prompt-Template 工件中未提供的变量读取函数；读取 MVU 字段应使用 getvar');
  if (openCount === closeCount) issues.push(...ejsSyntaxIssues(source).map((issue) => `EJS ${issue}`));
  return [...new Set(issues)];
}
