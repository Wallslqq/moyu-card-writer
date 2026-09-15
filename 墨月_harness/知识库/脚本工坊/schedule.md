---
id: schedule
kind: specialty
group: 玩法
domain: 脚本工坊
name: 日程
requires: [tasks]
---

# 日程

**依赖**：tasks

## 业务边界

故事日期与现实日期分开。使用作者定义的故事时间，不用 Date.now 推动剧情。跨天与重复日程用明确规则；提醒读取任务状态，不自动替作者完成任务。

## 必测

- 跨天与跨月
- 同时发生多个事项
- 没有故事时间
