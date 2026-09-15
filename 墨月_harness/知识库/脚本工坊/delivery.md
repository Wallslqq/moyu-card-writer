---
id: delivery
kind: specialty
group: 小手机
domain: 脚本工坊
name: 外卖
requires: []
---

# 外卖

**依赖**：无

## 业务边界

菜单、购物车和配送记录用于剧情，下单交给酒馆；未核对 MVU 金额与库存映射时不擅自扣款。 可复用 ctx.phoneApp 的固定基础实现；调用 read_framework 查看当前 APP 的模板和配置。定制时保留作者已确认内容，模板不等于无需验收。

## 必测

- 空内容与长列表
- 保存、取消与重开
- 错误输入和重复操作
- 实际接收与分支切换
