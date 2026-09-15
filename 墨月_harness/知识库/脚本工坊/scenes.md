---
id: scenes
kind: specialty
group: 叙事
domain: 脚本工坊
name: 场景与选项
requires: [gal, relations]
---

# 场景与选项

**依赖**：gal、relations

## 业务边界

场景以 ID 和起始楼层界定，只展示当前场景的相关历史。不要裁剪或隐藏酒馆原聊天。切换场景时清理旧界面事件；已确认的选项通过 ctx.compose 交回酒馆，条件不满足时保留原因。

## 必测

- 切换场景不串历史
- 重复进入和退出
- 选项条件与分支重选
