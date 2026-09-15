---
id: notifications
kind: specialty
group: 小手机
domain: 脚本工坊
name: 通知
requires: [messages, tasks]
---

# 通知

**依赖**：messages、tasks

## 业务边界

读取消息与任务模块已保存的公开状态，通知自身只保存已读与关闭状态。稳定通知 ID 用来源模块加事件 ID，不能用当前时间反复生成。不存在的来源不报假通知。

## 必测

- 重复通知去重
- 标记已读后重开
- 来源为空
