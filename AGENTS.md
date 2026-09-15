# AGENTS.md · 墨月写卡器（通用 agent 入口）

> 这份文件是给**非 DSH** 的 agent（Claude Code / Codex / Cursor 等）看的入口。
> 如果你用的是 DSH：完整协议在 `.agents/skills/moyu-card-writer/SKILL.md`，DSH 会在驾驶员提到「墨月」时自动加载它，你不需要读这份。

本仓库是一套**用对话制作 SillyTavern 角色卡**的工作流：`墨月_harness\知识库\` 是写卡知识，`墨月_harness\工具\` 是 13 个确定性 CLI，`墨月_harness\流程\` 是设计依据。

## 动手之前必须完整读一遍

`墨月_harness\流程\交互层.md`（一轮怎么走）与 `墨月_harness\流程\交付闸门.md`（什么时候能出成品）。
如果运行环境支持 skill，请优先完整读取 `.agents/skills/moyu-card-writer/SKILL.md` —— 那是这套东西的可执行版协议，含逐条命令。

## 六条不可违反的规则

1. **出片必经作者确认。** `pack --prepare` 只是放进待确认区，作品内容此时**尚未改变**。必须真正向作者提问并停下等待。
2. **分流看装配器算出的 `permission`（answer／artifact／self-check），不凭感觉。**
3. **每轮只处理一个会改变结果的决定**；需求类专项每轮只问一个问题。
4. **不自己实现上下文压缩**（那是 harness 的职责）。
5. **子代理只交文件**，成品正文不回流到主上下文。
6. **本地静态检查 ≠ 在酒馆运行通过**，汇报时必须区分。

## 开卡：先谈定全局，再动笔

**开卡不是"直接开始写人物"。** 全程由 `card\<卡名>\` 下的两份档案驱动：

- **`_规划.md`（事实源）** —— 这张卡要长什么样。只记决策，不写正文。
  **任何修改必须先改它，再改正文条目。** 未定项写 `[待细化]`，遇到必须先问作者。
- **`_进度.md`（进程）** —— 做到哪了、下一步能干什么。每轮先读，**不许凭对话记忆推进**。

开卡顺序：建档案 → **问作者对齐模式**（粗略规划／一次确认）→ 补 `_规划.md` → **请作者确认规划** →
建作品工程 → 逐人建空壳 → 逐模块推进。**规划未确认前，工具会拒绝写任何正文条目。**

## 一切经工具，不靠记忆

```powershell
# 开卡档案（每轮先跑 --stat）
node "墨月_harness\工具\material.mjs" --init --card "<卡名>"
node "墨月_harness\工具\material.mjs" --plan --card "<卡名>" --mode rough|full --confirmed
node "墨月_harness\工具\material.mjs" --stat --card "<卡名>"          # 位置 + 下一步 + 写作质量粗筛
node "墨月_harness\工具\material.mjs" --mark --card "<卡名>" --item "<人物名>" --area <栏位id> [--action done|skip|undo]
node "墨月_harness\工具\material.mjs" --blueprint --card "<卡名>"     # 世界书蓝图确认
node "墨月_harness\工具\material.mjs" --worldbook --card "<卡名>" --entry "<条目名>" [--done]

# 建人物空壳（新工程必做，否则人物写不进去）
node "墨月_harness\工具\character.mjs" --add --project "<作品.json>" --name "<人物名>"

# 现状与下一步
node "墨月_harness\工具\status.mjs" --project "墨月_harness\状态\作品\卡名.json"
# 路由（专项由装配器决定，不要自己挑）
node "墨月_harness\工具\prompt.mjs" --project "<作品.json>" --domain <域> --input "作者原话" --route-only
# 装配成完整请求（落盘给执行者读）
node "墨月_harness\工具\prompt.mjs" --project "<作品.json>" --domain <域> --input "作者原话" --out-md "<请求.md>" --thread
# 闸门
node "墨月_harness\工具\check.mjs" <专项> --file "<成品.md>" --project "<作品.json>"
# 待确认 → 作者确认 → 写入
node "墨月_harness\工具\pack.mjs" --prepare --project "<作品.json>" --file "<成品.md>" --task <专项>
node "墨月_harness\工具\pack.mjs" --apply --id <稿号> --project "<作品.json>"
```

**只有 `pack --apply` 能修改作品工程。** 不要手改 `状态\作品\*.json`。
（唯一例外是 `new-project.mjs` 与 `character.mjs`：它们只建**空壳记录**，不写任何正文。）

## 文字质量的两道防线

结构合不合规由 `check.mjs` 判；文字好不好由这两道管：

1. **创作前自检**（你本人）：写每一栏之前按 `墨月_harness\知识库\核心\_写作质量自检.md` 逐项预演。
   先跑 `material.mjs --audit --card "<卡名>"` 能提前抓掉破折号、烂词这类机械问题。
2. **落盘后审稿**（子代理，独立上下文）：模块闭合时按同一份清单扫一遍。

**审稿子代理只做减法与改写，不许要求新增事实**；缺信息只能写"需作者补充"。

## 批处理：整组准备由**你本人**执行

实测教训：批处理子代理**即使在指令里明文禁止**，仍可能执行 `pack --apply`，把稿子真写进作品
（而 `confirmed` 无法回滚）。所以整组准备（`pack --prepare-batch`）**只由编排者自己跑**，
子代理只出稿 + 自校验。

## 许可

GPL-3.0-only。原作者：三明月。改动清单与借用的结构设计见 `署名与来源.md`。
