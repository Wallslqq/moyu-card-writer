export interface PhonePreferences { order?: string[]; theme?: string; wallpaper?: string }

// 与预览、最终脚本一起编译；只负责固定手机导航，不持有 APP 的业务数据。
export function createPhoneShell(preferences: PhonePreferences, save: (value: PhonePreferences) => Promise<void>, open: (id: string) => void, back: () => boolean) {
  const menu = document.getElementById('script-menu')!;
  const root = document.getElementById('script-root')!;
  const toolbar = document.createElement('header'); toolbar.className = 'phone-toolbar';
  const makeButton = (label: string, action: () => void) => {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = label;
    button.onclick = action; return button;
  };
  let home = false, dragged = '';
  const title = document.createElement('strong');
  const settings = document.createElement('section'); settings.className = 'phone-settings'; settings.hidden = true;
  const theme = document.createElement('select'); theme.setAttribute('aria-label', '手机主题');
  for (const [value, text] of [['dark', '深色'], ['light', '浅色']]) {
    const option = document.createElement('option'); option.value = value!; option.textContent = text!; theme.append(option);
  }
  const wallpaper = document.createElement('input'); wallpaper.type = 'url'; wallpaper.setAttribute('aria-label', '壁纸地址'); wallpaper.placeholder = '壁纸图片地址';
  const result = document.createElement('p'); result.setAttribute('role', 'status');
  const settingsButton = makeButton('外观', () => { settings.hidden = !settings.hidden; });
  const homeButton = makeButton('桌面', () => showHome());
  const backButton = makeButton('返回', () => { if (!back()) showHome(); });
  toolbar.append(backButton, homeButton, title, settingsButton);
  const submit = document.createElement('button'); submit.textContent = '保存外观'; submit.type = 'button';
  settings.append(theme, wallpaper, submit, result);
  menu.before(toolbar, settings);
  document.body.classList.add('phone-runtime');
  const apply = () => {
    document.body.dataset.phoneTheme = preferences.theme === 'light' ? 'light' : 'dark';
    menu.style.backgroundImage = preferences.wallpaper ? 'url(' + JSON.stringify(preferences.wallpaper) + ')' : '';
    theme.value = preferences.theme ?? 'dark'; wallpaper.value = preferences.wallpaper ?? '';
    const remaining = Array.from(menu.children).filter(item => !(preferences.order ?? []).includes((item as HTMLElement).dataset.module!));
    for (const id of preferences.order ?? []) {
      const button = Array.from(menu.children).find(item => (item as HTMLElement).dataset.module === id);
      if (button) menu.append(button);
    }
    menu.append(...remaining);
  };
  async function persist(next: PhonePreferences) {
    await save(next); preferences = next; apply();
  }
  // 这里只保存本地外观；隔离页面不开放表单提交，使用普通按钮即可。
  submit.onclick = async () => {
    submit.disabled = true;
    try {
      const address = wallpaper.value.trim();
      if (address && new URL(address).protocol !== 'https:') throw new Error('壁纸请使用 HTTPS 图片地址。');
      await persist({ ...preferences, theme: theme.value, wallpaper: address }); result.textContent = '已保存';
    } catch (error) { result.textContent = error instanceof Error ? error.message : String(error); }
    finally { submit.disabled = false; }
  };
  function showHome() {
    home = true; root.hidden = true; menu.hidden = false; backButton.hidden = true; homeButton.hidden = true; title.textContent = '小手机';
  }
  function showApp(id: string) {
    home = false; root.hidden = false; menu.hidden = true; settings.hidden = true;
    backButton.hidden = false; homeButton.hidden = false;
    title.textContent = Array.from(menu.children).find(item => (item as HTMLElement).dataset.module === id)?.textContent ?? '';
  }
  async function move(from: HTMLElement, to: HTMLElement) {
    const before = Array.from(menu.children);
    const fromIndex = before.indexOf(from), toIndex = before.indexOf(to);
    if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return;
    const next = [...before]; next.splice(fromIndex, 1); next.splice(toIndex, 0, from);
    try { await persist({ ...preferences, order: next.map(item => (item as HTMLElement).dataset.module!) }); }
    catch (error) { settings.hidden = false; result.textContent = String(error); }
  }
  for (const child of menu.children) {
    const button = child as HTMLButtonElement; button.draggable = true;
    button.onclick = () => { showApp(button.dataset.module!); open(button.dataset.module!); };
    button.ondragstart = event => { dragged = button.dataset.module!; event.dataTransfer?.setData('text/plain', dragged); };
    button.ondragover = event => event.preventDefault();
    button.ondrop = event => { event.preventDefault(); const from = Array.from(menu.children).find(item => (item as HTMLElement).dataset.module === dragged); if (from) void move(from as HTMLElement, button); dragged = ''; };
    button.onkeydown = event => {
      if (!event.altKey || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
      event.preventDefault();
      const siblings = Array.from(menu.children), delta = ['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : 1;
      const target = siblings[siblings.indexOf(button) + delta]; if (target) void move(button, target as HTMLElement);
    };
  }
  apply(); showHome();
  return { showApp, showHome, get home() { return home; } };
}

export const phoneShellStyle = `
.phone-runtime{--phone-bg:#09111b;--phone-fg:#dce9f4;--phone-card:#142437;background:var(--phone-bg);color:var(--phone-fg)}
.phone-runtime[data-phone-theme=light]{--phone-bg:#f5f7fb;--phone-fg:#203550;--phone-card:#fff}
.phone-runtime button,.phone-runtime input,.phone-runtime textarea,.phone-runtime select{background:var(--phone-card);color:var(--phone-fg);border-color:#69829c}
.phone-toolbar{display:flex;align-items:center;gap:8px;position:sticky;top:0;z-index:1;background:var(--phone-bg);padding-bottom:12px}
.phone-toolbar strong{flex:1;font-size:14px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.phone-runtime #script-menu{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;align-content:start;min-height:420px;background-size:cover;background-position:center;border-radius:12px;padding:10px}
.phone-runtime #script-menu button{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;min-height:98px;font-size:13px;overflow-wrap:anywhere;background:var(--phone-card)}
.phone-icon{font-size:27px;line-height:1}
.phone-settings{display:grid;gap:10px;margin:0 0 16px}.phone-settings p{margin:0}
[hidden],.phone-runtime #script-menu[hidden]{display:none!important}
`;
