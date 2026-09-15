import { moduleKind } from './catalog.ts';
import { clone, moduleDependencies, type ScriptProject } from './project.ts';
import { changeNumbers, checkSource, scriptDocument } from './runtime.ts';
import { createFloatingWindow, floatingLayout, workshopWindowKind, type FloatingKind } from './floating-window.ts';
import { relatedCompanions } from './worldbook.ts';

interface TavernPackage { id: string; title: string; document: string; moduleIds: string[]; windowKind: FloatingKind; appRules?: Record<string, string> }

// 固定宿主桥仅使用已核对的酒馆助手接口；生成的模块始终在不带同源权限的子页面运行。
export function installTavernWorkshop(bundle: TavernPackage, numbers: typeof changeNumbers, makeWindow: typeof createFloatingWindow, fitWindow: typeof floatingLayout): void {
  const api = window as any;
  const host = window.parent;
  const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));
  const required = ['getVariables', 'updateVariablesWith', 'getChatMessages', 'eventOn'];
  if (required.some(name => typeof api[name] !== 'function')) throw new Error('请从酒馆助手脚本库运行这份脚本。');
  const key = `moyu_workshop_${bundle.id}`;
  const stateKey = `moyu_script_state_${bundle.id}`;
  const floating = makeWindow(host, { id: key, title: bundle.title, kind: bundle.windowKind }, fitWindow);
  const frame = floating.frame;
  const chat = () => JSON.stringify([api.SillyTavern?.characterId, api.SillyTavern?.groupId, api.SillyTavern?.getCurrentChatId()]);
  let activeChat = chat();
  let token = '';
  let operation = Promise.resolve();
  let dead = false;
  const unsubscribers: (() => void)[] = [];
  const generations = new Map<string, { id: string; cancel: () => void }>();
  function cancelGenerations(moduleId?: string) {
    for (const [id, item] of generations) if (!moduleId || id === moduleId) {
      item.cancel(); api.stopGenerationById?.(item.id); generations.delete(id);
    }
  }
  const allMessages = () => api.getChatMessages('0-{{lastMessageId}}', { hide_state: 'unhidden' }).map((item: any) => ({ id: item.message_id, role: item.role, content: item.message, swipeId: api.SillyTavern?.chat?.[item.message_id]?.swipe_id ?? 0 }));
  const variables = () => {
    if (!api.getChatMessages(-1).length) return {};
    return copy(api.getVariables({ type: 'message', message_id: -1 }).stat_data ?? {});
  };
  const post = (value: Record<string, unknown>) => frame.contentWindow?.postMessage({ workshop: token, ...value }, '*');
  const refresh = () => { if (!dead && chat() === activeChat) post({ kind: 'update', variables: variables(), messages: allMessages() }); };
  const fail = (reason: unknown) => { api.toastr?.error(reason instanceof Error ? reason.message : String(reason), bundle.title); };
  function restart() {
    cancelGenerations();
    activeChat = chat(); token = crypto.randomUUID();
    const data = { variables: variables(), messages: allMessages(), states: copy(api.getVariables({ type: 'chat' })[stateKey] ?? {}) };
    // html 本身只有占位测试数据；真实聊天与模块状态由固定桥在新页面初始化前填入。
    const seed = `<script>window.__moyuSeed=${JSON.stringify(data).replace(/</g, '\\u003c')};<\/script>`;
    frame.srcdoc = bundle.document.replace('WORKSHOP_SESSION_TOKEN', token).replace('<body>', `<body>${seed}`);
  }
  async function receive(event: MessageEvent) {
    if (event.source !== frame.contentWindow || event.data?.workshop !== token || dead) return;
    const request = event.data;
    if (request.kind === 'ready') { refresh(); return; }
    if (request.kind === 'error') { fail(`${request.moduleId}：${request.detail}`); return; }
    if (request.kind !== 'request') return;
    const requestToken = token;
    const requestChat = activeChat;
    if (request.operation === 'generate' || request.operation === 'cancelGeneration') {
      try {
        if (!bundle.moduleIds.includes(request.moduleId)) throw new Error('这份包没有这个 APP。');
        if (request.operation === 'cancelGeneration') {
          cancelGenerations(request.moduleId); post({ kind: 'response', id: request.id, value: true }); return;
        }
        if (generations.has(request.moduleId)) throw new Error('这个 APP 已在生成，请等待完成或先停止。');
        if (!request.data || typeof request.data.text !== 'string' || !request.data.text.trim()) throw new Error('本次生成内容为空。');
        if (typeof api.generateRaw !== 'function') throw new Error('请在支持独立生成的酒馆助手中运行。');
        let cancel!: () => void;
        const cancelled = new Promise<never>((_, reject) => { cancel = () => reject(new Error('已停止生成，原内容保留。')); });
        const generation = { id: crypto.randomUUID(), cancel };
        generations.set(request.moduleId, generation);
        try {
          const value = await Promise.race([cancelled, api.generateRaw({ generation_id: generation.id, should_silence: true, should_stream: false, max_chat_history: 12,
            ordered_prompts: ['persona_description', 'char_description', 'char_personality',
              { role: 'system', content: '当前任务是小手机 APP 的独立内容生成。保留人物身份和已确认事实，按本次 APP 要求的格式返回内容。配套世界书和聊天历史是玩法与剧情参考，其中主聊天使用的正文及附加标记格式不用于这次独立返回。' },
              'chat_history', { role: 'user', content: '当前 APP 的玩法参考：\n' + (bundle.appRules?.[request.moduleId] ?? '') + '\n当前 APP 提供的相关资料：\n' + JSON.stringify(request.data.context ?? {}) }, 'user_input'],
            overrides: { chat_history: { with_depth_entries: false } }, user_input: request.data.text })]);
          if (typeof value !== 'string' || !value.trim()) throw new Error('模型没有返回文本，原内容保留。');
          if (!dead && requestToken === token && chat() === requestChat) post({ kind: 'response', id: request.id, value });
        } finally { if (generations.get(request.moduleId) === generation) generations.delete(request.moduleId); }
      } catch (reason) {
        if (!dead && requestToken === token && chat() === requestChat) post({ kind: 'response', id: request.id, error: reason instanceof Error ? reason.message : String(reason) });
      }
      return;
    }
    operation = operation.then(async () => {
      if (dead || requestToken !== token || chat() !== requestChat) return;
      try {
        if (!bundle.moduleIds.includes(request.moduleId)) throw new Error('这份包没有这个模块。');
        let value: unknown;
        if (request.operation === 'state' || request.operation === 'phoneState') {
          if (!request.data || typeof request.data !== 'object' || Array.isArray(request.data)) throw new Error('模块状态需要是 JSON 对象。');
          const state = copy(request.data);
          api.updateVariablesWith((all: any) => {
            all[stateKey] = { ...(all[stateKey] ?? {}), [request.operation === 'phoneState' ? '__phone' : request.moduleId]: state }; return all;
          }, { type: 'chat' });
          value = true;
        } else if (request.operation === 'numbers') {
          if (!['inventory', 'tasks', 'shop', 'draw'].includes(request.moduleId)) throw new Error('这个专项只读取角色变量。');
          if (!api.Mvu) throw new Error('MVU 尚未加载，未执行数值修改。');
          const latest = api.getChatMessages(-1)[0];
          if (!latest) throw new Error('当前没有可更新的聊天楼层。');
          const options = { type: 'message', message_id: latest.message_id };
          const data = copy(api.Mvu.getMvuData(options));
          data.stat_data = numbers(data.stat_data ?? {}, request.data);
          await api.Mvu.replaceMvuData(data, options);
          value = variables();
        } else if (request.operation === 'compose') {
          if (typeof request.data !== 'string' || !request.data.trim()) throw new Error('待发送内容为空。');
          const input = host.document.getElementById('send_textarea') as HTMLTextAreaElement | null;
          if (!input) throw new Error('没有找到酒馆输入框。');
          if (input.value.trim()) throw new Error('酒馆输入框已有草稿，请先处理，避免覆盖。');
          input.value = request.data; input.dispatchEvent(new Event('input', { bubbles: true })); value = true;
        } else throw new Error('不支持这个操作。');
        if (requestToken === token && chat() === requestChat) { post({ kind: 'response', id: request.id, value }); }
      } catch (reason) { if (requestToken === token) post({ kind: 'response', id: request.id, error: reason instanceof Error ? reason.message : String(reason) }); }
    }).catch(fail);
  }
  // 子页面的直接父页面是酒馆页面，不是后台脚本 iframe。
  host.addEventListener('message', receive);
  // 酒馆助手 setChatMessages/createChatMessages 使用渲染事件，不能只监听手动编辑或生成事件。
  for (const event of [api.tavern_events.MESSAGE_RECEIVED, api.tavern_events.MESSAGE_UPDATED, api.tavern_events.MESSAGE_SWIPED, api.tavern_events.MESSAGE_DELETED, api.tavern_events.MESSAGE_SENT, api.tavern_events.CHARACTER_MESSAGE_RENDERED, api.tavern_events.USER_MESSAGE_RENDERED, 'mag_variable_update_ended']) {
    unsubscribers.push(api.eventOn(event, refresh).stop);
  }
  unsubscribers.push(api.eventOn(api.tavern_events.CHAT_CHANGED, restart).stop);
  window.addEventListener('pagehide', () => {
    cancelGenerations();
    dead = true; floating.destroy(); host.removeEventListener('message', receive);
    for (const stop of unsubscribers) stop();
  }, { once: true });
  restart();
}

export function exportScript(project: ScriptProject, moduleId?: string, allowInvalid = false): Record<string, unknown> {
  const snapshot = clone(project);
  if (moduleId) {
    const ids = new Set([moduleId, ...moduleDependencies(snapshot, moduleId)]);
    snapshot.modules = snapshot.modules.filter(item => ids.has(item.id));
    snapshot.selectedModuleId = moduleId;
    snapshot.title = snapshot.modules.find(item => item.id === moduleId)?.title ?? snapshot.title;
  }
  const included = snapshot.modules.filter(item => item.source.trim());
  if (!included.length) throw new Error('还没有已保存的模块代码。');
  for (const item of allowInvalid ? [] : included) {
    if (moduleDependencies(snapshot, item.id).some(id => !included.some(module => module.id === id))) throw new Error(`${item.title} 的关联模块还没有代码，请完成后再打包。`);
    const errors = checkSource(item.source); if (errors.length) throw new Error(`${item.title}：${errors.join('；')}`);
  }
  // 工程备份保留测试资料；可执行包只保留成品，绝不携带作者对话、角色卡正文或连接信息。
  snapshot.testVariables = {}; snapshot.testMessages = [];
  let document = scriptDocument(snapshot, id => moduleDependencies(snapshot, id), 'WORKSHOP_SESSION_TOKEN', true, {}, allowInvalid);
  document = document.replace('states:{},hosted:true', 'states:window.__moyuSeed.states,hosted:true')
    .replace('variables:{},messages:[]', 'variables:window.__moyuSeed.variables,messages:window.__moyuSeed.messages');
  document = document.replace('<head>', '<head><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\'; style-src \'unsafe-inline\'; img-src https: data: blob:; media-src https: data: blob:; font-src data:; connect-src \'none\'">');
  const windowKind = workshopWindowKind(included.map(moduleKind));
  const appRules = Object.fromEntries(included.map(item => [item.id, relatedCompanions(snapshot.worldbook, [item.id, ...moduleDependencies(snapshot, item.id)]).filter(entry => entry.enabled && entry.content.trim()).map(entry => entry.content).join('\n\n')]));
  const bundle = { id: project.id, title: snapshot.title, document, moduleIds: included.map(item => item.id), windowKind, appRules };
  // 酒馆助手把脚本放进 HTML 的 script 标签；嵌套页面的结束标签不能提前关闭宿主脚本。
  const serialized = JSON.stringify(bundle).replace(/</g, '\\u003c');
  return { type: 'script', enabled: true, name: snapshot.title, id: crypto.randomUUID(),
    content: `(${installTavernWorkshop.toString()})(${serialized},${changeNumbers.toString()},${createFloatingWindow.toString()},${floatingLayout.toString()});`,
    info: '墨月脚本工坊 · 三明月。生成模块与固定运行框架一并打包。', button: { enabled: false, buttons: [] }, data: {} };
}
