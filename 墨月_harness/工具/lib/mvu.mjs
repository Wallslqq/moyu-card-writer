/**
 * MVU 三份文件的确定性校验 —— 逐字移植墨月 `mvu-check.ts` + `response.ts` 的 mvuSchemaIssues。
 *
 * 覆盖：Zod 结构形状、YAML 语法与嵌套、初值/结构类型一致、规则路径对应、只读字段、check 语义。
 * 明确不覆盖（见 limitations）：空集合的未来项目类型、transform 幂等、真实运行结果。
 */
import { parse as parseJavaScript } from 'acorn';
import { parse as parseYaml } from 'yaml';
import { inspectYamlMapping, stripYamlFence } from './yaml.mjs';
import { javascriptSyntaxIssue } from './syntax.mjs';

export function mvuSchemaIssue(script) {
  return mvuSchemaIssues(script)[0] ?? '';
}

export function mvuSchemaIssues(script) {
  const issues = [];
  if (!/registerMvuSchema\s*\(/.test(script)) issues.push('变量结构脚本没有调用 registerMvuSchema');
  if (!/\bz\s*\./.test(script)) issues.push('变量结构脚本没有建立 Zod 4 结构');
  if (/\bfrom\s*['"](?:zod|lodash)['"]|\brequire\s*\(\s*['"](?:zod|lodash)['"]\s*\)/i.test(script)) {
    issues.push('变量结构脚本不应导入 zod 或 lodash；酒馆助手已经提供 z 与 _');
  }
  if (/z\.coerce\.boolean\s*\(/.test(script)) issues.push('真假变量必须使用 z.boolean()，不能使用 z.coerce.boolean()');
  if (/\.(?:passthrough|strict)\s*\(/.test(script)) issues.push('Zod 4 变量结构不能使用 .passthrough() 或 .strict()');
  const syntaxIssue = javascriptSyntaxIssue(script, 'module');
  if (syntaxIssue) issues.push(`变量结构脚本语法错误：${syntaxIssue}`);
  return issues;
}

export function checkMvuFiles(mvu, requireComplete = true) {
  const checked = [
    ['变量结构', mvu.schemaSource], ['开局值', mvu.initvarSource], ['变化规则', mvu.updateRulesSource],
  ].filter(([, source]) => source.trim()).map(([label]) => label);
  const issues = [];
  const missing = [
    ['变量结构', mvu.schemaSource],
    ['开局值', mvu.initvarSource],
    ['变化规则', mvu.updateRulesSource],
  ].filter(([, source]) => !source.trim()).map(([label]) => label);
  if (requireComplete && missing.length) issues.push(`${missing.join('、')}尚未完成`);

  for (const [label, source] of [
    ['变量结构', mvu.schemaSource],
    ['开局值', mvu.initvarSource],
    ['变化规则', mvu.updateRulesSource],
  ]) {
    if (source.trim() && /实际(?:变量|路径|初始值)|请(?:自行|在此)(?:填写|替换|补充)/.test(source)) {
      issues.push(`${label}仍含没有替换的明确模板字段`);
    }
  }

  const initvarDocument = inspectYamlMapping(mvu.initvarSource);
  const updateRulesDocument = inspectYamlMapping(mvu.updateRulesSource);
  const updateRulesTopLevel = updateRulesDocument.nestedKeys('变量更新规则');
  const schemaEntries = inspectSchemaEntries(mvu.schemaSource);
  const schemaKeys = topLevelKeys(schemaEntries);

  if (initvarDocument.issue) issues.push(`开局值${initvarDocument.issue}`);
  if (updateRulesDocument.issue) issues.push(`变化规则${updateRulesDocument.issue}`);
  if (mvu.initvarSource.trim() && initvarDocument.keys.includes('stat_data')) issues.push('开局值不应包含 stat_data 外壳');
  if (mvu.updateRulesSource.trim() && !updateRulesTopLevel.rootFound) issues.push('变化规则缺少“变量更新规则”根节点');
  const schemaIssue = mvu.schemaSource.trim() ? mvuSchemaIssue(mvu.schemaSource) : '';
  if (schemaIssue) issues.push(schemaIssue);

  const initEntries = mvu.initvarSource.trim() && !initvarDocument.issue
    ? yamlEntries(parseYaml(stripYamlFence(mvu.initvarSource))) : undefined;
  // 规则生成当轮就核对真实路径；没有旧版设计终稿也能检查正式文件。
  if (mvu.updateRulesSource.trim() && !updateRulesDocument.issue) {
    const rules = ruleEntries(objectValue(parseYaml(stripYamlFence(mvu.updateRulesSource)))['变量更新规则']);
    // 默认值、可选字段可省略初值；已定义的结构路径仍是合法更新目标。
    const knownEntries = [...(initEntries ?? []), ...(!schemaIssue ? schemaEntries : [])];
    const unknownRules = initEntries || knownEntries.length
      ? rules.filter((rule) => !knownEntries.some((entry) => rulePathMatches(rule.path, entry.path))).map((rule) => displayPath(rule.path)) : [];
    const readonlyRules = rules.filter((rule) => rule.path.some((segment) => segment.startsWith('_'))).map((rule) => displayPath(rule.path));
    const codeChecks = rules.filter((rule) => containsExecutableRule(rule.check)).map((rule) => displayPath(rule.path));
    if (unknownRules.length) issues.push(`变化规则引用了变量结构与开局值中都不存在的路径：${summarizePaths(unknownRules)}`);
    if (readonlyRules.length) issues.push(`变化规则不应更新只读字段：${summarizePaths(readonlyRules)}`);
    if (codeChecks.length) issues.push(`变化规则的 check 必须是简洁自然语言，不能写成 JavaScript：${summarizePaths(codeChecks)}`);
  }
  if (initEntries && mvu.schemaSource.trim() && !schemaIssue) {
    const missingSchemaPaths = initEntries.filter((entry) => !schemaCovers(entry.path, schemaEntries)).map((entry) => displayPath(entry.path));
    const typeMismatches = initEntries.map((entry) => {
      const schema = schemaEntries.find((candidate) => samePath(candidate.path, entry.path));
      return schema && schema.kind !== 'unknown' && entry.kind !== 'null' && schema.kind !== entry.kind
        ? `${displayPath(entry.path)}（开局值为${kindLabel(entry.kind)}，变量结构为${kindLabel(schema.kind)}）`
        : '';
    }).filter(Boolean);
    const extraSchemaPaths = schemaEntries
      .filter((entry) => !initEntries.some((candidate) => samePath(candidate.path, entry.path)))
      .filter((entry) => !schemaEntries.some((candidate) => candidate.allowsMissing && (samePath(candidate.path, entry.path) || isPrefix(candidate.path, entry.path))))
      .map((entry) => displayPath(entry.path));

    if (missingSchemaPaths.length) issues.push(`变量结构缺少开局值字段：${summarizePaths(missingSchemaPaths)}`);
    if (extraSchemaPaths.length) issues.push(`变量结构存在开局值中没有的字段：${summarizePaths(extraSchemaPaths)}`);
    if (typeMismatches.length) issues.push(`变量类型不一致：${summarizePaths(typeMismatches)}`);
  }

  return {
    checked,
    issues: [...new Set(issues)],
    limitations: [
      '本地检查负责三份文件的语法、嵌套字段、当前值类型与规则路径对应。',
      '空集合的未来项目类型与固定选项需核对结构脚本，更新语义需核对已确认要求；transform 幂等需实际运行验证。',
      '最终运行结果仍需在 SillyTavern 的实际 MVU 环境中验证。',
    ],
    keys: { initvar: initvarDocument.keys, updateRules: updateRulesTopLevel.keys, schema: schemaKeys },
  };
}

function yamlEntries(value, path = [], entries = []) {
  if (Array.isArray(value)) {
    if (path.length) entries.push({ path, kind: 'array' });
    return entries;
  }
  if (value && typeof value === 'object') {
    if (path.length) entries.push({ path, kind: 'object' });
    for (const [key, nested] of Object.entries(value)) yamlEntries(nested, [...path, key], entries);
    return entries;
  }
  if (path.length) entries.push({ path, kind: value === null ? 'null' : typeofKind(value) });
  return entries;
}

function ruleEntries(value, path = [], entries = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return entries;
  const record = value;
  if (['check', 'type', 'range', 'format', 'category', 'value'].some((key) => Object.hasOwn(record, key))) {
    if (path.length) entries.push({ path, check: record.check });
    return entries;
  }
  for (const [key, nested] of Object.entries(record)) ruleEntries(nested, [...path, ...splitRuleKey(key)], entries);
  return entries;
}

function inspectSchemaEntries(source) {
  if (!source.trim()) return [];
  try {
    const program = parseJavaScript(source, { ecmaVersion: 'latest', sourceType: 'module' });
    const initializer = schemaInitializer(program);
    if (!initializer) return [];
    const entries = [];
    collectSchema(initializer, [], entries);
    return uniqueEntries(entries);
  } catch {
    return [];
  }
}

function schemaInitializer(program) {
  for (const statement of program.body || []) {
    const declaration = statement.type === 'ExportNamedDeclaration' ? statement.declaration : statement;
    if (declaration?.type !== 'VariableDeclaration') continue;
    for (const item of declaration.declarations || []) {
      if (item.id?.type === 'Identifier' && item.id.name === 'Schema') return item.init;
    }
  }
  return undefined;
}

function collectSchema(node, path, entries) {
  const base = baseZodCall(node);
  const allowsMissing = schemaAllowsMissing(node);
  const add = (kind, dynamic = false) => entries.push({ path, kind, dynamic, allowsMissing });
  if (!base) {
    if (path.length) add('unknown');
    return;
  }
  const name = base.name;
  if (name === 'object' || name === 'looseObject' || name === 'strictObject') {
    if (path.length) add('object');
    const shape = base.arguments[0];
    if (shape?.type !== 'ObjectExpression') return;
    for (const property of shape.properties || []) {
      if (property.type !== 'Property') continue;
      const key = propertyKey(property);
      if (key) collectSchema(property.value, [...path, key], entries);
    }
    return;
  }
  if (name === 'record' || name === 'partialRecord') {
    if (path.length) add('object', true);
    return;
  }
  if (name === 'intersection') {
    if (path.length) add('object');
    for (const argument of base.arguments.slice(0, 2)) collectSchema(argument, path, entries);
    return;
  }
  if (name === 'array' || name === 'tuple') {
    if (path.length) add('array');
    return;
  }
  if (name === 'number' || name === 'bigint' || name === 'nan') {
    if (path.length) add('number');
    return;
  }
  if (name === 'boolean') {
    if (path.length) add('boolean');
    return;
  }
  if (['string', 'enum', 'templateLiteral', 'date'].includes(name)) {
    if (path.length) add('string');
    return;
  }
  if (name === 'literal') {
    if (path.length) add(typeofKind(base.arguments[0]?.value));
    return;
  }
  if (path.length) add('unknown');
}

function schemaAllowsMissing(node) {
  let current = node;
  while (current?.type === 'CallExpression' && current.callee?.type === 'MemberExpression') {
    if (['prefault', 'default', 'optional', 'catch'].includes(memberName(current.callee.property))) return true;
    current = current.callee.object;
  }
  return false;
}

function baseZodCall(node) {
  let current = node;
  while (current?.type === 'CallExpression') {
    const callee = current.callee;
    if (callee?.type === 'MemberExpression') {
      const name = memberName(callee.property);
      if (callee.object?.type === 'Identifier' && callee.object.name === 'z') return { name, arguments: current.arguments || [] };
      if (callee.object?.type === 'MemberExpression'
        && callee.object.object?.type === 'Identifier' && callee.object.object.name === 'z'
        && memberName(callee.object.property) === 'coerce') return { name, arguments: current.arguments || [] };
      current = callee.object;
      continue;
    }
    break;
  }
  return undefined;
}

function propertyKey(property) {
  if (property.computed) return '';
  if (property.key?.type === 'Identifier') return property.key.name;
  if (property.key?.type === 'Literal') return String(property.key.value ?? '');
  return '';
}

function memberName(property) {
  if (property?.type === 'Identifier') return property.name;
  if (property?.type === 'Literal') return String(property.value ?? '');
  return '';
}

function schemaCovers(path, schema) {
  if (schema.some((entry) => samePath(entry.path, path))) return true;
  return schema.some((entry) => (entry.dynamic || entry.kind === 'array') && isPrefix(entry.path, path));
}

function rulePathMatches(pattern, actual) {
  if (pattern.length !== actual.length) return false;
  return pattern.every((segment, index) => /^\$\{[^}]+\}$/.test(segment) || segment === actual[index]);
}

function containsExecutableRule(check) {
  const source = Array.isArray(check) ? check.join('\n') : typeof check === 'string' ? check : '';
  return /(?:=>|\b(?:const|let|var|function|return)\b|\b(?:if|for|while)\s*\(|\b(?:JSON|Math|Object|Array|_)\s*\.|\bz\.[A-Za-z]+)/.test(source);
}

function splitRuleKey(key) {
  return key.split('.').map((part) => part.trim()).filter(Boolean);
}

function uniqueEntries(entries) {
  const result = new Map();
  for (const entry of entries) {
    const key = displayPath(entry.path);
    const previous = result.get(key);
    if (!previous || previous.kind === 'unknown' || entry.dynamic) result.set(key, entry);
  }
  return [...result.values()];
}

function topLevelKeys(entries) {
  return [...new Set(entries.map((entry) => entry.path[0]).filter(Boolean))];
}

function samePath(left, right) {
  return left.length === right.length && left.every((segment, index) => segment === right[index]);
}

function isPrefix(prefix, path) {
  return prefix.length < path.length && prefix.every((segment, index) => segment === path[index]);
}

function typeofKind(value) {
  if (typeof value === 'string') return 'string';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  return 'unknown';
}

function objectValue(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function displayPath(path) { return path.join('.'); }

function kindLabel(kind) {
  return ({ string: '文本', number: '数值', boolean: '真假', array: '列表', object: '对象', null: '空值', unknown: '未知类型' })[kind];
}

function summarizePaths(paths) {
  const unique = [...new Set(paths)];
  return unique.length <= 8 ? unique.join('、') : `${unique.slice(0, 8).join('、')}，另有 ${unique.length - 8} 处`;
}
