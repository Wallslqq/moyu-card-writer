/**
 * 状态栏与消息前端的确定性校验 —— 逐字移植墨月 `response.ts`。
 * 这些规则把"注意安全"变成"搜索这些字符串，结果必须为空"。
 */
import { htmlScriptSyntaxIssues } from './syntax.mjs';
import { escapeRegex } from './fences.mjs';

export function statusbarArtifactIssue(html, kind) {
  return statusbarArtifactIssues(html, kind)[0] ?? '';
}

export function statusbarArtifactIssues(html, kind) {
  const issues = [];
  const executable = executableHtml(html);
  if (!/<!doctype html>/i.test(html) || !/<html[\s>]/i.test(html) || !/<\/html>/i.test(html)
    || !/<head[\s>]/i.test(html) || !/<\/head>/i.test(html) || !/<body[\s>]/i.test(html) || !/<\/body>/i.test(html)) {
    issues.push('状态栏缺少完整 HTML 文档外壳');
  }
  const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
    .map((match) => match[1] || '')
    .filter((script) => script.trim());
  if (!scripts.length) issues.push('状态栏缺少读取 MVU 的运行脚本');
  else issues.push(...htmlScriptSyntaxIssues(html).map((issue) => `状态栏 ${issue}`));
  if (/\.innerHTML\s*=|insertAdjacentHTML\s*\(|document\.write\s*\(|v-html\s*=|\son(?:click|load|error)\s*=/i.test(executable)) {
    issues.push('状态栏出现合同禁止的动态 HTML 执行路径');
  }
  // 酒馆助手也允许直接读取消息变量，不能把固定生成骨架当成唯一合法代码。
  const usesMvu = /\bwaitGlobalInitialized\b/.test(executable) && /\bMvu\b[\s\S]*\bgetMvuData\b/.test(executable);
  if (!usesMvu && !/\bgetVariables\s*\(/.test(executable)) {
    issues.push('状态栏没有找到读取 MVU 数据的接口');
  }
  if (kind === 'vue' && !/(?:Vue\s*\.\s*)?createApp\s*\(/.test(executable)) issues.push('交互状态栏缺少 Vue 应用入口');
  if (/实际变量路径|实际初始值|实际字段/.test(executable)) issues.push('状态栏仍含没有替换的明确模板字段');
  return [...new Set(issues)];
}

export function frontendArtifactIssue(runtimeRule, html, contract) {
  return frontendArtifactIssues(runtimeRule, html, contract)[0] ?? '';
}

export function frontendArtifactIssues(runtimeRule, html, contract) {
  const issues = [];
  const executable = executableHtml(html);
  if (!/<!doctype html>/i.test(html) || !/<html[\s>]/i.test(html) || !/<\/html>/i.test(html)
    || !/<head[\s>]/i.test(html) || !/<\/head>/i.test(html) || !/<body[\s>]/i.test(html) || !/<\/body>/i.test(html)) {
    issues.push('消息前端缺少完整 HTML 文档外壳');
  }
  const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map((match) => match[1] || '');
  if (!scripts.length) issues.push('消息前端缺少运行脚本');
  else issues.push(...htmlScriptSyntaxIssues(html).map((issue) => `消息前端 ${issue}`));
  if (/\.innerHTML\s*=|insertAdjacentHTML\s*\(|document\.write\s*\(|v-html\s*=|\son(?:click|load|error)\s*=/i.test(executable)) {
    issues.push('消息前端出现合同禁止的动态 HTML 执行路径');
  }
  if (/(?:\blocalStorage\b|\bsessionStorage\b|\bindexedDB\b)\s*(?:\.|\[)|\bdocument\s*\.\s*cookie\b|\bcaches\s*\./i.test(executable)) {
    issues.push('消息前端不能使用浏览器持久化存储；请把界面状态保存在当前脚本内存，主题跟随系统时使用 prefers-color-scheme');
  }
  if (contract.includes('getChatMessages') && !/\bgetChatMessages\b/.test(executable)) issues.push('消息前端没有读取当前楼层消息');
  if (contract.includes('getCurrentMessageId') && !/\bgetCurrentMessageId\b/.test(executable)) issues.push('消息前端没有取得当前楼层 ID');
  const outerTag = contract.match(/唯一外层标签\s*[：:]\s*`?<?([^\s<>/`]+)[^>\r\n]*>?`?/i)?.[1];
  if (outerTag) {
    const escaped = escapeRegex(outerTag);
    if (!new RegExp(`<${escaped}(?:\\s[^>]*)?>[\\s\\S]*?<\\/${escaped}\\s*>`, 'i').test(runtimeRule)) issues.push(`运行提示词没有完整输出 <${outerTag}>`);
    if (!executable.includes(outerTag)) issues.push(`消息前端没有解析 <${outerTag}>`);
  }
  // 布局和动画降级由实际页面验收；媒体查询的有无不能证明是否响应式或是否产生动画。
  const interaction = contract.match(/本地交互[：:]([^\r\n]*)/)?.[1]?.trim() ?? '';
  if (interaction && !/^(?:无|不需要|无需|没有|仅展示|纯展示)(?:[（(].*?[）)])?[。.]?$/.test(interaction) && !/<button[\s>]/i.test(executable)) issues.push('消息前端漏掉了合同中的本地交互按钮');
  return [...new Set(issues)];
}

export function executableHtml(source) {
  return source.replace(/<!--[\s\S]*?-->/g, '');
}
