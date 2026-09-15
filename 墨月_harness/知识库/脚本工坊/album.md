---
id: album
kind: specialty
group: 收藏
domain: 脚本工坊
name: 相册
requires: [collection]
---

# 相册

**依赖**：collection

## 业务边界

从成就与图鉴读取解锁 ID，图片条目独立保存。未解锁项不能以原图缩略图泄露。放大查看支持关闭、键盘与窄屏。没有图片资源时直接告知作者需要图片，不生成假的链接。

## 必测

- 锁定项与已解锁项
- 关闭大图与切换条目
- 图片加载失败
