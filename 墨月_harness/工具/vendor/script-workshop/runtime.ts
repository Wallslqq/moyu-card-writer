import { parse } from 'acorn';
import type { ScriptProject } from './project.ts';
import { parsePhoneMessages } from './phone.ts';
import { moduleKind } from './catalog.ts';
import { workshopWindowKind } from './floating-window.ts';
import { createPhoneShell, phoneShellStyle } from './phone-shell.ts';
import { calculatePhone, createPhoneApp, type PhoneAppConfig } from './phone-app.ts';

export interface NumberChange { path: string[]; expected: number; value: number }
export function changeNumbers(variables: Record<string, unknown>, changes: NumberChange[]): Record<string, unknown> {
  const next = JSON.parse(JSON.stringify(variables));
  if (!Array.isArray(changes) || !changes.length) throw new Error('没有提供数值变化。');
  const paths = new Set<string>();
  for (const change of changes) {
    if (!Array.isArray(change.path) || !change.path.length || change.path.some(key => typeof key !== 'string' || ['__proto__', 'prototype', 'constructor'].includes(key))) throw new Error('变量路径不正确。');
    const key = JSON.stringify(change.path);
    if (paths.has(key)) throw new Error('一笔操作不能重复修改同一个数值。');
    paths.add(key);
    if (!Number.isFinite(change.expected) || !Number.isFinite(change.value) || change.value < 0) throw new Error('数值变化必须是有限的非负数。');
    let owner = next;
    for (const part of change.path.slice(0, -1)) {
      if (!owner || typeof owner !== 'object' || !Object.hasOwn(owner, part)) throw new Error('这个变量不存在，请先确认绑定。');
      owner = owner[part];
    }
    const leaf = change.path.at(-1)!;
    if (!owner || typeof owner !== 'object' || !Object.hasOwn(owner, leaf) || owner[leaf] !== change.expected) throw new Error('数值已变化，请刷新后重试；这次没有扣除任何资源。');
    owner[leaf] = change.value;
  }
  return next;
}

export interface DrawItem { id: string; weight: number; guaranteed?: boolean }
export function drawWeighted(pool: DrawItem[], misses = 0, pity = 0, random = Math.random()): { id: string; misses: number } {
  if (!Array.isArray(pool) || !pool.length || new Set(pool.map(item => item.id)).size !== pool.length) throw new Error('奖励池为空或 ID 重复。');
  if (pool.some(item => !item.id || !Number.isFinite(item.weight) || item.weight < 0) || !Number.isInteger(misses) || misses < 0 || !Number.isInteger(pity) || pity < 0 || !Number.isFinite(random) || random < 0 || random >= 1) throw new Error('抽取参数不正确。');
  const guaranteed = pity > 0 && misses + 1 >= pity;
  const available = pool.filter(item => item.weight > 0 && (!guaranteed || item.guaranteed));
  const total = available.reduce((sum, item) => sum + item.weight, 0);
  if (!(total > 0) || !Number.isFinite(total)) throw new Error('没有可抽取的奖励；请检查权重和保底奖励。');
  let position = random * total;
  let result = available.at(-1)!;
  for (const item of available) { position -= item.weight; if (position < 0) { result = item; break; } }
  return { id: result.id, misses: result.guaranteed ? 0 : misses + 1 };
}

export function checkSource(source: string): string[] {
  if (!source.trim()) return ['当前模块还没有保存代码。'];
  try { parse(`function create(ctx) {\n${source}\n}`, { ecmaVersion: 'latest', sourceType: 'script' }); return []; }
  catch (error) { return [`代码语法：${error instanceof Error ? error.message : String(error)}`]; }
}

export interface RuntimeDefinition { id: string; title: string; specialtyId?: string; icon?: string; dependencies: string[]; create: (ctx: any) => any }
export interface RuntimeOptions {
  token: string;
  selectedId: string;
  modules: RuntimeDefinition[];
  variables: Record<string, unknown>;
  messages: { id: number; role: string; content: string }[];
  states: Record<string, unknown>;
  hosted: boolean;
  phoneLayout?: boolean;
}
export interface RuntimeCase {
  moduleId?: string;
  variables?: Record<string, unknown>;
  messages?: ScriptProject['testMessages'];
  actions?: { type: 'click' | 'fill'; selector: string; value?: string }[];
  expectText?: string[];
  expectValues?: { selector: string; value: string }[];
}

// 此函数整体送入隔离页面；不能引用外部模块、密钥、编辑器状态或宿主页对象。
export function bootRuntime(options: RuntimeOptions, numbers: typeof changeNumbers, draw: typeof drawWeighted, phone: typeof parsePhoneMessages, makePhone?: typeof createPhoneShell, makeApp?: typeof createPhoneApp, calculate?: typeof calculatePhone): void {
  const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));
  const root = document.getElementById('script-root')!;
  const menu = document.getElementById('script-menu')!;
  const notice = document.getElementById('script-notice')!;
  const instances = new Map<string, any>();
  const pending = new Map<string, { resolve: (value: any) => void; reject: (reason: Error) => void; timeout: number }>();
  let selectedId = options.selectedId;
  let generation = 0;
  let disposed = false;
  const pages = new Map<string, unknown[]>();
  let phoneShell: ReturnType<typeof createPhoneShell> | undefined;
  const report = (kind: string, detail: unknown, moduleId = selectedId, stack?: string) => parent.postMessage({ workshop: options.token, kind, moduleId, detail, stack }, '*');
  const fail = (error: unknown, id = selectedId) => {
    const text = error instanceof Error ? error.message : String(error);
    notice.textContent = text;
    report('error', text, id, error instanceof Error ? error.stack : undefined);
  };
  const rpc = (operation: string, moduleId: string, data: unknown): Promise<any> => new Promise((resolve, reject) => {
    const id = crypto.randomUUID();
    // ponytail: 独立生成最多等待 180 秒；超时只取消本 APP 的请求，不停止玩家的主剧情生成。
    const timeout = window.setTimeout(() => {
      pending.delete(id);
      if (operation === 'generate') parent.postMessage({ workshop: options.token, kind: 'request', id: crypto.randomUUID(), operation: 'cancelGeneration', moduleId }, '*');
      reject(new Error(operation === 'generate' ? '生成超时，原内容保留，可以重试。' : '保存或操作没有返回结果，请确认酒馆仍停留在这个聊天。'));
    }, operation === 'generate' ? 180000 : 10000);
    pending.set(id, { resolve, reject, timeout });
    parent.postMessage({ workshop: options.token, kind: 'request', id, operation, moduleId, data }, '*');
  });
  async function render(): Promise<void> {
    const instance = instances.get(selectedId);
    if (!instance) { root.replaceChildren(); return; }
    const ticket = ++generation;
    const container = document.createElement('section');
    // 先挂载再渲染：模块可能通过 document.getElementById 绑定自己刚创建的控件。
    // 旧的异步 render 只能继续操作已移除的节点，不能重新覆盖较新的画面。
    root.replaceChildren(container);
    try {
      await instance.render(container);
      if (disposed || ticket !== generation) return;
      notice.textContent = '';
      report('rendered', { elements: container.querySelectorAll('*').length, text: container.innerText.slice(0, 1000),
        controls: Array.from(container.querySelectorAll('button,input,textarea,select,[role="button"]')).slice(0, 80).map(element => ({
          tag: element.tagName, id: element.id, label: element.getAttribute('aria-label') || element.getAttribute('placeholder') || element.textContent?.slice(0, 60),
        })),
      });
    } catch (error) { fail(error); }
  }
  function build(): void {
    for (const definition of options.modules) {
      const id = definition.id;
      const ctx = Object.freeze({
        id,
        title: definition.title,
        dependencies: [...definition.dependencies],
        phoneApp: (kind: string, config: PhoneAppConfig = {}) => {
          if (!makeApp || !calculate) throw new Error('当前文件缺少固定 APP 实现，请重新打包。');
          return makeApp(ctx, kind, config, calculate);
        },
        page: () => copy(pages.get(id)?.at(-1) ?? null),
        navigate: async (page: unknown) => {
          if (page === null) pages.set(id, []);
          else pages.set(id, [...(pages.get(id) ?? []), copy(page)]);
          await render();
        },
        variables: () => copy(options.variables),
        messages: () => copy(options.messages),
        phone: () => phone(options.messages),
        generate: async (text: string, context: Record<string, unknown> = {}) => {
          if (!options.hosted) throw new Error('独立内容生成需要在酒馆运行；本地预览没有调用模型，原内容保留。');
          if (typeof text !== 'string' || !text.trim()) throw new Error('请先说明本次要生成什么内容。');
          return rpc('generate', id, { text, context });
        },
        cancelGeneration: () => options.hosted ? rpc('cancelGeneration', id, null) : Promise.resolve(),
        state: () => copy(options.states[id] ?? {}),
        read: (dependency: string) => {
          if (!definition.dependencies.includes(dependency)) throw new Error('这个模块没有声明关联关系。');
          const other = instances.get(dependency);
          return copy(other?.expose ? other.expose() : options.states[dependency] ?? {});
        },
        setState: async (state: unknown) => {
          if (!state || typeof state !== 'object' || Array.isArray(state)) throw new Error('模块状态需要是 JSON 对象。');
          const saved = copy(state);
          if (options.hosted) await rpc('state', id, saved);
          options.states[id] = saved;
          report('state', { fields: Object.keys(saved as object) }, id);
          await render();
        },
        changeNumbers: async (changes: NumberChange[]) => {
          const next = numbers(options.variables, changes);
          options.variables = options.hosted ? await rpc('numbers', id, changes) : next;
          report('variables', { paths: changes.map(change => change.path) }, id);
          await render();
          return copy(options.variables);
        },
        compose: async (text: string) => {
          if (typeof text !== 'string' || !text.trim()) throw new Error('没有要交给酒馆的内容。');
          if (options.hosted) await rpc('compose', id, text);
          else { const input = document.getElementById('script-draft') as HTMLTextAreaElement; input.hidden = false; input.value = text; }
          report('compose', text, id);
        },
        draw: (pool: DrawItem[], misses = 0, pity = 0) => draw(pool, misses, pity),
        refresh: () => id === selectedId ? render() : Promise.resolve(),
      });
      try {
        const instance = definition.create(ctx);
        if (typeof instance === 'function') throw new Error('模块多包了一层函数。工坊已提供 function(ctx)，编辑框只保留它里面的代码，最后直接 return { render(root) { ... } }，不要 return function(ctx)。');
        if (!instance || typeof instance.render !== 'function') throw new Error('模块必须返回包含 render(root) 的对象。');
        instances.set(id, instance);
        const button = document.createElement('button');
        const icon = document.createElement('span'); icon.className = 'phone-icon'; icon.textContent = definition.icon || '✦'; icon.setAttribute('aria-hidden', 'true');
        const label = document.createElement('span'); label.textContent = definition.title;
        button.append(icon, label); button.setAttribute('aria-label', definition.title);
        button.dataset.module = id;
        button.onclick = () => { selectedId = id; void render(); };
        menu.appendChild(button);
      } catch (error) { fail(error, id); }
    }
    if (!instances.has(selectedId)) selectedId = instances.keys().next().value ?? '';
  }
  async function receive(event: MessageEvent): Promise<void> {
    // 酒馆助手的后台脚本与悬浮页是同一宿主页的兄弟 iframe；运行令牌仍须完全匹配。
    const fromHostScript = options.hosted && (event.source as Window | null)?.parent === parent;
    if ((event.source !== parent && !fromHostScript) || event.data?.workshop !== options.token) return;
    const message = event.data;
    if (message.kind === 'response') {
      const waiting = pending.get(message.id);
      if (!waiting) return;
      pending.delete(message.id); clearTimeout(waiting.timeout);
      if (message.error) waiting.reject(new Error(message.error)); else waiting.resolve(message.value);
    } else if (message.kind === 'update') {
      if (message.moduleId && !instances.has(message.moduleId)) {
        report('updated', { caseId: message.caseId, actions: [], assertions: [{ moduleId: message.moduleId, passed: false, error: '当前运行文件没有这个模块。' }] });
        return;
      }
      if (message.moduleId) { selectedId = message.moduleId; phoneShell?.showApp(selectedId); }
      if (message.variables !== undefined) options.variables = copy(message.variables);
      if (message.messages !== undefined) options.messages = copy(message.messages);
      for (const [id, instance] of instances) {
        try { await instance.update?.(); } catch (error) { fail(error, id); }
      }
      await render();
      const actions: { type: string; selector: string; passed: boolean; error?: string }[] = [];
      for (const action of message.actions ?? []) {
        try {
          const matches = root.querySelectorAll(action.selector);
          if (matches.length !== 1) throw new Error(`需要唯一定位，实际找到 ${matches.length} 个元素`);
          const element = matches[0] as HTMLElement;
          if (!element.getClientRects().length) throw new Error('这个控件当前不可见');
          if (action.type === 'click') element.click();
          else if (action.type === 'fill' && element.matches('input:not([type="file"]),textarea,select')) {
            (element as HTMLInputElement).value = action.value ?? '';
            element.dispatchEvent(new Event('input', { bubbles: true }));
            element.dispatchEvent(new Event('change', { bubbles: true }));
          } else throw new Error('这不是可填写的控件');
          // 当前允许的预览写操作都在本地完成，等这一轮事件与 Promise 回调落定再继续下一步。
          await new Promise(resolve => setTimeout(resolve, 0));
          actions.push({ type: action.type, selector: action.selector, passed: true });
        } catch (error) {
          actions.push({ type: action.type, selector: action.selector, passed: false, error: error instanceof Error ? error.message : String(error) });
          break;
        }
      }
      const text = root.innerText;
      const valueAssertions = (message.expectValues ?? []).map((expected: { selector: string; value: string }) => {
        try {
          const matches = root.querySelectorAll(expected.selector);
          if (matches.length !== 1) throw new Error(`需要唯一定位，实际找到 ${matches.length} 个元素`);
          const element = matches[0] as HTMLInputElement;
          return { selector: expected.selector, expected: expected.value, actual: element.value, passed: element.value === expected.value };
        } catch (error) {
          return { selector: expected.selector, expected: expected.value, passed: false, error: error instanceof Error ? error.message : String(error) };
        }
      });
      report('updated', { caseId: message.caseId, actions, assertions: [...(Array.isArray(message.expectText) ? message.expectText : []).map((expected: string) => ({ text: expected, passed: text.includes(expected) })), ...valueAssertions] });
    } else if (message.kind === 'select' && instances.has(message.moduleId)) {
      selectedId = message.moduleId; phoneShell?.showApp(selectedId); await render();
    }
  }
  window.addEventListener('message', receive);
  window.addEventListener('error', event => fail(event.error ?? event.message));
  window.addEventListener('unhandledrejection', event => fail(event.reason));
  window.addEventListener('pagehide', () => {
    disposed = true; generation++;
    window.removeEventListener('message', receive);
    for (const value of pending.values()) { clearTimeout(value.timeout); value.reject(new Error('页面已关闭。')); }
    pending.clear();
    for (const instance of instances.values()) { try { instance.dispose?.(); } catch (error) { fail(error); } }
    instances.clear();
  }, { once: true });
  build();
  if (options.phoneLayout && makePhone) {
    phoneShell = makePhone(options.states.__phone ?? {}, async value => {
      if (options.hosted) await rpc('phoneState', selectedId, value);
      options.states.__phone = copy(value);
    }, id => { selectedId = id; void render(); }, () => {
      const stack = pages.get(selectedId);
      if (!stack?.length) return false;
      stack.pop(); void render(); return true;
    });
    if (!options.hosted) phoneShell.showApp(selectedId);
  }
  report('ready', { modules: [...instances.keys()] });
  void (async () => {
    for (const [id, instance] of instances) { try { await instance.update?.(); } catch (error) { fail(error, id); } }
    await render();
  })();
}

export const runtimeStyle = `*{box-sizing:border-box}body{margin:0;padding:14px;background:#f7f7f4;color:#182c40;font:16px/1.6 system-ui,sans-serif}button,input,textarea,select{font:inherit;color:inherit}button{padding:8px 12px;border:1px solid #b4c6d2;border-radius:7px;background:#fff;cursor:pointer;min-height:40px}button:disabled{opacity:.5}button:focus-visible,input:focus-visible,textarea:focus-visible{outline:3px solid #2375aa;outline-offset:2px}input,textarea{max-width:100%;padding:8px;background:white;border:1px solid #9faeb9;border-radius:4px}img{max-width:100%;height:auto}#script-menu{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px}#script-root{min-width:0;overflow-wrap:anywhere}#script-notice{color:#982519}#script-draft{width:100%;min-height:90px;margin-top:16px}table{max-width:100%}`;

export function scriptDocument(project: ScriptProject, dependencies: (id: string) => string[], token: string, hosted = false, states = {}, allowInvalid = false): string {
  const modules = project.modules.filter(item => item.source.trim()).sort((a, b) => dependencies(a.id).length - dependencies(b.id).length);
  // 整卡确认导出可以携带待修的原代码；正常预览与脚本导出仍先检查语法。
  for (const item of allowInvalid ? [] : modules) {
    const errors = checkSource(item.source);
    if (errors.length) throw new Error(`${item.title}：${errors.join('；')}`);
  }
  if (!modules.length) throw new Error('还没有可以运行的模块代码。');
  const json = (value: unknown) => JSON.stringify(value).replace(/</g, '\\u003c');
  const definitions = modules.map(item => `{id:${json(item.id)},title:${json(item.title)},specialtyId:${json(moduleKind(item))},icon:${json(item.icon ?? '')},dependencies:${json(dependencies(item.id))},create:function(ctx){\n${item.source}\n}}`).join(',');
  const code = `(${bootRuntime.toString()})({token:${json(token)},selectedId:${json(project.selectedModuleId)},modules:[${definitions}],phoneLayout:${workshopWindowKind(modules.map(moduleKind)) === 'phone'},variables:${json(project.testVariables)},messages:${json(project.testMessages)},states:${json(states)},hosted:${hosted}},${changeNumbers.toString()},${drawWeighted.toString()},${parsePhoneMessages.toString()},${createPhoneShell.toString()},${createPhoneApp.toString()},${calculatePhone.toString()});`;
  // 代码进入 script 文本节点，防止作者字符串中的结束标签截断整个运行文件。
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${runtimeStyle}\n${phoneShellStyle}</style></head><body><nav id="script-menu" aria-label="应用"></nav><p id="script-notice" role="alert"></p><main id="script-root"></main><textarea id="script-draft" hidden aria-label="待发送草稿"></textarea><script>${code.replace(/<\/script/gi, '<\\/script')}<\/script></body></html>`;
}
