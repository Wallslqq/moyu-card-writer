---
id: orders
kind: specialty
group: 小手机
domain: 脚本工坊
name: 订单
requires: []
---

# 订单

**依赖**：无

## 业务边界

展示订单 ID、内容和阶段。下单意向不等于支付成功，订单进度由明确的剧情输入更新。 可复用 ctx.phoneApp 的固定基础实现；调用 read_framework 查看当前 APP 的模板和配置。定制时保留作者已确认内容，模板不等于无需验收。

## 必测

- 空内容与长列表
- 保存、取消与重开
- 错误输入和重复操作
- 实际接收与分支切换
