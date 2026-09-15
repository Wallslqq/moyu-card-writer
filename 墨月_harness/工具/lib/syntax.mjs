/**
 * JavaScript / HTML 内脚本 / EJS 语法检查 —— 逐字移植墨月 `javascript-syntax.ts`。
 * 使用与墨月相同的 `acorn`（vendored）。
 */
import { parse } from 'acorn';

export function javascriptSyntaxIssue(source, sourceType = 'script') {
  try {
    parse(source, { ecmaVersion: 'latest', sourceType });
    return '';
  } catch (error) {
    const message = String(error.message ?? '').replace(/\s*\(\d+:\d+\)\s*$/, '');
    if (!error.loc) return message || '无法解析 JavaScript';
    return `第 ${error.loc.line} 行，第 ${error.loc.column + 1} 列：${message}`;
  }
}

export function htmlScriptSyntaxIssues(html) {
  const issues = [];
  let scriptIndex = 0;
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const attributes = match[1] || '';
    const source = match[2] || '';
    if (!source.trim() || !isJavaScriptType(attributes)) continue;
    scriptIndex += 1;
    const sourceType = /\btype\s*=\s*(["'])module\1/i.test(attributes) ? 'module' : 'script';
    const issue = javascriptSyntaxIssue(source, sourceType);
    if (issue) issues.push(`第 ${scriptIndex} 段脚本 ${issue}`);
  }
  return issues;
}

export function ejsSyntaxIssues(source) {
  const controls = [];
  const expressions = [];
  for (const match of source.matchAll(/<%([#=_-]?)([\s\S]*?)_?%>/g)) {
    const marker = match[1] || '';
    const body = (match[2] || '').trim();
    if (!body || marker === '#') continue;
    const line = lineAt(source, match.index ?? 0);
    if (marker === '=' || marker === '-') expressions.push({ source: body, line });
    else controls.push(`${'\n'.repeat(Math.max(0, line - 1))}${body}`);
  }

  const issues = [];
  if (controls.length) {
    const issue = javascriptSyntaxIssue(`async function __moyu_ejs__() {${controls.join('\n')}\n}`, 'script');
    if (issue) issues.push(`控制代码${issue}`);
  }
  for (const expression of expressions) {
    const issue = javascriptSyntaxIssue(`void (${expression.source});`, 'script');
    if (issue) issues.push(`第 ${expression.line} 行的输出表达式：${issue}`);
  }
  return issues;
}

function isJavaScriptType(attributes) {
  const type = attributes.match(/\btype\s*=\s*(["'])(.*?)\1/i)?.[2]?.trim().toLowerCase();
  return !type || type === 'module' || type === 'text/javascript' || type === 'application/javascript';
}

function lineAt(source, index) {
  return source.slice(0, index).split('\n').length;
}
