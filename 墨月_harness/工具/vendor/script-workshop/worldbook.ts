import { z } from 'zod';
import { phoneOutputRule } from './phone.ts';

export const companionEntrySchema = z.object({
  id: z.string().min(1), title: z.string(), content: z.string(), moduleIds: z.array(z.string()),
  enabled: z.boolean(), constant: z.boolean(), keys: z.array(z.string()),
  position: z.union([z.literal(0), z.literal(1), z.literal(4)]),
  role: z.enum(['system', 'user', 'assistant']), depth: z.number().int().nonnegative(), order: z.number().int(),
});
export type CompanionEntry = z.infer<typeof companionEntrySchema>;
export const companionEntriesSchema = z.array(companionEntrySchema).refine(entries => new Set(entries.map(item => item.id)).size === entries.length, '世界书条目 ID 重复。');
export const companionDraftSchema = z.object({
  entries: companionEntriesSchema, reason: z.string(), baseRevision: z.number().int().nonnegative(), moduleId: z.string(),
  sourceRevisions: z.record(z.string(), z.number().int().nonnegative()).optional(),
});
export const companionBookSchema = z.object({
  entries: companionEntriesSchema, revision: z.number().int().nonnegative(),
  pending: companionDraftSchema.optional(),
});
export type CompanionBook = z.infer<typeof companionBookSchema>;
export function newCompanionEntry(moduleIds: string[] = []): CompanionEntry {
  return { id: crypto.randomUUID(), title: '未命名条目', content: '', moduleIds, enabled: true, constant: true, keys: [], position: 4, role: 'system', depth: 0, order: 0 };
}
export function newCompanionBook(moduleIds: string[] = []): CompanionBook {
  const book: CompanionBook = { entries: [], revision: 0 };
  addPhoneCompanion(book, moduleIds);
  return book;
}
export function addPhoneCompanion(book: CompanionBook, moduleIds: string[]): void {
  if (!moduleIds.some(id => id === 'messages' || id === 'forum') || book.entries.some(item => item.id === 'phone-output')) return;
  book.entries.push({ ...newCompanionEntry(['messages', 'forum', 'notifications']), id: 'phone-output', title: '墨月小手机·消息格式', content: phoneOutputRule });
  book.revision++;
}
export function addAppCompanion(book: CompanionBook, id: string, title: string): void {
  const conversations = ['sms', 'groups', 'calls'];
  const apps = ['feed', 'weather', 'map', 'browser', 'wallet', 'orders', 'delivery', 'secondhand', 'taxi', 'live', 'movie'];
  if (![...conversations, ...apps].includes(id) || book.entries.some(item => item.id === 'phone-app-' + id)) return;
  const channel = ({ sms: 'sms', groups: 'group', calls: 'call' } as Record<string, string>)[id];
  const example = channel
    ? { messages: [{ id: '当前回复内唯一ID', contactId: '本次对象或群ID', senderId: '实际说话人的联系人ID', channel, content: '消息正文' }] }
    : { apps: { [id]: { items: [{ id: '稳定条目ID', title: '名称', content: '正文' }] } } };
  book.entries.push({ ...newCompanionEntry([id]), id: 'phone-app-' + id, title: title + '·内容格式',
    content: '这是角色卡内的' + title + '。只有剧情涉及该应用或玩家明确操作时，在正常正文后提供对应内容。\n使用 <moyu_phone> 包住一个合法 JSON 对象，最后以 </moyu_phone> 结束。结构示例：\n' + JSON.stringify(example) +
      '\nID 使用已确认对象；新增条目使用稳定 ID，更新同一条目沿用原 ID。正文是故事中的实际信息，不声称连接真实服务。字符串按 JSON 转义，素材链接仅使用作者已有的真实素材。' });
  book.revision++;
}
export function writeCompanionEntries(book: CompanionBook, entries: CompanionEntry[], revision: number): void {
  if (book.revision !== revision) throw new Error('配套世界书已经修改过，旧稿没有覆盖它，请基于当前内容重新检查。');
  const next = companionEntriesSchema.parse(entries);
  if (JSON.stringify(next) === JSON.stringify(book.entries)) return;
  book.entries = next; book.revision++;
}
export function relatedCompanions(book: CompanionBook, moduleIds: string[], selectedId?: string): CompanionEntry[] {
  return book.entries.filter(item => item.id === selectedId || !item.moduleIds.length || item.moduleIds.some(id => moduleIds.includes(id)));
}
// 使用酒馆独立世界书的字段；D0 系统消息是 position=4、role=0、depth=0，顺序独立保存。
export function exportCompanionBook(title: string, book: CompanionBook) {
  const entries = companionEntriesSchema.parse(book.entries);
  if (!entries.some(item => item.content.trim())) throw new Error('配套世界书还没有正文。');
  return { name: `${title}·配套世界书`, entries: Object.fromEntries(entries.map((item, index) => [String(index), {
    uid: index, comment: item.title, content: item.content, key: item.keys, keysecondary: [],
    constant: item.constant, selective: false, disable: !item.enabled,
    position: item.position, role: { system: 0, user: 1, assistant: 2 }[item.role], depth: item.depth, order: item.order,
    addMemo: true, displayIndex: index, probability: 100, useProbability: true,
    excludeRecursion: false, preventRecursion: false, delayUntilRecursion: false,
  }])) };
}
