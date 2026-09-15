---
id: mvu_statusbar_native_build
kind: task
group: MVU
domain: 状态栏
name: 🪶_MVU-原生状态栏创作
has_contract: true
---

# 🪶_MVU-原生状态栏创作

## 合同（本轮唯一执行依据）

<workshop_task id="mvu_statusbar_native_build">
  <mission>只把已经复核完成且指定“原生HTML”路线的MVU状态栏创作合同填入固定原生骨架，一次生成可由酒馆助手消息iframe直接渲染的完整只读HTML。</mission>
  <knowledge>本轮只调用并执行名为 knowledge_mvu_statusbar_native_build 的知识标签。固定骨架已经提供运行边界、MVU读取、刷新、安全绑定和失败处理；不得重新设计运行架构。</knowledge>
  <artifact>最终只交付一个完整html代码块；除合同要求的静态DOM、data-mvu绑定、固定资源与CSS外，不生成自定义业务JavaScript。</artifact>
  <units>核验唯一合同与路线；核对原生路线适用性；建立显示项与data属性的一一映射；填充静态DOM；填充CSS；核对资源与响应式；复制固定运行骨架；执行闭合与安全检查。</units>
  <boundaries>不得聊天、追问、补需求、改路线或修改合同；不得使用Vue、import、CDN脚本、npm、TypeScript、构建工具、innerHTML、动态HTML、onclick等事件属性、变量写入、正则或多文件；不得声明已经运行、编译或视觉验收。</boundaries>
  <validation>合同中的每个字段只绑定一次且路径完全一致；只使用固定data-mvu-path与data-mvu-progress机制；动态文本只进入textContent；HTML/CSS/JS完整闭合；无占位符、伪代码和未提供资源。</validation>
  <stop>首次生成需要完整且适合原生路线的合同。修复已有成品时，以当前完整代码、已确认要求和具体错误为依据，保留未受影响的功能与样式，交付修正后的完整HTML；只在修复确实涉及尚未决定的需求时请作者确认。</stop>
</workshop_task>

## 知识

<knowledge_mvu_statusbar_native_build>
# MVU专项：原生状态栏创作

## 一、这里不是代码环境

你当前不处于IDE、Node、Vite、Webpack或本地工程环境中。你不能创建多个文件、安装依赖、执行构建、运行类型检查、读取控制台结果或进行视觉验收。唯一允许交付的是一份由酒馆助手消息iframe直接渲染的完整HTML。

首次生成使用完整`<MVU状态栏创作合同>`，且必须同时满足：

- `技术路线：原生HTML`。
- 每个显示项都有精确`stat_data.`路径、数据形态、缺省表现和呈现方式。
- 不含动态映射、动态列表、标签页状态、多角色切换或需要自定义JavaScript的行为。
- 所有头像、立绘、背景和其他网络资源都有合同确认的真实`https://`地址。

任一条件不满足时停止，只指出当前状态栏合同最先缺少或冲突的一项。作者继续留在当前页面补齐即可；不得要求跳转到其他任务，也不得用猜测补齐。

## 二、原生路线允许的界面

只允许固定数量的文本、数值、真假、枚举、简单进度、固定分组和原生`details/summary`折叠。所有内容只读；交互只改变HTML自身展开状态，不写变量、不请求生成、不操作酒馆。

普通字段在目标文字元素上同时使用`data-mvu-path="stat_data.完整.路径"`与`data-fallback="缺省文字"`。真假字段还可以使用合同确认的`data-true-text`和`data-false-text`。

有真实最小值和最大值的数值才使用进度。进度容器必须同时具有`data-mvu-progress`、`data-min`、`data-max`和`data-fallback`，内部必须各有一个`data-progress-value`数值节点和`data-progress-fill`填充节点；不得自创第二套进度结构。

路径是完整MVU读取路径，必须以`stat_data.`开头。模型不得另写DOM查询和字段赋值代码。

## 三、资源与文本安全

- 头像、立绘、背景和其他图片只使用合同中的真实`https://`URL；不得调用或猜测酒馆头像接口。
- 变量值不得进入`innerHTML`、HTML模板、CSS文本、`src`、`href`或事件属性。
- 变量文本只能由固定骨架写入`textContent`。
- 图片必须有准确`alt`；装饰图使用空`alt`并禁止点击。
- 网络资源失败时必须有合同指定的纯CSS或文字降级，不出现破图占位。

## 四、固定HTML骨架

必须完整复制下列结构，只替换两个指定区域：

1. `@qk-slot | 合同CSS`：写入合同要求的样式，可以调整`.status-shell`及其子元素，但保留基础布局安全规则。
2. `@qk-slot | 合同DOM`：写入静态DOM、`data-mvu-path`与`data-mvu-progress`绑定。

首次生成沿用固定JavaScript。修复已有成品时，可以调整错误直接涉及的初始化、刷新或绑定处理；继续保留当前楼层读取、只读MVU和安全文本显示的边界，不要求作者重新整理全部需求。

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
    [hidden] { display: none !important; }
    .status-shell { position: relative; width: 100%; max-width: 100%; }
    .status-progress-track { display: block; overflow: hidden; width: 100%; }
    [data-progress-fill] { display: block; width: 0; max-width: 100%; transition: width 180ms ease; }
    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after { scroll-behavior: auto !important; transition-duration: 0.01ms !important; animation-duration: 0.01ms !important; }
    }

    /* @qk-slot | 合同CSS：在这里生成，完成后不得保留说明性占位内容 */
  </style>
</head>
<body>
  <section class="status-shell" aria-label="状态栏">
    <div data-state="loading" role="status">正在读取状态……</div>
    <div data-state="empty" role="status" hidden>状态尚未初始化。</div>
    <div data-state="error" role="alert" hidden>状态读取失败。</div>
    <div data-state="content" hidden>
      <!-- @qk-slot | 合同DOM：在这里生成，完成后不得保留说明性占位内容 -->
    </div>
  </section>

  <script type="module">
    const root = document.querySelector('.status-shell');
    const stateNodes = Object.fromEntries(
      [...root.querySelectorAll('[data-state]')].map(node => [node.dataset.state, node]),
    );

    function showState(name, message) {
      Object.values(stateNodes).forEach(node => { node.hidden = true; });
      const active = stateNodes[name];
      if (!active) return;
      if (message && name !== 'content') active.textContent = message;
      active.hidden = false;
    }

    function asText(value, fallback) {
      if (value === undefined || value === null || value === '') return fallback;
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
      return fallback;
    }

    function renderTextFields(mvuData) {
      root.querySelectorAll('[data-mvu-path]').forEach(node => {
        const value = _.get(mvuData, node.dataset.mvuPath);
        const fallback = node.dataset.fallback || '未确认';
        if (typeof value === 'boolean') {
          node.textContent = value ? (node.dataset.trueText || '是') : (node.dataset.falseText || '否');
          return;
        }
        node.textContent = asText(value, fallback);
      });
    }

    function renderProgressFields(mvuData) {
      root.querySelectorAll('[data-mvu-progress]').forEach(node => {
        const raw = Number(_.get(mvuData, node.dataset.mvuProgress));
        const minimum = Number(node.dataset.min);
        const maximum = Number(node.dataset.max);
        const fallback = node.dataset.fallback || '未确认';
        const valueNode = node.querySelector('[data-progress-value]');
        const fillNode = node.querySelector('[data-progress-fill]');
        const valid = Number.isFinite(raw) && Number.isFinite(minimum) && Number.isFinite(maximum) && maximum > minimum;
        if (!valid) {
          if (valueNode) valueNode.textContent = fallback;
          if (fillNode) fillNode.style.width = '0%';
          return;
        }
        const percentage = Math.min(100, Math.max(0, ((raw - minimum) / (maximum - minimum)) * 100));
        if (valueNode) valueNode.textContent = String(raw);
        if (fillNode) fillNode.style.width = `${percentage}%`;
      });
    }

    function refresh() {
      try {
        const mvuData = Mvu.getMvuData({ type: 'message', message_id: getCurrentMessageId() });
        if (!mvuData || !_.has(mvuData, 'stat_data')) {
          showState('empty');
          return;
        }
        renderTextFields(mvuData);
        renderProgressFields(mvuData);
        showState('content');
      } catch (error) {
        console.error('[MVU状态栏] 读取失败', error);
        showState('error');
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
        showState('error', '状态栏初始化失败。');
      }
    }

    void init();
  </script>
</body>
</html>
```

## 五、生成纪律

最终只输出填充完成后的一份完整 HTML。不得把骨架拆成多段，不得在源码中途解释，不得留下 `@qk-slot` 说明、TODO、省略号、示例字段或第二套样式。完成与否由 HTML 外壳、脚本语法、MVU 读取与合同要求检查判断。

完成前逐项核对：合同显示项全部存在；每个`data-mvu-*`路径逐字对应合同；进度有真实范围；DOM与CSS闭合；当前楼层读取与只读边界保留；没有动态集合、Vue、额外业务功能、危险HTML、外部本地文件、正则和未提供URL；窄屏无横向滚动，主体未脱离文档流。

代码块外只说明网页将等待作者确认并写入状态栏代码区；不得声称已经在酒馆运行或视觉验收。完成后停止。
完整 HTML 闭合后停止；网页等待作者确认后写入状态栏代码区并提供本地预览。
</knowledge_mvu_statusbar_native_build>

