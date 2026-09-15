export interface PhoneAppConfig {
  title?: string;
  items?: Record<string, unknown>[];
  balancePath?: string[];
  storyTimePath?: string[];
  prompt?: string;
}

export function calculatePhone(left: number, operator: string, right: number): number {
  if (![left, right].every(Number.isFinite)) throw new Error('请输入有效数字。');
  let result: number;
  if (operator === '+') result = left + right;
  else if (operator === '-') result = left - right;
  else if (operator === '×') result = left * right;
  else if (operator === '÷') { if (right === 0) throw new Error('不能除以零。'); result = left / right; }
  else throw new Error('请选择运算符。');
  if (!Number.isFinite(result)) throw new Error('计算结果超出范围。');
  return Number(result.toPrecision(14));
}

// 固定的 APP 基础行为。题材、资料和布局仍可由作者通过模块代码定制。
// 不引用外部闭包，预览与打包传入同一份实现。
export function createPhoneApp(ctx: any, kind: string, config: PhoneAppConfig, calculate: typeof calculatePhone) {
  type Item = Record<string, any> & { id: string; title: string; content: string };
  let search = '', page = 0, selection = '', editing: Item | undefined, confirming = '', busy = false, error = '';
  let root: HTMLElement, interval: number | undefined;
  const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));
  const state = () => ctx.state();
  const make = (tag: string, text = '') => { const node = document.createElement(tag); node.textContent = text; return node; };
  const labelInput = (label: string, value = '', multi = false) => {
    const holder = make('label', label); holder.style.display = 'grid'; holder.style.gap = '6px';
    const input = document.createElement(multi ? 'textarea' : 'input') as HTMLInputElement;
    input.value = value; input.setAttribute('aria-label', label); holder.append(input);
    return { holder, input };
  };
  const button = (label: string, action: () => unknown) => {
    const node = make('button', label) as HTMLButtonElement; node.type = 'button'; node.disabled = busy; node.dataset.action = label;
    node.onclick = async () => {
      if (busy) return; busy = true; node.disabled = true; error = '';
      try { await action(); } catch (reason) { error = reason instanceof Error ? reason.message : String(reason); }
      finally { busy = false; node.disabled = false; await ctx.refresh(); }
    };
    return node;
  };
  const save = async (changes: Record<string, unknown>) => { await ctx.setState({ ...state(), ...changes }); };
  const normalize = (value: any, fallback: string): Item => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('条目应包含名称和正文。');
    if (value.replies !== undefined && (!Array.isArray(value.replies) || value.replies.some((reply: any) => !reply || typeof reply.content !== 'string' || typeof reply.authorId !== 'string'))) throw new Error('回复需要作者和正文。');
    return { ...value, id: String(value.id ?? fallback), title: String(value.title ?? value.name ?? '未命名'), content: String(value.content ?? value.note ?? '') };
  };
  function records(): Item[] {
    const merged = new Map<string, Item>();
    for (const [index, value] of (config.items ?? []).entries()) { const item = normalize(value, 'initial-' + index); merged.set(item.id, item); }
    for (const event of ctx.phone().apps[ctx.id] ?? []) {
      if (!Array.isArray(event.data.items)) throw new Error('这份 APP 回复缺少 items 列表，请检查配套世界书。');
      for (const [index, value] of event.data.items.entries()) { const item = normalize(value, event.id + ':' + index); merged.set(item.id, item); }
    }
    for (const value of state().generated ?? []) { const item = normalize(value, ''); if (!item.id) throw new Error('生成内容缺少 ID。'); merged.set(item.id, item); }
    for (const value of state().items ?? []) { const item = normalize(value, ''); merged.set(item.id, item); }
    const deleted = new Set(state().deleted ?? []);
    return [...merged.values()].filter(item => !deleted.has(item.id));
  }
  const contacts = () => {
    if (kind === 'contacts') return records();
    if (!ctx.dependencies.includes('contacts')) return [];
    return (ctx.read('contacts').contacts ?? []).map((item: any) => normalize(item, item.id));
  };
  const name = (id: string) => contacts().find((item: Item) => item.id === id)?.title ?? id;
  const numberAt = (path?: string[]) => path?.reduce<any>((value, part) => value?.[part], ctx.variables());
  function visibleItems(): Item[] {
    let items = records();
    if (kind === 'forum') {
      const posts = new Map<string, Item>();
      for (const item of ctx.phone().posts) posts.set(item.entryId ?? item.id, item);
      const combined = new Map([...posts.values()].map(item => [item.id, item]));
      for (const item of items) if (item.sourceMessageId === undefined || combined.has(item.id)) combined.set(item.id, item);
      items = [...combined.values()].filter(item => !(state().deleted ?? []).includes(item.id));
    }
    if (kind === 'notifications') {
      items = ctx.phone().messages.map((item: any) => ({ id: item.id, title: name(item.senderId ?? item.contactId), content: item.content }));
      if (ctx.dependencies.includes('tasks')) for (const task of ctx.read('tasks').tasks ?? []) {
        if (task.completed && !task.claimed) items.push({ id: 'task:' + task.id, title: task.title, content: '任务已完成，奖励待领取。' });
      }
    }
    return items;
  }
  async function storeItem(item: Item) {
    const items: Item[] = state().items ?? [];
    const next = items.filter(value => value.id !== item.id); next.push(copy({ ...item, updatedAt: new Date().toISOString() }));
    await save({ items: next }); editing = undefined; selection = '';
  }
  async function generate(request: string, conversation?: { contactId: string; channel: string }) {
    const instruction = (config.prompt ?? '') + '\n本次操作：\n' + request + '\n本次返回格式：只输出 JSON 对象 {"items":[{"id":"稳定ID","title":"名称或说话人","content":"正文或回复台词"}]}。把本次生成内容写入 items，不附加剧情正文或手机标签。有作者已提供的图片、音频或视频地址才填写 url，不虚构地址。';
    const text = await ctx.generate(instruction, { contacts: contacts().map((item: Item) => ({ id: item.id, name: item.title, note: item.content })), currentItems: records() });
    let value: any;
    try { value = JSON.parse(text.trim().replace(/^\x60{3}(?:json)?\s*/i, '').replace(/\s*\x60{3}$/, '')); }
    catch { throw new Error('AI 返回的内容格式不正确，原内容与草稿已保留，可以重新生成。'); }
    if (!value || !Array.isArray(value.items)) throw new Error('AI 返回内容不是所需的条目列表，原内容未替换。');
    const ids = new Set<string>();
    const items = value.items.map((item: any) => {
      if (!item || typeof item.id !== 'string' || !item.id || typeof item.title !== 'string' || typeof item.content !== 'string' || ids.has(item.id)) throw new Error('AI 返回的条目缺少正确的 ID、名称或正文，原内容未替换。');
      ids.add(item.id); return normalize({ ...item, ...conversation }, '');
    });
    const previous = state().generated ?? [];
    const next = new Map(previous.map((item: Item) => [item.id, item]));
    for (const item of items) next.set(item.id, item);
    await save({ generated: [...next.values()] });
  }
  function showEditor(item?: Item) {
    editing = copy(item ?? { id: crypto.randomUUID(), title: '', content: '' }); selection = ''; void ctx.refresh();
  }
  function editor() {
    const item = editing!;
    const title = labelInput(kind === 'contacts' ? '名字' : '名称', item.title);
    const content = labelInput(kind === 'contacts' ? '备注' : '正文', item.content, true);
    title.input.oninput = () => { item.title = title.input.value; }; content.input.oninput = () => { item.content = content.input.value; };
    root.append(title.holder, content.holder);
    if (['calendar', 'gallery', 'camera', 'music', 'video', 'map'].includes(kind)) {
      const field = kind === 'calendar' ? 'date' : ['gallery', 'camera', 'music', 'video'].includes(kind) ? 'url' : 'location';
      const text = labelInput(({ date: '日期', url: '素材地址', location: '地点' } as Record<string, string>)[field]!, item[field] ?? '');
      text.input.oninput = () => { item[field] = text.input.value; }; root.append(text.holder);
    }
    root.append(button('保存', async () => { if (!item.title.trim()) throw new Error('请填写名称。'); await storeItem({ ...item, title: item.title.trim() }); }),
      button('取消', () => { editing = undefined; }));
  }
  function media(item: Item) {
    if (!item.url) return;
    const url = String(item.url);
    if (!/^(https:|data:image\/|data:audio\/|data:video\/)/i.test(url)) throw new Error('素材请使用 HTTPS 地址或已收录的媒体。');
    if (kind === 'music' || kind === 'video') {
      const element = document.createElement(kind === 'music' ? 'audio' : 'video');
      element.controls = true; element.preload = 'none'; element.src = url; element.style.maxWidth = '100%'; root.append(element);
    } else if (['gallery', 'camera'].includes(kind)) {
      const image = document.createElement('img'); image.src = url; image.alt = item.title; root.append(image);
    }
  }
  const replyDrafts = new Map<string, string>();
  function detail(item: Item) {
    root.append(button('返回列表', () => { selection = ''; }), make('h3', item.title));
    const body = make('p', item.content); body.style.whiteSpace = 'pre-wrap'; root.append(body);
    if (item.date) root.append(make('p', item.date));
    media(item);
    if (item.replies) for (const reply of item.replies) root.append(make('p', name(reply.authorId) + '：' + reply.content));
    if (item.price !== undefined) root.append(make('p', '价格：' + item.price));
    if (kind === 'notifications') {
      root.append(button((state().read ?? []).includes(item.id) ? '已读' : '标记已读', () => save({ read: [...new Set([...(state().read ?? []), item.id])] })));
      return;
    }
    root.append(button('编辑', () => showEditor(item)), button((state().favorites ?? []).includes(item.id) ? '取消收藏' : '收藏', async () => {
      const favorites = new Set<string>(state().favorites ?? []); if (favorites.has(item.id)) favorites.delete(item.id); else favorites.add(item.id);
      await save({ favorites: [...favorites] });
    }));
    if (kind === 'contacts') root.append(button(item.blocked ? '解除拉黑' : '拉黑', () => storeItem({ ...item, blocked: !item.blocked })));
    root.append(button('删除', () => { confirming = item.id; }));
    if (confirming === item.id) root.append(make('p', '删除这条记录？'), button('确认删除', async () => {
      await save({ items: (state().items ?? []).filter((value: Item) => value.id !== item.id), deleted: [...new Set([...(state().deleted ?? []), item.id])] });
      selection = ''; confirming = '';
    }), button('保留', () => { confirming = ''; }));
    if (['forum', 'feed', 'live'].includes(kind)) {
      const reply = labelInput('回复内容', replyDrafts.get(item.id) ?? '', true);
      reply.input.oninput = () => { replyDrafts.set(item.id, reply.input.value); };
      root.append(reply.holder, button('发送回复到酒馆', async () => {
        if (!reply.input.value.trim()) throw new Error('请填写回复内容。');
        await ctx.compose('在' + (config.title ?? kind) + '回复条目 ' + (item.entryId ?? item.id) + '（' + item.title + '），内容：' + reply.input.value);
        replyDrafts.delete(item.id);
      }));
      if (item.authorId) root.append(button((state().following ?? []).includes(item.authorId) ? '取消关注' : '关注作者', async () => {
        const following = new Set<string>(state().following ?? []);
        if (following.has(item.authorId)) following.delete(item.authorId); else following.add(item.authorId);
        await save({ following: [...following] });
      }));
    }
    if (['delivery', 'secondhand', 'movie'].includes(kind)) root.append(button('加入购物车', async () => {
      const cart = { ...(state().cart ?? {}) }; cart[item.id] = (cart[item.id] ?? 0) + 1; await save({ cart });
    }));
    if (['shop', 'orders', 'delivery', 'secondhand', 'taxi', 'movie'].includes(kind)) root.append(button('交给剧情处理', () => ctx.compose('手机操作：' + (config.title ?? kind) + '，选择 ' + item.title + '，ID=' + item.id + '。这是待确认意向，请按剧情和实际余额处理。')));
  }
  function shoppingCart(items: Item[]) {
    const cart: Record<string, number> = state().cart ?? {};
    const rows = Object.entries(cart).filter(([, count]) => count > 0);
    if (!rows.length) return;
    root.append(make('h3', '购物车'));
    for (const [id, count] of rows) {
      const item = items.find(value => value.id === id);
      root.append(make('p', (item?.title ?? '已不可用的条目') + ' × ' + count), button('移除 ' + (item?.title ?? id), async () => {
        const next = { ...(state().cart ?? {}) }; delete next[id]; await save({ cart: next });
      }));
    }
    root.append(button('将订单交给酒馆', async () => {
      const order = rows.map(([id, quantity]) => {
        const item = items.find(value => value.id === id); if (!item) throw new Error('购物车有已不可用的条目，请先移除。');
        return { id, title: item.title, quantity, price: item.price ?? '按剧情确认' };
      });
      await ctx.compose('手机下单意向：' + JSON.stringify(order) + '。尚未付款，请按剧情中的库存与余额确认，不重复扣款。');
      await save({ cart: {} });
    }));
  }
  function list(items: Item[]) {
    const filter = labelInput('搜索', search); filter.input.oninput = () => { search = filter.input.value; page = 0; paintList(); };
    const listRoot = make('section');
    function paintList() {
      listRoot.replaceChildren();
      const filtered = items.filter(item => (item.title + '\n' + item.content).toLocaleLowerCase().includes(search.toLocaleLowerCase()));
      const total = Math.max(1, Math.ceil(filtered.length / 24)); page = Math.min(page, total - 1);
      if (!filtered.length) listRoot.append(make('p', '暂无内容'));
      for (const item of filtered.slice(page * 24, (page + 1) * 24)) {
        const row = button(item.title, () => { selection = item.id; }); row.style.display = 'block'; row.style.width = '100%'; row.style.marginBottom = '8px'; listRoot.append(row);
      }
      if (total > 1) {
        const previous = button('上一页', () => { page = Math.max(0, page - 1); }); previous.disabled = page === 0;
        const next = button('下一页', () => { page = Math.min(total - 1, page + 1); }); next.disabled = page + 1 === total;
        listRoot.append(previous, make('span', ' ' + (page + 1) + ' / ' + total + ' '), next);
      }
    }
    root.append(filter.holder, listRoot); paintList();
  }
  let recipientText = state().recipient ?? '', messageDraft = state().draft ?? '';
  let recipientSearch = '', recipientPage = 0;
  let groupEditing: { id: string; title: string; memberIds: string[] } | undefined;
  function groupEditor() {
    const group = groupEditing!;
    const title = labelInput('群名称', group.title); title.input.oninput = () => { group.title = title.input.value; }; root.append(title.holder);
    for (const contact of contacts()) {
      const label = make('label', contact.title), checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = group.memberIds.includes(contact.id);
      checkbox.setAttribute('aria-label', '群成员 ' + contact.title);
      checkbox.onchange = () => { group.memberIds = checkbox.checked ? [...new Set([...group.memberIds, contact.id])] : group.memberIds.filter(id => id !== contact.id); };
      label.prepend(checkbox); root.append(label);
    }
    root.append(button('保存群聊', async () => {
      if (!group.title.trim()) throw new Error('请填写群名称。');
      await save({ groups: [...(state().groups ?? []).filter((item: any) => item.id !== group.id), copy(group)], recipient: group.id });
      recipientText = group.id; groupEditing = undefined;
    }), button('取消', () => { groupEditing = undefined; }));
  }
  function conversation() {
    if (groupEditing) { groupEditor(); return; }
    const channel = kind === 'sms' ? 'sms' : kind === 'groups' ? 'group' : kind === 'calls' ? 'call' : 'private';
    const available = contacts().filter((item: Item) => !item.blocked);
    const recipients: Item[] = kind === 'groups' ? state().groups ?? [] : available;
    const recipient = labelInput(kind === 'groups' ? '群名称或编号' : '联系人或号码', recipients.find(item => item.id === recipientText)?.title ?? recipientText);
    const draft = labelInput('消息内容', messageDraft, true);
    recipient.input.oninput = () => {
      const matches = recipients.filter(item => item.title === recipient.input.value);
      recipientText = matches.length === 1 ? matches[0]!.id : recipient.input.value;
    };
    const selectedRecipient = () => {
      if (!recipients.some(item => item.id === recipientText) && recipients.filter(item => item.title === recipientText).length > 1) throw new Error('有同名对象，请点选下面的联系人或群聊。');
      return recipientText.trim();
    };
    draft.input.oninput = () => { messageDraft = draft.input.value; };
    const availableList = make('div');
    const recipientFilter = labelInput('查找联系人或群聊', recipientSearch), recipientRows = make('div');
    recipientFilter.input.oninput = () => { recipientSearch = recipientFilter.input.value; recipientPage = 0; paintRecipients(); };
    function paintRecipients() {
      recipientRows.replaceChildren();
      const matches = recipients.filter(item => (item.title + '\n' + item.id).toLocaleLowerCase().includes(recipientSearch.toLocaleLowerCase()));
      const total = Math.max(1, Math.ceil(matches.length / 24)); recipientPage = Math.min(recipientPage, total - 1);
      for (const item of matches.slice(recipientPage * 24, (recipientPage + 1) * 24)) recipientRows.append(button(item.title, async () => { await save({ recipient: item.id, draft: messageDraft }); recipientText = item.id; page = 0; }));
      if (!matches.length) recipientRows.append(make('p', '没有找到匹配的对象'));
      if (total > 1) {
        const previous = button('上一页对象', () => { recipientPage = Math.max(0, recipientPage - 1); }); previous.disabled = recipientPage === 0;
        const next = button('下一页对象', () => { recipientPage = Math.min(total - 1, recipientPage + 1); }); next.disabled = recipientPage + 1 === total;
        recipientRows.append(previous, make('span', ' ' + (recipientPage + 1) + ' / ' + total + ' '), next);
      }
    }
    availableList.append(recipientFilter.holder, recipientRows); paintRecipients();
    if (kind === 'groups') {
      availableList.append(button('新建群聊', () => { groupEditing = { id: crypto.randomUUID(), title: '', memberIds: [] }; }));
      const group = (state().groups ?? []).find((item: any) => item.id === recipientText);
      if (group) {
        availableList.append(make('p', '成员：' + group.memberIds.map(name).join('、')), button('编辑群聊', () => { groupEditing = copy(group); }));
      }
    }
    const rows = ctx.phone().messages.filter((item: any) => (item.channel ?? 'private') === channel && (!recipientText || item.contactId === recipientText));
    const localRows = records().filter(item => (item.channel ?? channel) === channel && (!recipientText || !item.contactId || item.contactId === recipientText));
    root.append(recipient.holder, availableList);
    if (kind === 'calls') {
      const call = state().call;
      root.append(make('p', call?.active ? '模拟通话中：' + name(call.contactId) : '暂无进行中的通话'), button(call?.active ? '结束模拟通话' : '开始模拟通话', async () => {
        if (call?.active) {
          const finished = { ...call, active: false, endedAt: new Date().toISOString() };
          await save({ call: finished, calls: [...(state().calls ?? []), finished] });
        }
        else {
          const contactId = selectedRecipient(); if (!contactId) throw new Error('请选择通话对象。');
          await save({ call: { contactId, active: true, startedAt: new Date().toISOString() } });
        }
      }));
      for (const record of [...(state().calls ?? [])].reverse()) root.append(make('p', name(record.contactId) + ' · ' + new Date(record.startedAt).toLocaleString() + ' · 已结束'));
    }
    const messagePages = Math.max(1, Math.ceil(rows.length / 50)); page = Math.min(page, messagePages - 1);
    for (const item of rows.slice(page * 50, (page + 1) * 50)) root.append(make('p', (item.incoming ? name(item.senderId ?? item.contactId) : '我') + '：' + item.content));
    if (messagePages > 1) root.append(button('上一页消息', () => { page = Math.max(0, page - 1); }), make('span', (page + 1) + ' / ' + messagePages), button('下一页消息', () => { page = Math.min(messagePages - 1, page + 1); }));
    for (const item of localRows) root.append(make('p', item.title + '：' + item.content));
    if (rows.length) root.append(button('标记对话已读', () => save({ readMessages: [...new Set([...(state().readMessages ?? []), ...rows.map((item: any) => item.id)])] })));
    root.append(draft.holder, button('保存草稿', () => save({ recipient: selectedRecipient(), draft: draft.input.value })),
      button('交给酒馆发送', async () => {
        const contactId = selectedRecipient();
        if (!contactId || !draft.input.value.trim()) throw new Error('请填写对象和消息内容。');
        const group = kind === 'groups' ? (state().groups ?? []).find((item: any) => item.id === contactId) : undefined;
        await ctx.compose('手机' + channel + '操作：对象 ID=' + contactId + '，称呼=' + (group?.title ?? name(contactId)) + (group ? '，成员 ID=' + group.memberIds.join('、') : '') + '，内容=' + draft.input.value + '。请按手机配套世界书回复。');
        await save({ recipient: contactId, draft: '' });
        messageDraft = '';
      }), button('在 APP 内回复', async () => {
        const contactId = selectedRecipient();
        if (!contactId || !draft.input.value.trim()) throw new Error('请填写对象和消息内容。');
        const group = kind === 'groups' ? (state().groups ?? []).find((item: any) => item.id === contactId) : undefined;
        await generate('在' + kind + '中对 ' + (group ? group.title + '，成员：' + group.memberIds.map(name).join('、') : name(contactId)) + '说：' + draft.input.value + '。按人物身份给出回复。', { contactId, channel });
        await save({ recipient: contactId, draft: '' });
        messageDraft = '';
      }), stopButton());
    recipient.input.onchange = () => { page = 0; void save({ recipient: recipientText, draft: draft.input.value }).then(() => ctx.refresh()).catch((reason: Error) => { error = reason.message; void ctx.refresh(); }); };
  }
  let left = '', right = '', operator = '+', answer = '';
  function calculator() {
    const first = labelInput('第一个数', left), second = labelInput('第二个数', right);
    const operations = make('div');
    for (const value of ['+', '-', '×', '÷']) {
      const operation = button(value, () => { operator = value; }); operation.setAttribute('aria-pressed', String(operator === value)); operations.append(operation);
    }
    first.input.oninput = () => { left = first.input.value; }; second.input.oninput = () => { right = second.input.value; };
    root.append(first.holder, operations, second.holder, button('计算', () => {
      if (!left.trim() || !right.trim()) throw new Error('请填写两个数。');
      answer = String(calculate(Number(left), operator, Number(right)));
    }), button('清空', () => { left = ''; right = ''; answer = ''; }), make('output', answer));
  }
  let minutes = '1';
  let clockLabel: HTMLElement | undefined, timerLabel: HTMLElement | undefined;
  function updateClock() {
    if (!clockLabel?.isConnected) return;
    clockLabel.textContent = new Date().toLocaleTimeString();
    const end = state().timerEnd;
    if (timerLabel) timerLabel.textContent = end ? Date.now() >= end ? '计时结束' : '剩余 ' + Math.ceil((end - Date.now()) / 1000) + ' 秒' : '';
  }
  function clock() {
    clockLabel = make('p'); timerLabel = make('p'); root.append(clockLabel, timerLabel);
    const input = labelInput('计时分钟', minutes); input.input.type = 'number'; input.input.oninput = () => { minutes = input.input.value; };
    updateClock();
    root.append(input.holder, button('开始计时', async () => {
      const value = Number(minutes); if (!Number.isFinite(value) || value <= 0) throw new Error('请输入大于零的分钟数。');
      await save({ timerEnd: Date.now() + value * 60000 });
    }), button('取消计时', () => save({ timerEnd: null })));
  }
  const contentKinds = ['weather', 'map', 'browser', 'shop', 'orders', 'delivery', 'secondhand', 'taxi', 'live', 'movie'];
  let query = '';
  function stopButton() {
    const stop = make('button', '停止生成') as HTMLButtonElement; stop.type = 'button'; stop.dataset.action = '停止生成';
    stop.onclick = () => { void ctx.cancelGeneration().catch((reason: Error) => { error = reason.message; void ctx.refresh(); }); };
    return stop;
  }
  function contentRequest() {
    const input = labelInput('想看什么', query); input.input.oninput = () => { query = input.input.value; };
    root.append(input.holder, button('生成 APP 内容', async () => {
      if (!query.trim()) throw new Error('请说明想看的内容。');
      await generate('APP：' + (config.title ?? kind) + '。本次要求：' + query);
    }), stopButton());
  }
  async function render(target: HTMLElement) {
    root = target; root.replaceChildren(); root.style.display = 'grid'; root.style.gap = '12px';
    root.append(make('h2', config.title ?? ctx.title));
    if (error) { const message = make('p', error); message.setAttribute('role', 'alert'); root.append(message); }
    if (kind === 'calculator') { calculator(); return; }
    if (kind === 'clock') { clock(); return; }
    if (['messages', 'sms', 'groups', 'calls'].includes(kind)) { conversation(); return; }
    if (editing) { editor(); return; }
    const items = visibleItems();
    if (kind === 'wallet') {
      const balance = numberAt(config.balancePath); root.append(make('p', typeof balance === 'number' ? '余额：' + balance : '尚未设置余额来源'));
    }
    if (kind === 'calendar' && config.storyTimePath) root.append(make('p', '故事时间：' + (numberAt(config.storyTimePath) ?? '尚无记录')));
    const selected = items.find(item => item.id === selection);
    if (selected) { detail(selected); return; } else selection = '';
    if (kind !== 'notifications') root.append(button('新增', () => showEditor()));
    if (['gallery', 'camera'].includes(kind)) {
      const label = make('label', '收录图片'), file = document.createElement('input'); file.type = 'file'; file.accept = 'image/*'; file.setAttribute('aria-label', '收录图片');
      file.onchange = async () => {
        const image = file.files?.[0]; if (!image) return;
        try {
          if (!image.type.startsWith('image/')) throw new Error('请选择图片文件。');
          const data = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error('图片读取失败。')); reader.readAsDataURL(image); });
          await storeItem({ id: crypto.randomUUID(), title: image.name, content: '', url: data }); await ctx.refresh();
        } catch (reason) { error = String(reason); await ctx.refresh(); }
      }; label.append(file); root.append(label);
    }
    if (contentKinds.includes(kind) || ['forum', 'feed', 'music', 'video'].includes(kind)) contentRequest();
    if (['delivery', 'secondhand', 'movie'].includes(kind)) shoppingCart(items);
    list(items);
  }
  if (kind === 'clock') interval = window.setInterval(updateClock, 1000);
  return {
    render,
    dispose() { if (interval) clearInterval(interval); },
    expose() {
      const items = visibleItems();
      if (kind === 'contacts') return { contacts: items.map(item => ({ ...item, name: item.title, note: item.content })) };
      if (kind === 'notes') return { notes: items };
      if (kind === 'forum') return { posts: items };
      if (kind === 'notifications') return { notifications: items.map(item => ({ ...item, read: (state().read ?? []).includes(item.id) })) };
      if (['messages', 'sms', 'groups', 'calls'].includes(kind)) {
        const channel = kind === 'sms' ? 'sms' : kind === 'groups' ? 'group' : kind === 'calls' ? 'call' : 'private';
        const conversations = new Map<string, any>();
        for (const message of ctx.phone().messages.filter((item: any) => (item.channel ?? 'private') === channel)) {
          if (!conversations.has(message.contactId)) conversations.set(message.contactId, { id: message.contactId, contactId: message.contactId, messages: [], unread: 0 });
          conversations.get(message.contactId).messages.push(message);
          if (message.incoming && !(state().readMessages ?? []).includes(message.id)) conversations.get(message.contactId).unread++;
        }
        return { conversations: [...conversations.values()], groups: state().groups ?? [], calls: state().calls ?? [], items };
      }
      return { items };
    },
  };
}
