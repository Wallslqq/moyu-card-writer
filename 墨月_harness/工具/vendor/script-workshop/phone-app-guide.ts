import { specialties, specialty } from './catalog.ts';

export function phoneAppSource(kind: string, title = specialty(kind).name): string {
  if (!specialties.some(item => item.id === kind && item.group === '小手机') || kind === 'custom-app') throw new Error('这个专项没有固定手机基础版本。');
  return 'return ctx.phoneApp(' + JSON.stringify(kind) + ', ' + JSON.stringify({ title, items: [] }, null, 2) + ');';
}

export const phoneAppGuide = `固定手机提供桌面、图标、返回、收起、外观与独立 APP 状态。自定义 APP 可以有多个，ctx.id 是实例身份，不是名称。
ctx.phoneApp(kind, config) 返回具有 render/dispose/expose 的标准应用。可直接 return ctx.phoneApp("notes", {title:"手账",items:[]})；kind 用当前专项 ID。自定义 APP 可以复用其中确实适用的基础，也可自行 return {render(root){...}}，不强制所有玩法套列表。
config: {title?, items?:[{id,title,content,url?,date?,price?,...}], balancePath?:string[], storyTimePath?:string[], prompt?:string}。
items 是作者确认的初始资料。通讯录可用 name/note 或 title/content；ID 保持稳定。钱包 balancePath 与日历 storyTimePath 使用真实角色变量路径。素材地址仅用作者提供的 HTTPS 地址或收录图片；prompt 只写当前 APP 独立生成的玩法，不填密钥。
固定基础含：通讯录记录与拉黑；私信/短信草稿、已读与内容接收；群聊名称和成员编辑；模拟通话开始与结束；论坛评论显示、回复草稿与关注；资料的新增、编辑、取消、搜索、分页、收藏与删除确认；外卖/二手/票券购物车与订单意向；消息和已完成任务通知；图片收录；音视频原生播放；时钟、计时与四则计算；剧情应用内容生成与动作草稿。
购物/订单等基础版本只提交剧情意向，不伪装成已经扣款成交；作者需要直接数值交易时应读取现有商店/背包模块的真实映射，不能靠生成的条目金额扣钱。
固定基础的列表数据可从 <moyu_phone>{"apps":{"当前APP实例ID":{"items":[{"id":"稳定条目ID","title":"名称","content":"正文"}]}}}</moyu_phone> 接收；已有私信 messages、帖子 posts 继续支持。自定义 APP 不用固定基础时，其 apps 数据内部结构由当前代码决定。
ctx.page() 返回本 APP 当前页面数据（初始 null），await ctx.navigate({view:"detail",id:"..."}) 进入详情；固定“返回”会退回上一页，await ctx.navigate(null) 回应用首页。也可用模块自己的详情状态，但要提供返回按钮。
await ctx.generate(text, context?) 在酒馆里使用已配置模型完成当前 APP 内容生成，返回原始文本；只在玩家明确操作时调用。解析成功后再写入状态，错误保留原内容，按钮调用 await ctx.cancelGeneration() 可停止当前 APP。独立生成返回什么由 text 写清，配套世界书按当前 APP 的实际结构编写。预览不伪造模型结果。
修复先区分：作者模块实现、配套条目、固定框架或酒馆连接。固定框架不是模型的编辑目标；发现固定部分错误应给出复现证据。正常内容不改。`;
