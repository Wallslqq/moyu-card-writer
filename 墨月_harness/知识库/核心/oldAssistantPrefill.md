---
id: oldAssistantPrefill
kind: core
domain: 核心
name: assistant 预填充头部
---

# assistant 预填充头部

> 仅 assistant-prefill 路由（Gemini 3.1 Pro / DeepSeek）使用；作为 messages 末尾的 assistant 消息，
> 并从中截出 `<thinking>\n` 作为 responsePrefix。

```text
好的，我都理解了。让我先想想该怎么写……

<think>
嗯，想好了！我马上开始创作：首先进行思考，然后输出需要的内容。
</think>

现在我会以<thinking>开始思考，首先输出[metacognition]，然后输出思维链其他内容：
<thinking>

```
