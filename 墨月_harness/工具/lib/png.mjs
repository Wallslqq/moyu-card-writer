/**
 * PNG 角色卡内嵌 —— 移植墨月 `character-card.ts` 的 PNG 部分。
 * 行为一致：移除已有的 chara/ccv3 tEXt 块，在 IEND 前插入新的 chara 与 ccv3。
 * 差异：浏览器 btoa/atob 换成 Node Buffer（同一二进制语义）。
 */
const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

export function embedCharacterCard(png, card) {
  if (png.length < 8 || !PNG_SIGNATURE.every((value, index) => png[index] === value)) throw new Error('封面必须是有效的 PNG 图片');
  const chunks = parseChunks(png).filter((chunk) => {
    if (chunk.type !== 'tEXt') return true;
    const zero = chunk.data.indexOf(0);
    const keyword = new TextDecoder('latin1').decode(chunk.data.slice(0, zero < 0 ? chunk.data.length : zero));
    return keyword !== 'chara' && keyword !== 'ccv3';
  });
  const iend = chunks.findIndex((chunk) => chunk.type === 'IEND');
  if (iend < 0) throw new Error('PNG 图片缺少结束标记');
  const encoded = bytesToBase64(new TextEncoder().encode(JSON.stringify(card)));
  chunks.splice(iend, 0, textChunk('chara', encoded), textChunk('ccv3', encoded));
  return concat([PNG_SIGNATURE, ...chunks.map(encodeChunk)]);
}

export function parseChunks(png) {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const chunks = [];
  let offset = 8;
  while (offset + 12 <= png.length) {
    const length = view.getUint32(offset);
    const end = offset + 12 + length;
    if (end > png.length) throw new Error('PNG 图片结构不完整');
    const type = new TextDecoder('ascii').decode(png.slice(offset + 4, offset + 8));
    chunks.push({ type, data: png.slice(offset + 8, offset + 8 + length) });
    offset = end;
    if (type === 'IEND') break;
  }
  return chunks;
}

function textChunk(keyword, value) {
  return { type: 'tEXt', data: concat([new TextEncoder().encode(keyword), new Uint8Array([0]), new TextEncoder().encode(value)]) };
}

function encodeChunk(chunk) {
  const type = new TextEncoder().encode(chunk.type);
  const output = new Uint8Array(12 + chunk.data.length);
  const view = new DataView(output.buffer);
  view.setUint32(0, chunk.data.length);
  output.set(type, 4);
  output.set(chunk.data, 8);
  view.setUint32(8 + chunk.data.length, crc32(concat([type, chunk.data])));
  return output;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function concat(parts) {
  const output = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) { output.set(part, offset); offset += part.length; }
  return output;
}

function bytesToBase64(bytes) {
  return Buffer.from(bytes).toString('base64');
}

export function dataUrlBytes(dataUrl) {
  const comma = dataUrl.indexOf(',');
  if (comma < 0 || !dataUrl.slice(0, comma).includes(';base64')) throw new Error('本地封面数据无效');
  return new Uint8Array(Buffer.from(dataUrl.slice(comma + 1), 'base64'));
}

/** 从 PNG 里读回角色卡（用于与导出结果逐字段比对）。 */
export function readCharacterCard(png) {
  for (const chunk of parseChunks(png)) {
    if (chunk.type !== 'tEXt') continue;
    const zero = chunk.data.indexOf(0);
    if (zero < 0) continue;
    const keyword = new TextDecoder('latin1').decode(chunk.data.slice(0, zero));
    if (keyword !== 'chara' && keyword !== 'ccv3') continue;
    const value = new TextDecoder('utf-8').decode(chunk.data.slice(zero + 1));
    return JSON.parse(Buffer.from(value, 'base64').toString('utf8'));
  }
  return undefined;
}
