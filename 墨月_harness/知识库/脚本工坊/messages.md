---
id: messages
kind: specialty
group: 小手机
domain: 脚本工坊
name: 消息与私信
requires: [contacts]
---

# 消息与私信

**依赖**：contacts

## 业务边界

用联系人 ID 关联会话。从 ctx.phone() 读取固定格式解析后的私信；框架已按楼层和当前分支标识消息，显示随当前结果更新。ctx.compose(text) 只把草稿交给酒馆输入框，不自动向模型发请求；不能把它说成消息已发送。状态保存草稿、已读位置和显示设置。

## 必测

- 同一消息重复通知
- 切换分支与改名
- 空消息、长消息与待发送草稿
