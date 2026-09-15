---
id: mvu_statusbar_vue_build
kind: task
group: MVU
domain: 状态栏
name: 🧩_MVU-Vue状态栏创作
has_contract: true
---

# 🧩_MVU-Vue状态栏创作

## 合同（本轮唯一执行依据）

<workshop_task id="mvu_statusbar_vue_build">
  <mission>只把已经复核完成且指定“单HTML Vue”路线的MVU状态栏创作合同填入固定Vue骨架，一次生成可由酒馆助手消息iframe直接渲染的完整只读HTML。</mission>
  <knowledge>本轮只调用并执行名为 knowledge_mvu_statusbar_vue_build 的知识标签。Vue运行时、挂载、MVU读取、刷新、安全读取与错误处理均由固定骨架提供；不得生成Vue工程或重新设计运行架构。</knowledge>
  <artifact>最终只交付一个完整html代码块；只在指定区域生成合同CSS、Vue模板和必要的本地界面状态，不生成其他文件、依赖、正则或安装配置。</artifact>
  <units>核验唯一合同与路线；建立显示项与安全读取函数映射；确定最小本地界面状态；填充Vue模板；填充CSS；核对资源与响应式；复制固定运行骨架；执行闭合、指令与安全检查。</units>
  <boundaries>不得聊天、追问、补需求、改路线或修改合同；不得使用.vue、script setup、TypeScript、import、CDN、Pinia、Router、npm、构建工具、v-html、innerHTML、Vue双花括号插值、变量写入、正则或多文件；不得声明已经运行、编译或视觉验收。</boundaries>
  <validation>所有变量读取均通过固定安全函数且使用完整stat_data路径；动态列表和对象有稳定key与空态；动态文本只使用v-text；本地交互不写回MVU；HTML/CSS/JS与Vue指令完整闭合；无占位符、伪代码和未提供资源。</validation>
  <stop>首次生成需要完整且适合Vue路线的合同。修复已有成品时，以当前完整代码、已确认要求和具体错误为依据，保留未受影响的功能与样式，交付修正后的完整HTML；只在修复确实涉及尚未决定的需求时请作者确认。</stop>
</workshop_task>

## 知识

<knowledge_mvu_statusbar_vue_build>
# MVU专项：Vue状态栏创作

## 一、这里不是Vue工程

你当前不处于IDE、Node、Vite、Webpack或本地工程环境中。你不能创建`.vue`文件、安装依赖、执行构建、运行类型检查、读取控制台结果或进行视觉验收。唯一允许交付的是一份由酒馆助手消息iframe直接渲染的完整HTML。

酒馆助手的默认 Vue 是 runtime-only 版本，不能编译本骨架的 DOM 模板。墨月会在状态栏预览和最终角色卡／正则导出时统一附带项目内置的完整版 Vue，不依赖酒馆默认 Vue 或外部 CDN。你只填写下方骨架，不要重复粘贴库源码。未经墨月导出处理的编辑区源码不能当作已经包含该依赖的独立文件。本条目不使用：

- `<script setup>`、单文件组件和TypeScript。
- `import`、外部Vue CDN、Pinia、Vue Router或构建产物。
- Vue的双花括号插值；它可能与酒馆宏混淆。
- `v-html`、`innerHTML`和任何把变量内容解释成HTML的路径。

首次生成的输入是完整`<MVU状态栏创作合同>`，且`技术路线：单HTML Vue`。缺少实际影响生成的决定时，在当前页面说明需要确认的内容。修复已有代码时，读取当前代码和相关MVU文件，先区分预览环境故障与作品代码错误，再按已确认的功能做局部修正；不要求作者重新走完整需求讨论。

## 二、固定数据能力

`waitGlobalInitialized('Mvu')` 是酒馆助手支持的前端 iframe 接口，不是仅供后台脚本使用。若报未定义，应核对成品是否由酒馆助手渲染、助手是否正常加载及版本，不能据此改成任意父窗口读取或删掉等待。Vue 不可用、模板编译器缺失与 MVU 未初始化是不同问题，须按实际错误分别检查。

固定骨架保存整份当前楼层MVU数据。模板只能使用以下安全函数：

- `textAt('stat_data.路径', '缺省文字')`：读取并显示文本、数值或真假；对象和列表不会被转成`[object Object]`。
- `numberAt('stat_data.路径', 0)`：读取有限数值。
- `percentAt('stat_data.路径', 最小值, 最大值)`：只在合同有真实范围时计算0至100。
- `listAt('stat_data.路径')`：只有真实数组才返回项目，否则返回空数组。
- `entriesAt('stat_data.路径')`：只有真实非数组对象才返回`[键, 值]`列表，否则返回空列表。
- `itemText(项目, '子路径', '缺省文字')`：安全读取动态项目中的文字、数值或真假。

所有路径必须逐字来自合同并带`stat_data.`。模板不得直接访问未列入合同的字段，不自行创建变量路径。

## 三、Vue模板限制

- 动态文字只用`v-text`。
- 动态集合使用`v-for`并提供稳定`:key`；动态映射默认使用真实键，列表使用合同中真实唯一键。没有唯一键时可以使用索引，但合同必须允许顺序稳定且项目不在界面内编辑。
- 条件显示使用`v-if`、`v-else-if`、`v-else`或`v-show`，条件必须来自合同。
- 本地标签页、选中角色和折叠状态存入固定`ui`对象，只服务当前iframe显示，不写回MVU。
- 点击行为只允许直接修改`ui`中的既有键。不得调用生成、变量写入、酒馆命令、网络请求或父页面DOM。
- 动态图片URL禁止。头像、立绘、背景和其他图片只使用合同提供的真实`https://`URL，作为静态`src`或CSS URL；不得调用或猜测酒馆头像接口。

## 四、固定HTML Vue骨架

必须完整复制下列结构，只替换三个指定区域：

1. `@qk-slot | 合同CSS`：生成合同样式并保留基础iframe规则。
2. `@qk-slot | 合同Vue模板`：生成ready状态下的模板，只使用固定安全函数与`ui`。
3. `@qk-slot | 本地界面状态`：只写合同确认的选中项、标签页和折叠初值；没有则保持空对象。

首次生成沿用固定JavaScript。修复已有成品时，可以调整错误直接涉及的初始化、刷新或界面状态处理；继续保留当前楼层读取、只读MVU和安全文本显示的边界。

```html
<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    html, body { width: 100%; margin: 0; padding: 0; }
    body { overflow-x: hidden; background: transparent; }
    [v-cloak] { display: none !important; }
    .status-shell { position: relative; width: 100%; max-width: 100%; }
    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after { scroll-behavior: auto !important; transition-duration: 0.01ms !important; animation-duration: 0.01ms !important; }
    }

    /* @qk-slot | 合同CSS：在这里生成，完成后不得保留说明性占位内容 */
  </style>
</head>
<body>
  <div id="app" v-cloak>
    <section class="status-shell" aria-label="状态栏">
      <div v-if="phase === 'loading'" role="status" v-text="statusMessage"></div>
      <div v-else-if="phase === 'empty'" role="status" v-text="statusMessage"></div>
      <div v-else-if="phase === 'error'" role="alert" v-text="statusMessage"></div>
      <div v-else>
        <!-- @qk-slot | 合同Vue模板：在这里生成，完成后不得保留说明性占位内容 -->
      </div>
    </section>
  </div>

  <script type="module">
    const { createApp, onMounted, reactive, ref } = Vue;

    const app = createApp({
      setup() {
        const phase = ref('loading');
        const statusMessage = ref('正在读取状态……');
        const mvuData = ref({});
        const ui = reactive({
          /* @qk-slot | 本地界面状态：只填写合同确认的简单初值；没有则保持空对象 */
        });

        function asText(value, fallback) {
          if (value === undefined || value === null || value === '') return fallback;
          if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
          return fallback;
        }

        function textAt(path, fallback = '未确认') {
          return asText(_.get(mvuData.value, path), fallback);
        }

        function numberAt(path, fallback = 0) {
          const value = Number(_.get(mvuData.value, path));
          return Number.isFinite(value) ? value : fallback;
        }

        function percentAt(path, minimum, maximum) {
          const value = numberAt(path, minimum);
          if (!Number.isFinite(minimum) || !Number.isFinite(maximum) || maximum <= minimum) return 0;
          return Math.min(100, Math.max(0, ((value - minimum) / (maximum - minimum)) * 100));
        }

        function listAt(path) {
          const value = _.get(mvuData.value, path);
          return Array.isArray(value) ? value : [];
        }

        function entriesAt(path) {
          const value = _.get(mvuData.value, path);
          return value && typeof value === 'object' && !Array.isArray(value) ? Object.entries(value) : [];
        }

        function itemText(item, path = '', fallback = '未确认') {
          const value = path ? _.get(item, path) : item;
          return asText(value, fallback);
        }

        function refresh() {
          try {
            const next = Mvu.getMvuData({ type: 'message', message_id: getCurrentMessageId() });
            if (!next || !_.has(next, 'stat_data')) {
              mvuData.value = {};
              statusMessage.value = '状态尚未初始化。';
              phase.value = 'empty';
              return;
            }
            mvuData.value = next;
            phase.value = 'ready';
          } catch (error) {
            console.error('[MVU状态栏] 读取失败', error);
            statusMessage.value = '状态读取失败。';
            phase.value = 'error';
          }
        }

        async function init() {
          try {
            await waitGlobalInitialized('Mvu');
            eventOn(Mvu.events.VARIABLE_INITIALIZED, refresh);
            eventOn(Mvu.events.VARIABLE_UPDATE_ENDED, refresh);
            refresh();
          } catch (error) {
            console.error('[MVU状态栏] 初始化失败', error);
            statusMessage.value = '状态栏初始化失败。';
            phase.value = 'error';
          }
        }

        onMounted(() => { void init(); });

        return { phase, statusMessage, ui, textAt, numberAt, percentAt, listAt, entriesAt, itemText };
      },
    });

    app.config.errorHandler = error => {
      console.error('[MVU状态栏] Vue渲染失败', error);
      const root = document.querySelector('#app');
      if (root) {
        root.removeAttribute('v-cloak');
        root.textContent = '状态栏渲染失败。';
      }
    };

    app.mount('#app');
  </script>
</body>
</html>
```

## 五、生成纪律

最终只输出填充完成后的一份完整 HTML。不得把骨架拆成多段，不得在源码中途解释，不得留下 `@qk-slot` 说明、TODO、省略号、示例字段或第二套样式。完成与否由 HTML 外壳、脚本语法、MVU 读取与合同要求检查判断。

完成前逐项核对：合同显示项全部存在；所有路径逐字对应合同并带`stat_data.`；动态集合与空态一致；所有动态文字使用`v-text`；不存在双花括号插值、`v-html`、动态HTML和动态URL；`ui`只包含确认的本地状态；当前楼层读取与只读边界保留；Vue指令、HTML、CSS、JS括号和引号闭合；无外部Vue依赖、本地文件、正则与未提供资源；窄屏无横向滚动，主体未脱离文档流。

代码块外只说明网页将等待作者确认并写入状态栏代码区；不得声称已经在酒馆运行、编译或视觉验收。完成后停止。
完整 HTML 闭合后停止；网页等待作者确认后写入状态栏代码区并提供本地预览。
</knowledge_mvu_statusbar_vue_build>

