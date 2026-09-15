---
id: draw
kind: specialty
group: 经营
domain: 脚本工坊
name: 抽取与奖励
requires: [inventory]
---

# 抽取与奖励

**依赖**：inventory

## 业务边界

作者决定奖励池、权重、消耗和保底。用 ctx.draw 执行固定权重计算与保底，模型不写随机数算法。抽取后展示具体结果；写入角色变量前先确认奖励映射。单独预览产生的是测试结果。

## 必测

- 权重为零与空池
- 保底边界
- 消耗失败不能发奖
