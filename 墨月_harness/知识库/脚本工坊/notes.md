---
id: notes
kind: specialty
group: 小手机
domain: 脚本工坊
name: 备忘录
requires: []
---

# 备忘录

**依赖**：无

## 业务边界

独立条目 ID、标题、正文、创建与修改时间。保存后再显示已保存；编辑草稿和已保存内容分开。把用户文字作为 textContent，不作为 HTML 执行。支持取消编辑、搜索、删除确认。

## 必测

- 新增编辑取消删除
- 包含 HTML 的正文仅显示文字
- 长文与重开保留
