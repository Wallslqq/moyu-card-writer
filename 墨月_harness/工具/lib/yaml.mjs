/**
 * YAML 映射检查 —— 逐字移植墨月 `yaml-document.ts`。
 * 使用与墨月相同的 `yaml` 库（vendored），保证行为一致。
 */
import { isMap, parseDocument } from 'yaml';

export function inspectYamlMapping(source) {
  const value = stripYamlFence(source).trim();
  if (!value) return emptyMapping();

  const document = parseDocument(value, { schema: 'core', uniqueKeys: true });
  if (document.errors.length) {
    return {
      ...emptyMapping(),
      issue: `YAML 语法错误：${document.errors[0].message.split('\n')[0]}`,
    };
  }
  if (!isMap(document.contents)) return { ...emptyMapping(), issue: 'YAML 顶层必须是键值对象' };

  const root = document.contents;
  return {
    issue: '',
    keys: mapKeys(root.items),
    nestedKeys(rootKey) {
      const nested = root.get(rootKey, true);
      return isMap(nested)
        ? { rootFound: true, keys: mapKeys(nested.items) }
        : { rootFound: nested !== undefined, keys: [] };
    },
  };
}

export function stripYamlFence(source) {
  return source.trim().match(/^```(?:ya?ml)?\s*\r?\n([\s\S]*?)\r?\n?```$/i)?.[1] ?? source;
}

function emptyMapping() {
  return { issue: '', keys: [], nestedKeys: () => ({ rootFound: false, keys: [] }) };
}

function mapKeys(items) {
  return [...new Set(items.map((item) => scalarKey(item.key)).filter(Boolean))];
}

function scalarKey(value) {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value && typeof value === 'object' && 'value' in value) {
    const scalar = value.value;
    if (typeof scalar === 'string' || typeof scalar === 'number' || typeof scalar === 'boolean') return String(scalar);
  }
  return '';
}
