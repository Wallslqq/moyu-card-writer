---
id: calculator
kind: specialty
group: 小手机
domain: 脚本工坊
name: 计算器
requires: []
---

# 计算器

**依赖**：无

## 业务边界

四则计算使用固定函数，不使用 eval；除零、清空、小数和重复等号实际测试。 可复用 ctx.phoneApp 的固定基础实现；调用 read_framework 查看当前 APP 的模板和配置。定制时保留作者已确认内容，模板不等于无需验收。

## 必测

- 空内容与长列表
- 保存、取消与重开
- 错误输入和重复操作
- 实际接收与分支切换
