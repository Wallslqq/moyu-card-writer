# AGENTS.md · 墨月写卡器（通用 agent 入口）

> 这份文件是给**非 DSH** 的 agent（Claude Code / Codex / Cursor 等）看的入口。
> 如果你用的是 DSH：完整协议在 `.agents/skills/moyu-card-writer/SKILL.md`，DSH 会在驾驶员提到「墨月」时自动加载它，你不需要读这份。

本仓库是一套**用对话制作 SillyTavern 角色卡**的工作流：`墨月_harness\知识库\` 是写卡知识，`墨月_harness\工具\` 是 8 个确定性 CLI，`墨月_harness\流程\` 是设计依据。

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

## 一切经工具，不靠记忆

```powershell
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

## 许可

GPL-3.0-only。原作者：三明月。改动清单见 `署名与来源.md`。
