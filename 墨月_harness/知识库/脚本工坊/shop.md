---
id: shop
kind: specialty
group: 经营
domain: 脚本工坊
name: 商店与钱包
requires: [inventory]
---

# 商店与钱包

**依赖**：inventory

## 业务边界

只做剧情内交易。价格、余额、库存、购买数量必须有限且非负；整笔交易一次提交所有数值变化，旧值不一致时拒绝而不是扣一半。先用 ctx.variables 获取最新值。不能接支付，也不能把模拟钱包描述为真实资金。

## 必测

- 余额不足与库存不足
- 重复点击购买
- 一次交易部分条件失败
