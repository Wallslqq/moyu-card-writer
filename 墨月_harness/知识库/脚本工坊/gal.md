---
id: gal
kind: specialty
group: 叙事
domain: 脚本工坊
name: GAL 剧情画面
requires: []
---

# GAL 剧情画面

**依赖**：无

## 业务边界

从 ctx.messages() 读取真实聊天，保留酒馆作为原始记录来源。content 是原始回复，剧情展示、分页和公开 text 先移除 <moyu_phone>...</moyu_phone> 手机数据块，只在显示副本上处理。说话人、立绘、背景、分页、回看各自分开。角色资源只使用作者提供的地址。选择按钮通过 ctx.compose 填入草稿，不能伪称已经推进剧情。此模块不是完整零层存档。

## 必测

- 长台词分页与正文回看
- 立绘缺失
- 重生成后展示当前分支
