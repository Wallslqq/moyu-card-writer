---
id: relations
kind: specialty
group: 玩法
domain: 脚本工坊
name: 关系档案
requires: [contacts]
---

# 关系档案

**依赖**：contacts

## 业务边界

人物使用通讯录 ID，外貌和好感来自作者指定的角色变量路径。好感区间含边界，缺失值不能当作零好感。仅显示作者已确认的档案与可见信息，不擅自加入隐藏人物剧透。

## 必测

- 阈值边界
- 人物或变量缺失
- 多人同名与长档案
