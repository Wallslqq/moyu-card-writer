export interface PhoneSource { id: number; role: string; content: string; swipeId?: number }
export interface PhoneData {
  messages: { id: string; contactId: string; content: string; incoming: boolean; sourceMessageId: number; channel?: string; senderId?: string }[];
  posts: { id: string; entryId?: string; authorId: string; title: string; content: string; sourceMessageId: number; replies?: { id: string; authorId: string; content: string }[] }[];
  apps: Record<string, { id: string; sourceMessageId: number; data: Record<string, unknown> }[]>;
  issues: { messageId: number; reason: string }[];
}

// 统一解码当前分支，而不是让每个应用各写一份标签捕获与去重逻辑。
export function parsePhoneMessages(sources: PhoneSource[]): PhoneData {
  const output: PhoneData = { messages: [], posts: [], apps: Object.create(null), issues: [] };
  for (const source of sources) {
    if (source.role !== 'assistant') continue;
    let blockIndex = 0;
    for (const match of source.content.matchAll(/<moyu_phone>\s*([\s\S]*?)\s*<\/moyu_phone>/g)) {
      const block = blockIndex++;
      try {
        const data = JSON.parse(match[1]);
        if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('手机内容不是 JSON 对象');
        const batch: Pick<PhoneData, 'messages' | 'posts'> = { messages: [], posts: [] };
        const apps: PhoneData['apps'] = Object.create(null);
        const ids = new Set<string>();
        for (const kind of ['messages', 'posts'] as const) {
          if (data[kind] !== undefined && !Array.isArray(data[kind])) throw new Error(`${kind} 不是列表`);
          for (const item of data[kind] ?? []) {
            if (!item || typeof item !== 'object' || typeof item.id !== 'string' || !item.id.trim() || typeof item.content !== 'string') throw new Error(`${kind} 缺少 ID 或正文`);
            const localId = `${kind}:${item.id}`;
            if (ids.has(localId)) throw new Error(`${kind} 的 ID 重复`);
            ids.add(localId);
            const id = `${source.id}:${source.swipeId ?? 0}:${block}:${localId}`;
            if (kind === 'messages') {
              if (typeof item.contactId !== 'string' || !item.contactId.trim()) throw new Error('私信缺少联系人 ID');
              if (item.channel !== undefined && typeof item.channel !== 'string') throw new Error('消息渠道需要是文字');
              if (item.incoming !== undefined && typeof item.incoming !== 'boolean') throw new Error('消息方向需要是布尔值');
              if (item.senderId !== undefined && typeof item.senderId !== 'string') throw new Error('发言人需要是联系人 ID');
              batch.messages.push({ id, contactId: item.contactId, content: item.content, incoming: item.incoming ?? true, sourceMessageId: source.id,
                ...(item.channel ? { channel: item.channel } : {}), ...(item.senderId ? { senderId: item.senderId } : {}) });
            } else {
              if (typeof item.authorId !== 'string' || !item.authorId.trim() || typeof item.title !== 'string') throw new Error('帖子缺少作者 ID 或标题');
              if (item.replies !== undefined && (!Array.isArray(item.replies) || item.replies.some((reply: any) => !reply || typeof reply.id !== 'string' || !reply.id || typeof reply.authorId !== 'string' || typeof reply.content !== 'string')
                || new Set(item.replies.map((reply: any) => reply.id)).size !== item.replies.length)) throw new Error('帖子回复需要唯一 ID、作者 ID 和正文');
              batch.posts.push({ id, entryId: item.id, authorId: item.authorId, title: item.title, content: item.content, sourceMessageId: source.id,
                ...(item.replies ? { replies: item.replies.map((reply: any) => ({ id: reply.id, authorId: reply.authorId, content: reply.content })) } : {}) });
            }
          }
        }
        if (data.apps !== undefined) {
          if (!data.apps || typeof data.apps !== 'object' || Array.isArray(data.apps)) throw new Error('apps 需要按 APP ID 组织');
          for (const [appId, content] of Object.entries(data.apps)) {
            if (!appId.trim() || ['__proto__', 'constructor', 'prototype'].includes(appId) || !content || typeof content !== 'object' || Array.isArray(content)) throw new Error('APP 内容需要是对象，且有正确的 APP ID');
            apps[appId] = [{ id: source.id + ':' + (source.swipeId ?? 0) + ':' + block + ':app:' + appId, sourceMessageId: source.id, data: content as Record<string, unknown> }];
          }
        }
        output.messages.push(...batch.messages); output.posts.push(...batch.posts);
        for (const [id, events] of Object.entries(apps)) (output.apps[id] ??= []).push(...events);
      } catch (error) { output.issues.push({ messageId: source.id, reason: error instanceof Error ? error.message : String(error) }); }
    }
  }
  return output;
}

export const phoneOutputRule = `这是角色卡内的虚构手机。玩家在输入中要求手机私信或论坛互动时，正常推进剧情，并在正文后输出一个 <moyu_phone> 标签，标签内放合法 JSON，结尾使用 </moyu_phone>。
私信格式：{"messages":[{"id":"本回复内唯一ID","contactId":"玩家指定的联系人ID","content":"私信正文"}]}。
论坛格式：{"posts":[{"id":"帖子的稳定ID","authorId":"玩家指定的作者ID","title":"帖子标题","content":"帖子正文","replies":[{"id":"回复的唯一ID","authorId":"回复者的联系人ID","content":"回复正文"}]}]}。没有回复时可省略 replies；后续更新同一帖子沿用帖子 ID，并给出该帖当前完整内容与回复列表。
可以在同一对象中同时包含 messages 和 posts。字符串中的换行写为 \\n，双引号按 JSON 转义；不加代码围栏，不用 JavaScript 表达式。联系人或作者 ID 使用玩家本次请求提供的原值，不用显示名代替；未提供明确对象时先在剧情中确认。没有手机互动时不输出空标签。不要重复历史消息，不代表真实短信、支付或外部网站操作。`;

export function phoneDisplayRegex(title: string): Record<string, unknown> {
  return { id: crypto.randomUUID(), scriptName: `${title}·隐藏手机数据`, findRegex: '/<moyu_phone>[\\s\\S]*?<\\/moyu_phone>/g', replaceString: '', trimStrings: [], placement: [2], disabled: false, markdownOnly: true, promptOnly: false, runOnEdit: true, substituteRegex: 0, minDepth: null, maxDepth: null };
}
