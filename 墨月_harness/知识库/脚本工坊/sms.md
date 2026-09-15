---
id: sms
kind: specialty
group: 小手机
domain: 脚本工坊
name: 短信
requires: [contacts]
---

# 短信

**依赖**：contacts

## 业务边界

联系人或号码关联短信，收件箱与私信分开；发送交给剧情或独立生成，不伪装成现实短信。 可复用 ctx.phoneApp 的固定基础实现；调用 read_framework 查看当前 APP 的模板和配置。定制时保留作者已确认内容，模板不等于无需验收。

## 必测

- 空内容与长列表
- 保存、取消与重开
- 错误输入和重复操作
- 实际接收与分支切换
