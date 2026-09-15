---
id: calls
kind: specialty
group: 小手机
domain: 脚本工坊
name: 电话
requires: [contacts]
---

# 电话

**依赖**：contacts

## 业务边界

通话记录、来电和拨打都是剧情玩法；确认对象后生成通话内容，不调用真实电话。 可复用 ctx.phoneApp 的固定基础实现；调用 read_framework 查看当前 APP 的模板和配置。定制时保留作者已确认内容，模板不等于无需验收。

## 必测

- 空内容与长列表
- 保存、取消与重开
- 错误输入和重复操作
- 实际接收与分支切换
