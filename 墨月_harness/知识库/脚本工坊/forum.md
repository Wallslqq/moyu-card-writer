---
id: forum
kind: specialty
group: 小手机
domain: 脚本工坊
name: 论坛
requires: [contacts]
---

# 论坛

**依赖**：contacts

## 业务边界

帖子与作者各自使用 ID。角色卡内的模拟论坛，不连接现实社交网站。新增帖子先提交草稿到 ctx.compose，生成结果从 ctx.phone().posts 读取；replies 是可选回复列表 [{id,authorId,content}]，entryId 是帖子自身 ID，id 另包含来源分支。详情保存所选帖子 ID，每次从当前结果查找；编辑时显示新正文，帖子不在当前分支时回列表。分页保留搜索条件。

## 必测

- 大量帖子分页
- 详情随编辑、删除和分支变化
- 草稿提交失败后内容保留
