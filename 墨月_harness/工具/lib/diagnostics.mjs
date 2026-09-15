/**
 * 诊断与四段式处方 —— 逐字移植墨月 `response.ts` 与 `workspace-validation.ts`。
 * 处方表的作用：让修复轮只改被点名的地方，不会演变成偷偷重写。
 */

export function issueDiagnostic(message, index) {
  const syntax = /(?:语法错误|解析失败)/.test(message);
  const missing = /(?:没有找到|缺少|尚未完成|为空)/.test(message);
  const mismatch = /(?:不一致|不存在|必须|不能|不应)/.test(message);
  return {
    code: `artifact-error-${index + 1}`,
    severity: 'error',
    title: syntax ? '代码或数据语法无法解析' : missing ? '缺少写入所需内容' : mismatch ? '成品与当前专项要求不一致' : '成品无法安全写入',
    location: diagnosticLocation(message),
    detail: message,
    impact: '这个问题会让成品无法可靠解析、写入或运行，因此当前版本不会进入中央成品。',
    fix: diagnosticFix(message),
  };
}

export function diagnosticLocation(message) {
  const line = message.match(/第\s*\d+\s*行(?:，第\s*\d+\s*列)?/)?.[0];
  if (line) return line;
  const taggedBlock = message.match(/<([^<>\s/]+)>/)?.[1];
  if (taggedBlock) return `<${taggedBlock}> 对应的正文或配置`;
  if (/YAML|开局值|变化规则/.test(message)) return 'YAML 文件';
  if (/变量结构|Zod|registerMvuSchema/.test(message)) return '变量结构脚本';
  if (/运行提示词/.test(message)) return '运行提示词';
  if (/HTML|状态栏|消息前端/.test(message)) return 'HTML 文件';
  if (/EJS/.test(message)) return 'EJS 工件';
  if (/配置|order|depth|激活|插入位置|关键词/.test(message)) return '正文后方的 YAML 配置';
  return '当前成品';
}

export function diagnosticFix(message) {
  if (/YAML 语法错误/.test(message)) return '只修复报错行附近的缩进、冒号、引号或括号，使整份 YAML 可以解析；不要改名或重排其他字段。';
  if (/语法错误/.test(message)) return '只修复报错行列附近的括号、引号、逗号或标签闭合；保留其余已经正确的代码。';
  if (/运行提示词代码块/.test(message)) return '保留现有 HTML，并补交一个独立的 ```text 运行提示词代码块。';
  if (/完整 HTML 代码块/.test(message)) return '保留现有运行提示词，并补交一个从 doctype 到 html 结束标签完整闭合的 ```html 代码块。';
  if (/完整 HTML 文档外壳/.test(message)) return '补齐 <!doctype html>、html、head 与 body 的开始和结束标签，不改动已有页面内容。';
  if (/独立且闭合的正文代码块/.test(message)) return '保留已有正文与 YAML；将正文放进独立的 ```text 代码块，并确保正文自己的外层标签成对闭合。';
  if (/配对的 YAML 配置/.test(message)) return '保留该正文，在它后方补上当前专项要求的独立 ```yaml 配置代码块；不要改动其他正文块。';
  if (/配置缺少条目名称/.test(message)) return '只在该正文对应的 YAML 配置中补上真实条目名称。';
  if (/配置缺少明确激活策略/.test(message)) return '只在该正文对应的 YAML 配置中填写当前专项允许的蓝灯或绿灯激活策略。';
  if (/运行脚本/.test(message)) return '在完整 HTML 内补上真正执行当前功能的 script；不要只写静态占位页面。';
  if (/读取 MVU/.test(message)) return '保留原有渲染逻辑，核对当前楼层的 Mvu.getMvuData 或 getVariables 读取调用；使用 Mvu 时先等待其就绪。';
  if (/Vue 应用入口/.test(message)) return '在现有 HTML 中补上 createApp 的真实应用入口，并保持当前页面结构。';
  if (/动态 HTML/.test(message)) return '把 innerHTML、insertAdjacentHTML、document.write、v-html 或内联事件改成 textContent、DOM 节点、Vue 模板绑定或 addEventListener。';
  if (/持久化存储/.test(message)) return '移除 localStorage、sessionStorage、indexedDB、cookie 或 Cache Storage 的真实读写；状态只保留在当前页面内存。';
  if (/外层标签/.test(message)) return '让运行提示词完整输出合同指定的唯一外层标签，并让 HTML 解析同一个标签名。';
  if (/JSON 对象/.test(message)) return '只输出一个语法完整的 JSON 对象，保留原对象中未要求修改的字段，不添加说明文字。';
  if (/order/.test(message)) return '只把对应配置的 order 改成明确整数。';
  if (/depth/.test(message)) return '只把对应配置的 depth 改成明确整数。';
  if (/激活概率/.test(message)) return '只把激活概率改成 0 到 100 的整数。';
  if (/关键词/.test(message)) return '只为该绿灯条目填写至少一个真实触发关键词。';
  if (/插入位置/.test(message)) return '只把插入位置改成当前专项允许的明确位置。';
  if (/registerMvuSchema/.test(message)) return '在现有变量结构脚本中注册已经建立的 Schema，不重写字段。';
  if (/Zod 4/.test(message)) return '用现有环境提供的 z 建立变量结构，保持字段名和类型与开局值一致。';
  if (/zod 或 lodash/.test(message)) return '删除对 zod 或 lodash 的额外导入，直接使用酒馆助手已经提供的 z 与 _。';
  if (/coerce\.boolean/.test(message)) return '只把真假字段改为 z.boolean()，不要改变其他字段类型。';
  if (/passthrough|strict/.test(message)) return '只移除 .passthrough() 或 .strict()，保留对象内部字段。';
  if (/文风约定/.test(message)) return '删除写入正文中的文风讨论，只保留最终开场白正文。';
  return `只修复这一项：${message}。保留所有未被这条错误点名的内容、顺序、命名和作者需求。`;
}

export function advisoryArtifactDiagnostics(taskId, content) {
  const warnings = [];
  if (['mvu_initvar_formatting', 'mvu_update_rule_formatting', 'mvu_schema_compilation', 'mvu_statusbar_native_build', 'mvu_statusbar_vue_build', 'frontend_build', 'ejs_build'].includes(taskId)
    && /(?:\bTODO\b|待补充)/i.test(content)) {
    warnings.push({
      code: 'possible-placeholder', severity: 'warning', title: '发现疑似占位文字', location: '成品正文或代码',
      detail: '成品中出现了“TODO”或“待补充”。它可能是作者确实需要显示的文字，也可能是模型忘记替换的模板。',
      impact: '静态检查无法百分之百判断，因此不会删除内容，也不会阻止写入。',
      fix: '确认它是正式内容即可保留；若它代表未完成位置，请让 AI 只替换该处。',
    });
  }
  return warnings;
}

export function formatArtifactIssues(issues) {
  if (!issues.length) return '';
  return issues.length === 1
    ? issues[0]
    : `发现 ${issues.length} 个需要修正的问题：${issues.map((issue, index) => `${index + 1}. ${issue}`).join('；')}`;
}

export function formatArtifactDiagnostics(diagnostics) {
  const errors = diagnostics.filter((item) => item.severity === 'error');
  if (!errors.length) return '';
  return [
    `发现 ${errors.length} 个阻止写入的问题：`,
    ...errors.map((item, index) => [
      `${index + 1}. 【${item.title}】`,
      `位置：${item.location}`,
      `错误：${item.detail}`,
      `影响：${item.impact}`,
      `修复：${item.fix}`,
    ].join('\n')),
  ].join('\n\n');
}

export function mvuCrossDiagnostic(message, index) {
  const path = message.match(/：(.+)$/)?.[1]?.trim() ?? '';
  let location = 'MVU 三份文件';
  let fix = `只修复这项对应关系：${message}。未被点名的变量、类型和规则不得改动。`;
  if (/变量结构缺少开局值字段/.test(message)) {
    location = `变量结构与开局值${path ? `：${path}` : ''}`;
    fix = `对照已确认的变量结构，核对这些初始字段是否属于作者要求：${path || '报错中列出的字段'}。只修正出错的文件；新增字段须先确认结构，不因开局值多出字段就自动扩展 Schema。`;
  } else if (/变量结构存在开局值中没有的字段/.test(message)) {
    location = `开局值${path ? `：${path}` : ''}`;
    fix = `按已确认结构补齐这些必需字段的开局值：${path || '报错中列出的字段'}。具体初值未确认时询问作者，不通过删除正确的 Schema 字段绕过。`;
  } else if (/变量类型不一致/.test(message)) {
    location = `变量结构与开局值${path ? `：${path}` : ''}`;
    fix = `按已确认结构核对这些初值的类型：${path || '报错中列出的字段'}。修正错误一侧，不为了接受错误初值就改写正确的结构类型。`;
  } else if (/变化规则引用了变量结构与开局值中都不存在的路径/.test(message)) {
    location = `变化规则${path ? `：${path}` : ''}`;
    fix = `核对“变量结构”和“开局值”中的真实路径，再修正“变化规则”：${path || '报错中列出的路径'}。如果确需新增变量，先在“变量结构”确认，再补开局值。`;
  } else if (/变化规则不应更新只读字段/.test(message)) {
    location = `变化规则${path ? `：${path}` : ''}`;
    fix = `从变化规则中移除这些以下划线开头的只读路径：${path || '报错中列出的路径'}。`;
  } else if (/check 必须是简洁自然语言/.test(message)) {
    location = `变化规则${path ? `：${path}` : ''}`;
    fix = `把这些 check 中的 JavaScript 改成简短自然语言条件，只说明什么时候更新：${path || '报错中列出的路径'}。`;
  }
  return {
    code: `mvu-cross-${index + 1}`,
    severity: 'error',
    title: 'MVU 三份文件没有一一对应',
    location,
    detail: message,
    impact: '变量初始化、更新或运行时校验会引用不同的结构，当前成品不能安全写入。',
    fix,
  };
}
