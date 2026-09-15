---
id: live
kind: specialty
group: 小手机
domain: 脚本工坊
name: 直播动态
requires: [contacts]
---

# 直播动态

**依赖**：contacts

## 业务边界

直播主题、主播和弹幕是剧情内容；作者未提供直播源时仅展示模拟动态。 可复用 ctx.phoneApp 的固定基础实现；调用 read_framework 查看当前 APP 的模板和配置。定制时保留作者已确认内容，模板不等于无需验收。

## 必测

- 空内容与长列表
- 保存、取消与重开
- 错误输入和重复操作
- 实际接收与分支切换
