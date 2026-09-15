export type FloatingKind = 'phone' | 'panel';
export interface FloatingViewport { left: number; top: number; width: number; height: number }
export interface FloatingPoint { x: number; y: number }
export const workshopWindowKind = (ids: string[]): FloatingKind => ids.some(id => specialties.some(item => item.id === id && item.group === '小手机')) ? 'phone' : 'panel';

// 提炼自本地小手机、成就相册的入口/拖动边界；不照搬原件的手机全屏分支。
export function floatingLayout(viewport: FloatingViewport, kind: FloatingKind, point?: FloatingPoint) {
  const gap = Math.min(12, viewport.width / 4, viewport.height / 4);
  const width = Math.min(kind === 'phone' ? 380 : 640, viewport.width - gap * 2);
  const height = Math.min(kind === 'phone' ? 660 : 520, viewport.height * .82);
  const x = Math.min(Math.max(point?.x ?? viewport.left + viewport.width - width - gap, viewport.left + gap), viewport.left + viewport.width - width - gap);
  const y = Math.min(Math.max(point?.y ?? viewport.top + viewport.height - height - gap, viewport.top + gap), viewport.top + viewport.height - height - gap);
  return { x, y, width, height };
}

export const floatingWindowGuide = `脚本成品通过悬浮入口打开独立小窗口，不接管酒馆聊天页面。手机、成就、背包等都遵守这个边界；手机窄屏仍留出窗口外部空间，不切成全屏。
固定外壳已负责悬浮入口、顶部拖动、方向键移动、收起和重新打开、窗口边界限制、手机键盘/横竖屏尺寸变化，以及停用时清理。收起只隐藏窗口，不销毁模块或丢失输入。
你的 render(root) 只实现窗口内部的应用内容。以 root 实际可用宽度自适应，长内容在内部滚动；不要再写外层悬浮按钮、全屏遮罩、宿主页样式或窗口拖动代码。窗口内部可以有自己的详情、弹层和返回操作，但它们不能超出内容区。
需要了解固定实现时调用 read_framework；该源码是只读参考，不是当前模块的待写入文件。`;

// 整个函数随导出包分发，所有共用依赖显式传入，不引用写卡器的状态与 DOM。
export function createFloatingWindow(host: Window, options: { id: string; title: string; kind: FloatingKind }, fit: typeof floatingLayout) {
  const doc = host.document;
  const holder = doc.createElement('div'); holder.id = options.id;
  if (doc.getElementById(options.id)) throw new Error('这个脚本工程已经打开，请关闭旧实例后再运行。');
  Object.assign(holder.style, { all: 'initial', font: '16px/1.4 system-ui,sans-serif', color: '#182c40', position: 'fixed', left: '0', top: '0', width: '0', height: '0', zIndex: '10000' });
  const root = holder.attachShadow({ mode: 'open' });
  const style = doc.createElement('style');
  style.textContent = `:host{font:16px/1.4 system-ui,sans-serif;color:#182c40}*{box-sizing:border-box}button{font:inherit;color:inherit;cursor:pointer;border:0}button:focus-visible{outline:3px solid #1766a0;outline-offset:2px}.launcher{position:fixed;min-height:48px;max-width:160px;padding:10px 14px;border:1px solid #97b5cc;border-radius:24px;background:#20354b;color:white;box-shadow:0 4px 16px #0003;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;touch-action:none;user-select:none}.panel{position:fixed;display:flex;flex-direction:column;overflow:hidden;border:1px solid #8da9be;border-radius:16px;background:#f7f7f4;box-shadow:0 12px 40px #0004}.panel[hidden]{display:none}.bar{display:flex;flex:0 0 48px;min-height:48px;gap:4px;align-items:stretch;background:#e8f0f5;border-bottom:1px solid #afc4d3;padding:4px}.handle{flex:1;min-width:0;padding:4px 10px;text-align:left;background:transparent;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:grab;touch-action:none;user-select:none}.close{flex:0 0 auto;min-width:48px;padding:4px 10px;background:transparent;border-radius:8px}.close:hover{background:#d3e3ed}iframe{display:block;flex:1;min-height:0;width:100%;border:0;background:#f7f7f4}`;
  const launcher = doc.createElement('button'); launcher.type = 'button'; launcher.className = 'launcher';
  launcher.textContent = options.title; launcher.title = options.title;
  launcher.setAttribute('aria-label', `打开${options.title}`); launcher.setAttribute('aria-expanded', 'false');
  const panel = doc.createElement('section'); panel.className = 'panel'; panel.id = 'window'; panel.hidden = true;
  panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', options.title); panel.setAttribute('aria-modal', 'false');
  launcher.setAttribute('aria-controls', panel.id);
  const bar = doc.createElement('div'); bar.className = 'bar';
  const handle = doc.createElement('button'); handle.type = 'button'; handle.className = 'handle'; handle.textContent = options.title;
  handle.setAttribute('aria-label', `移动${options.title}窗口`); handle.title = '拖动或使用方向键移动窗口';
  const closeButton = doc.createElement('button'); closeButton.type = 'button'; closeButton.className = 'close'; closeButton.textContent = '收起';
  closeButton.setAttribute('aria-label', `收起${options.title}`);
  const frame = doc.createElement('iframe'); frame.title = options.title; frame.sandbox.add('allow-scripts');
  bar.append(handle, closeButton); panel.append(bar, frame); root.append(style, launcher, panel); doc.body.append(holder);
  const listeners = new AbortController();
  let launcherPoint: FloatingPoint | undefined;
  let windowPoint: FloatingPoint | undefined;
  let suppressClick = false;
  let drag: { id: number; target: HTMLElement; kind: 'launcher' | 'window'; start: FloatingPoint; base: FloatingPoint; moved: boolean } | undefined;
  const viewport = (): FloatingViewport => ({ left: host.visualViewport?.offsetLeft ?? 0, top: host.visualViewport?.offsetTop ?? 0, width: host.visualViewport?.width ?? host.innerWidth, height: host.visualViewport?.height ?? host.innerHeight });
  function placeLauncher(point?: FloatingPoint) {
    const view = viewport();
    const width = Math.min(160, view.width - 16), height = launcher.offsetHeight || 48;
    launcher.style.maxWidth = `${width}px`;
    const actualWidth = launcher.offsetWidth || width;
    launcherPoint = {
      x: Math.min(Math.max(point?.x ?? view.left + view.width - actualWidth - 12, view.left + 8), Math.max(view.left + 8, view.left + view.width - actualWidth - 8)),
      y: Math.min(Math.max(point?.y ?? view.top + view.height - height - 80, view.top + 8), Math.max(view.top + 8, view.top + view.height - height - 8)),
    };
    Object.assign(launcher.style, { left: `${launcherPoint.x}px`, top: `${launcherPoint.y}px` });
  }
  function placeWindow(point = windowPoint) {
    const box = fit(viewport(), options.kind, point); windowPoint = { x: box.x, y: box.y };
    Object.assign(panel.style, { left: `${box.x}px`, top: `${box.y}px`, width: `${box.width}px`, height: `${box.height}px` });
  }
  function close() { panel.hidden = true; launcher.hidden = false; launcher.setAttribute('aria-expanded', 'false'); placeLauncher(launcherPoint); launcher.focus({ preventScroll: true }); }
  function open() { panel.hidden = false; placeWindow(); launcher.hidden = true; launcher.setAttribute('aria-expanded', 'true'); closeButton.focus({ preventScroll: true }); }
  launcher.addEventListener('click', event => { if (event.detail > 0 && suppressClick) { suppressClick = false; return; } open(); }, { signal: listeners.signal });
  closeButton.addEventListener('click', close, { signal: listeners.signal });
  root.addEventListener('keydown', event => { if ((event as KeyboardEvent).key === 'Escape' && !panel.hidden) { event.preventDefault(); close(); } }, { signal: listeners.signal });
  for (const [target, kind] of [[launcher, 'launcher'], [handle, 'window']] as const) {
    target.addEventListener('pointerdown', event => {
      if (event.button !== 0 || !event.isPrimary) return;
      const base = kind === 'launcher' ? launcherPoint! : windowPoint!;
      suppressClick = false; drag = { id: event.pointerId, target, kind, start: { x: event.clientX, y: event.clientY }, base: { ...base }, moved: false };
      target.setPointerCapture(event.pointerId);
    }, { signal: listeners.signal });
    target.addEventListener('pointermove', event => {
      if (!drag || drag.target !== target || drag.id !== event.pointerId) return;
      const dx = event.clientX - drag.start.x, dy = event.clientY - drag.start.y;
      if (!drag.moved && Math.hypot(dx, dy) < 4) return;
      drag.moved = true;
      const point = { x: drag.base.x + dx, y: drag.base.y + dy };
      if (kind === 'launcher') placeLauncher(point); else placeWindow(point);
    }, { signal: listeners.signal });
    const end = (event: PointerEvent) => {
      if (!drag || drag.target !== target || drag.id !== event.pointerId) return;
      suppressClick = event.type === 'pointerup' && drag.kind === 'launcher' && drag.moved;
      drag = undefined;
      if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId);
    };
    target.addEventListener('pointerup', end, { signal: listeners.signal });
    target.addEventListener('pointercancel', end, { signal: listeners.signal });
    target.addEventListener('lostpointercapture', end, { signal: listeners.signal });
    target.addEventListener('keydown', event => {
      const direction = ({ ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] } as Record<string, number[]>)[event.key];
      if (!direction) return;
      event.preventDefault(); const base = kind === 'launcher' ? launcherPoint! : windowPoint!, step = event.shiftKey ? 64 : 16;
      const point = { x: base.x + direction[0]! * step, y: base.y + direction[1]! * step };
      if (kind === 'launcher') placeLauncher(point); else placeWindow(point);
    }, { signal: listeners.signal });
  }
  const resize = () => { placeLauncher(launcherPoint); placeWindow(); };
  host.addEventListener('resize', resize, { signal: listeners.signal });
  host.visualViewport?.addEventListener('resize', resize, { signal: listeners.signal });
  host.visualViewport?.addEventListener('scroll', resize, { signal: listeners.signal });
  placeLauncher();
  return { frame, open, close, destroy: () => { listeners.abort(); drag = undefined; holder.remove(); } };
}

export function floatingPreviewDocument(content: string, title: string, kind: FloatingKind, token: string): string {
  function start(content: string, title: string, kind: FloatingKind, token: string, make: typeof createFloatingWindow, fit: typeof floatingLayout) {
    const floating = make(window, { id: 'moyu-floating-preview', title, kind }, fit);
    const relay = (event: MessageEvent) => {
      if (event.data?.workshop !== token) return;
      if (event.source === parent) floating.frame.contentWindow?.postMessage(event.data, '*');
      else if (event.source === floating.frame.contentWindow) parent.postMessage(event.data, '*');
    };
    window.addEventListener('message', relay);
    window.addEventListener('pagehide', () => { window.removeEventListener('message', relay); floating.destroy(); }, { once: true });
    floating.frame.srcdoc = content;
    floating.open();
  }
  const code = `(${start.toString()})(${JSON.stringify(content)},${JSON.stringify(title)},${JSON.stringify(kind)},${JSON.stringify(token)},${createFloatingWindow.toString()},${floatingLayout.toString()});`;
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>悬浮窗口预览</title><style>html,body{margin:0;height:100%;background:repeating-linear-gradient(135deg,#edf0f2,#edf0f2 16px,#e4e9ed 16px,#e4e9ed 32px)}</style></head><body><script>${code.replace(/<\/script/gi, '<\\/script')}<\/script></body></html>`;
}
import { specialties } from './catalog.ts';
