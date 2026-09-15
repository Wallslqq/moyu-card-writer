/**
 * 稳定 ID —— 逐字移植墨月 `character-card.ts` 的 stableId()。
 * 同一作品 + 同一命名空间永远得到同一个 UUID 形态 id：重复导出不会产生重复条目。
 */
export function stableId(seed, namespace) {
  const source = `${namespace}:${seed}`;
  let left = 0x811c9dc5;
  let right = 0x9e3779b9;
  for (let index = 0; index < source.length; index += 1) {
    left = Math.imul(left ^ source.charCodeAt(index), 0x01000193);
    right = Math.imul(right ^ source.charCodeAt(index), 0x85ebca6b);
  }
  const hex = (value) => (value >>> 0).toString(16).padStart(8, '0');
  const value = `${hex(left)}${hex(right)}${hex(left ^ right)}${hex(Math.imul(left, right))}`.slice(0, 32);
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-4${value.slice(13, 16)}-a${value.slice(17, 20)}-${value.slice(20, 32)}`;
}
