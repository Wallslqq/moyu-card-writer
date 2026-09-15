export interface Specialty {
  id: string;
  name: string;
  group: string;
  requires: string[];
  knowledge: string;
  checks: string[];
}

// 这里只保留可复用的业务边界；原卡人物、剧情、图片和私有源码不进入模型材料。
export const specialties: Specialty[] = [
  { id: 'collection', name: '成就与图鉴', group: '收藏', requires: [],
    knowledge: '按稳定 ID 管理条目、章节和解锁条件。解锁依据来自 ctx.variables()；已解锁记录放本模块状态，不修改角色变量。区分当前达成与曾经解锁。重复收到同一更新不能重复奖励。图片未提供时保留文字，不能虚构图片地址。',
    checks: ['空目录与全部解锁', '重复更新不重复解锁', '大目录分页与图片缺失'] },
  { id: 'album', name: '相册', group: '收藏', requires: ['collection'],
    knowledge: '从成就与图鉴读取解锁 ID，图片条目独立保存。未解锁项不能以原图缩略图泄露。放大查看支持关闭、键盘与窄屏。没有图片资源时直接告知作者需要图片，不生成假的链接。',
    checks: ['锁定项与已解锁项', '关闭大图与切换条目', '图片加载失败'] },
  { id: 'contacts', name: '通讯录', group: '小手机', requires: [],
    knowledge: '联系人以稳定 ID 关联消息，改名不改 ID；显示名可以重复。新增、备注、搜索和删除只操作当前工程的本模块状态。删除联系人不偷偷删除消息历史；把保留历史的行为说明给作者确认。',
    checks: ['同名联系人', '改名后消息归属', '空通讯录与搜索无结果'] },
  { id: 'notes', name: '备忘录', group: '小手机', requires: [],
    knowledge: '独立条目 ID、标题、正文、创建与修改时间。保存后再显示已保存；编辑草稿和已保存内容分开。把用户文字作为 textContent，不作为 HTML 执行。支持取消编辑、搜索、删除确认。',
    checks: ['新增编辑取消删除', '包含 HTML 的正文仅显示文字', '长文与重开保留'] },
  { id: 'messages', name: '消息与私信', group: '小手机', requires: ['contacts'],
    knowledge: '用联系人 ID 关联会话。从 ctx.phone() 读取固定格式解析后的私信；框架已按楼层和当前分支标识消息，显示随当前结果更新。ctx.compose(text) 只把草稿交给酒馆输入框，不自动向模型发请求；不能把它说成消息已发送。状态保存草稿、已读位置和显示设置。',
    checks: ['同一消息重复通知', '切换分支与改名', '空消息、长消息与待发送草稿'] },
  { id: 'forum', name: '论坛', group: '小手机', requires: ['contacts'],
    knowledge: '帖子与作者各自使用 ID。角色卡内的模拟论坛，不连接现实社交网站。新增帖子先提交草稿到 ctx.compose，生成结果从 ctx.phone().posts 读取；replies 是可选回复列表 [{id,authorId,content}]，entryId 是帖子自身 ID，id 另包含来源分支。详情保存所选帖子 ID，每次从当前结果查找；编辑时显示新正文，帖子不在当前分支时回列表。分页保留搜索条件。',
    checks: ['大量帖子分页', '详情随编辑、删除和分支变化', '草稿提交失败后内容保留'] },
  { id: 'notifications', name: '通知', group: '小手机', requires: ['messages', 'tasks'],
    knowledge: '读取消息与任务模块已保存的公开状态，通知自身只保存已读与关闭状态。稳定通知 ID 用来源模块加事件 ID，不能用当前时间反复生成。不存在的来源不报假通知。',
    checks: ['重复通知去重', '标记已读后重开', '来源为空'] },
  { id: 'custom-app', name: '自定义 APP', group: '小手机', requires: [],
    knowledge: '用途由作者决定，不限于固定类型。先确认要显示什么、能点什么、资料来源和哪些操作影响剧情。窗口、桌面、返回和保存由框架提供，当前模块只实现应用内部。可以做多页，用 ctx.navigate(page) 和 ctx.page() 沿用固定返回操作。独立记录用 ctx.state；引用已有模块必须先读取真实结构，在待确认稿 dependencies 中声明该实例 ID，不能按名称猜关联或另造一份数据。自定义聊天格式与配套世界书按当前代码一起确认；纯本地记录不强行加入世界书。',
    checks: ['新增、编辑、取消、关闭重开', '同名 APP 互不串数据与修复', '关联变化与错误输入', '正确代码不改，坏代码只修具体错误'] },
  { id: 'inventory', name: '背包', group: '玩法', requires: [],
    knowledge: '先确认物品 ID、数量、堆叠、分类、装备槽和消耗规则。角色变量是已绑定物品的唯一来源，不另造一份余额；没有变量路径时先和作者确定。ctx.changeNumbers 只做指定数值的比较并更新，不负责隐含发奖励。展示与消耗分开，操作失败保留原数量。',
    checks: ['零数量、满容量、同名物品', '重复点击消耗', '数千物品分页搜索'] },
  { id: 'tasks', name: '任务日志', group: '玩法', requires: [],
    knowledge: '任务 ID、阶段、目标、完成条件、奖励条件分别明确。已完成不等于已领取。一次领取的多个数值变化通过一次 ctx.changeNumbers 提交，失败不标记已领取。仅做展示时不添加领取或额外玩法。',
    checks: ['未接取与已完成', '重复领取与余额不足', '目标进度回退'] },
  { id: 'relations', name: '关系档案', group: '玩法', requires: ['contacts'],
    knowledge: '人物使用通讯录 ID，外貌和好感来自作者指定的角色变量路径。好感区间含边界，缺失值不能当作零好感。仅显示作者已确认的档案与可见信息，不擅自加入隐藏人物剧透。',
    checks: ['阈值边界', '人物或变量缺失', '多人同名与长档案'] },
  { id: 'levels', name: '经验与等级', group: '玩法', requires: [],
    knowledge: '确认累计经验还是本级经验、每级需求、最高等级和溢出处理。使用有上限的确定性计算，多级升级不漏级，不在渲染中增加经验。固定规则不得因模型措辞改变。',
    checks: ['恰好升级与跨多级升级', '最高等级', '零经验和大数值'] },
  { id: 'schedule', name: '日程', group: '玩法', requires: ['tasks'],
    knowledge: '故事日期与现实日期分开。使用作者定义的故事时间，不用 Date.now 推动剧情。跨天与重复日程用明确规则；提醒读取任务状态，不自动替作者完成任务。',
    checks: ['跨天与跨月', '同时发生多个事项', '没有故事时间'] },
  { id: 'shop', name: '商店与钱包', group: '经营', requires: ['inventory'],
    knowledge: '只做剧情内交易。价格、余额、库存、购买数量必须有限且非负；整笔交易一次提交所有数值变化，旧值不一致时拒绝而不是扣一半。先用 ctx.variables 获取最新值。不能接支付，也不能把模拟钱包描述为真实资金。',
    checks: ['余额不足与库存不足', '重复点击购买', '一次交易部分条件失败'] },
  { id: 'draw', name: '抽取与奖励', group: '经营', requires: ['inventory'],
    knowledge: '作者决定奖励池、权重、消耗和保底。用 ctx.draw 执行固定权重计算与保底，模型不写随机数算法。抽取后展示具体结果；写入角色变量前先确认奖励映射。单独预览产生的是测试结果。',
    checks: ['权重为零与空池', '保底边界', '消耗失败不能发奖'] },
  { id: 'gal', name: 'GAL 剧情画面', group: '叙事', requires: [],
    knowledge: '从 ctx.messages() 读取真实聊天，保留酒馆作为原始记录来源。content 是原始回复，剧情展示、分页和公开 text 先移除 <moyu_phone>...</moyu_phone> 手机数据块，只在显示副本上处理。说话人、立绘、背景、分页、回看各自分开。角色资源只使用作者提供的地址。选择按钮通过 ctx.compose 填入草稿，不能伪称已经推进剧情。此模块不是完整零层存档。',
    checks: ['长台词分页与正文回看', '立绘缺失', '重生成后展示当前分支'] },
  { id: 'scenes', name: '场景与选项', group: '叙事', requires: ['gal', 'relations'],
    knowledge: '场景以 ID 和起始楼层界定，只展示当前场景的相关历史。不要裁剪或隐藏酒馆原聊天。切换场景时清理旧界面事件；已确认的选项通过 ctx.compose 交回酒馆，条件不满足时保留原因。',
    checks: ['切换场景不串历史', '重复进入和退出', '选项条件与分支重选'] },
];

const additionalPhoneApps: [string, string, string, string[]][] = [
  ['sms', '短信', '联系人或号码关联短信，收件箱与私信分开；发送交给剧情或独立生成，不伪装成现实短信。', ['contacts']],
  ['groups', '群聊', '群 ID 与群名分开，成员用联系人 ID；每条记录标出实际发言人，退群或改名不重分配历史。', ['contacts']],
  ['calls', '电话', '通话记录、来电和拨打都是剧情玩法；确认对象后生成通话内容，不调用真实电话。', ['contacts']],
  ['feed', '动态', '作者、内容、评论、收藏分别保存，编辑或切换分支后读取当前内容，不累加旧回复。', ['contacts']],
  ['calendar', '日历', '由作者决定现实或故事日期，记录日期与事项；没有故事时间来源时不把电脑日期伪装成剧情进度。', []],
  ['clock', '时钟与计时', '固定时钟和计时器，不以计时推动剧情。离开应用后不重绘其他应用的输入框，停用清理计时器。', []],
  ['calculator', '计算器', '四则计算使用固定函数，不使用 eval；除零、清空、小数和重复等号实际测试。', []],
  ['files', '文件与资料', '资料独立编号，可搜索、查看和修改正文；它是角色卡资料夹，不声称访问玩家电脑文件。', []],
  ['weather', '天气', '展示指定故事地点和时间的天气，可按已确认世界观生成；模拟天气不是现实天气查询。', []],
  ['map', '地点与路线', '地点、路线与介绍来自作者素材或剧情生成；默认做地点导航与路线文字，不擅自连接地图服务或定位玩家。', []],
  ['browser', '剧情浏览器', '搜索角色卡内的资料和模拟网页，结果可基于当前剧情独立生成；不要伪称搜索过真实互联网。', []],
  ['wallet', '钱包', '从作者指定 MVU 数值路径读取余额，显示交易记录；不另存第二份余额，不把生成的金额当作已扣款。', []],
  ['orders', '订单', '展示订单 ID、内容和阶段。下单意向不等于支付成功，订单进度由明确的剧情输入更新。', []],
  ['delivery', '外卖', '菜单、购物车和配送记录用于剧情，下单交给酒馆；未核对 MVU 金额与库存映射时不擅自扣款。', []],
  ['secondhand', '二手交易', '商品、卖家和交易意向分开；支持查看与询价，不把意向标成已完成交易。', ['contacts']],
  ['taxi', '打车', '确认起点、终点和行程意向，接收剧情里的司机及行程进度；不接真实网约车。', []],
  ['gallery', '手机相册', '展示作者提供或手动收录的图片，支持关闭大图、收藏与删除确认，不虚构图片链接。', []],
  ['camera', '图片收录', '选择图片后保存到当前应用，允许记录标题和备注；未使用摄像头就不能说已真实拍摄。', []],
  ['music', '音乐', '有音频地址时用原生播放器真实播放，支持歌单和收藏；无音源时不显示假播放进度。', []],
  ['video', '视频', '有视频地址时用原生播放器，文字动态与实际视频区分；离开页面暂停媒体。', []],
  ['live', '直播动态', '直播主题、主播和弹幕是剧情内容；作者未提供直播源时仅展示模拟动态。', ['contacts']],
  ['movie', '电影与票券', '影片、场次和票券用于剧情，购票交给酒馆，不把剧情票券当真实凭证。', []],
];
specialties.push(...additionalPhoneApps.map(([id, name, knowledge, requires]) => ({ id, name, group: '小手机', requires,
  knowledge: knowledge + ' 可复用 ctx.phoneApp 的固定基础实现；调用 read_framework 查看当前 APP 的模板和配置。定制时保留作者已确认内容，模板不等于无需验收。',
  checks: ['空内容与长列表', '保存、取消与重开', '错误输入和重复操作', '实际接收与分支切换'] })));

export function specialty(id: string): Specialty {
  const found = specialties.find(item => item.id === id);
  if (!found) throw new Error('没有找到这个专项。');
  return found;
}

export function dependencyIds(id: string): string[] {
  const result = new Set<string>();
  const visit = (key: string) => { for (const dep of specialty(key).requires) { if (!result.has(dep)) { result.add(dep); visit(dep); } } };
  visit(id);
  return [...result];
}

// 旧模块的 ID 就是专项；新增 APP 的实例身份与专项分开，改名不换存储位置。
export const moduleKind = (module: { id: string; specialtyId?: string }): string => module.specialtyId ?? module.id;

export const publicShapes: Record<string, string> = {
  collection: '{unlocked: string[]}', album: '{items: [{id, title, url, unlocked}]}',
  contacts: '{contacts: [{id, name, note}]}', notes: '{notes: [{id, title, content, updatedAt}]}',
  messages: '{conversations: [{id, contactId, messages: [{id, content, incoming}], unread}]}',
  forum: '{posts: [{id, authorId, title, content, replies}]}', notifications: '{notifications: [{id, title, read}]}',
  inventory: '{items: [{id, name, quantity, category}]}', tasks: '{tasks: [{id, title, completed, claimed}]}',
  relations: '{people: [{contactId, name, affinity, appearance}]}', levels: '{level, experience, nextRequired}',
  schedule: '{events: [{id, title, date, completed}]}', shop: '{balance, goods: [{id, name, price, stock}]}',
  draw: '{results: [{id, rewardId}], misses}', gal: '{sceneId, speaker, text}', scenes: '{sceneId, startMessageId, choices: [{id, text}]}',
};
