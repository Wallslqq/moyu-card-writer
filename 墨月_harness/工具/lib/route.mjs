/**
 * 专项路由 —— 逐字移植墨月 `page-assistant.ts` 的 resolvePageTask() / resolveConversationTask()，
 * 以及 `agent-run.ts` 的 requestsArtifact() 与 AssistantPanel 的 artifactIntent 汇总条件。
 *
 * 与墨月的唯一差异：intent 允许由作者显式声明（显式优先），未声明时才走正则推断。
 */

const BATCH_SECTIONS = new Set(['worldbook', 'mvu']);
const PURE_OUTPUT_TASKS = new Set([
  'mvu_initvar_formatting', 'mvu_update_rule_formatting',
  'mvu_statusbar_native_build', 'mvu_statusbar_vue_build', 'frontend_build', 'ejs_build',
]);

export function isPureOutputTask(taskId) { return PURE_OUTPUT_TASKS.has(taskId); }

export function isStatusbarPlanningFocus(focus) {
  return focus.area === 'requirements' || focus.area === 'contract';
}

export function requestsStatusbarRevision(input) {
  return /(?:修改|调整|补充|重做|改写|更新).{0,12}(?:需求|生成依据|合同|方案)|(?:需求|生成依据|合同|方案).{0,12}(?:修改|调整|补充|重做|改写|更新)/i.test(input);
}

/** 等价 requestsArtifact()：否定分句剔除 + 疑问句开头排除 + 五条肯定模式。 */
export function requestsArtifact(input) {
  const value = input.trim().split(/[，。！？；,!?;\n]/)
    .filter((clause) => !/(?:不要|别|不用|不必|无需|暂不|先不|不需要).{0,12}(?:生成|输出|制作|写入|写回|写代码|成品|工件)/.test(clause))
    .join('，');
  if (/^(?:为什么|为何|怎么(?:还|又|会|不能|无法)|哪里|哪儿).{0,24}(?:生成|写入|写回|输出|制作|成品)/.test(value)) return false;
  return [
    /(?:请|麻烦|帮我|给我|替我|我要|我需要|现在|直接|开始|继续|重新).{0,24}(?:写入|写回|准备写入|写一份|写出来|写好|生成|输出|制作|整理成|整理为|改成|编译|完成这部分|建立待确认|准备工件)/,
    /把.+(?:写入|写回|整理成|整理为|改成|制作成|生成为|输出为)/,
    /按.+(?:生成|制作|写入|写回|整理成|整理为|编译)/,
    /(?:建立|准备|放入).{0,10}(?:待确认|工件|成品)/,
    /^(?:重新)?(?:写入|写回|准备写入|写一份|生成|输出|制作|整理成|整理为|编译|完成这部分)/,
  ].some((pattern) => pattern.test(value));
}

/** 等价 resolvePageTask()。返回专项 id 或 undefined。 */
export function resolvePageTask(section, project, focus, userInput, artifactIntent = false, preferredTaskId = '') {
  const input = userInput.toLowerCase();

  // 等价墨月 `sectionTaskFilter`：overview / package / carddata 三页的专项列表都只有 free_creation，
  // 而 resolvePageTask 对未匹配的 section 兜底 `tasks[0]` —— 因此这三页实际都路由到自由创作助手。
  // （能否出成品是另一条规则：artifactIntent 对 overview / package 恒为假，见 resolveDelivery。）
  if (section === 'overview' || section === 'package' || section === 'carddata') return 'free_creation';

  if (section === 'character') {
    if (/\b(?:npc)\b|配角|路人|临时人物/i.test(input)) return 'npc_light_habitat';
    if (/实测|测试正文|跑卡|演绎结果|角色反应|问题分析/.test(input)) return 'airp_test_diagnosis_router';
    if (!project.characters.length || /零散|没想好|不知道.*(?:模块|怎么写)|整理.*想法|分流/.test(input)) return 'airp_intake_router';
    const areaTask = {
      basicInformation: 'airp_basic_information',
      lifeStructure: 'airp_life_structure',
      characterNature: 'airp_character_nature',
      sceneExpression: 'airp_scene_expression',
      clothingStyle: 'airp_clothing_style',
      notes: 'airp_test_diagnosis_router',
    };
    return areaTask[focus.area ?? ''] ?? 'airp_basic_information';
  }

  if (section === 'worldbook') {
    if (/重新.{0,8}(?:判断|评估|考虑).{0,8}规模|(?:该|应该|适合|采用|选|用).{0,8}(?:哪种|哪一|什么|哪个).{0,8}(?:规模|世界)|怎么拆|如何分|不知道.*(?:大小|条目)|分流/.test(input)) return 'worldview_scale_router';
    const explicitScales = [...input.matchAll(/(?:小型(?:世界观)?|小世界)|(中型(?:世界观)?|中世界)|(大型(?:世界观)?|大世界)/g)];
    const scaleIds = new Set(explicitScales.map((match) => match[2] ? 'large' : match[1] ? 'medium' : 'small'));
    if (scaleIds.size === 1) return `worldview_${[...scaleIds][0]}`;
    if (scaleIds.size > 1) return 'worldview_scale_router';
    // 规模由发送结构决定，正文提到国家、组织或家庭不能改变已有创作专项。
    if (/^worldview_(?:small|medium|large)$/.test(preferredTaskId)) return preferredTaskId;
    const focusedEntry = project.worldbook.find((entry) => entry.id === focus.targetId);
    if (focusedEntry?.scale) return `worldview_${focusedEntry.scale}`;
    return 'worldview_scale_router';
  }

  if (section === 'rules') return 'creation_rules';
  if (section === 'opening') return 'opening_style_then_draft';

  if (section === 'mvu') {
    // 页签是明确的编辑目标；句中提到的上游文件可能只是参考资料，不能抢走当前专项。
    if (focus.area === 'crossCheck') return 'mvu_cross_check';
    if (focus.area === 'schemaSource') return 'mvu_schema_compilation';
    const hasFileFocus = focus.area === 'initvarSource' || focus.area === 'updateRulesSource';
    const asksDesign = /讨论|设计|取舍|需要哪些|是否需要|怎么规划|帮我想|分析/.test(input);
    const asksFile = artifactIntent || /(?:生成|转换为|输出).*(?:yaml|initvar|文件)/i.test(input);
    if (focus.area === 'initvarSource' || (!hasFileFocus && /初始变量|开局值|initvar/.test(input))) {
      if (asksFile) return 'mvu_initvar_formatting';
      if (asksDesign || !project.mvu.initvarDesign.trim()) return 'mvu_initvar_design';
      return 'mvu_initvar_formatting';
    }
    if (focus.area === 'updateRulesSource' || (!hasFileFocus && /更新规则|变化规则/.test(input))) {
      if (asksFile) return 'mvu_update_rule_formatting';
      if (asksDesign || !project.mvu.updateRuleDesign.trim()) return 'mvu_update_rule_design';
      return 'mvu_update_rule_formatting';
    }
    if (/交叉检查|交叉核对|三份文件|对应关系|是否一致/.test(input)) return 'mvu_cross_check';
    if (/结构脚本|schema|zod/.test(input)) return 'mvu_schema_compilation';
    if (!project.mvu.schemaSource.trim()) return 'mvu_schema_compilation';
    if (!project.mvu.initvarDesign.trim()) return 'mvu_initvar_design';
    if (!project.mvu.initvarSource.trim()) return 'mvu_initvar_formatting';
    if (!project.mvu.updateRuleDesign.trim()) return 'mvu_update_rule_design';
    if (!project.mvu.updateRulesSource.trim()) return 'mvu_update_rule_formatting';
    return 'mvu_cross_check';
  }

  if (section === 'statusbar') {
    if (isStatusbarPlanningFocus(focus) || requestsStatusbarRevision(input)) return 'mvu_statusbar_briefing';
    // kind 描述现有源码；下一版的生成路线以作者已确认的方案为准。
    const route = project.statusbar.contract.match(/^\s*(?:技术路线|成品生成路线)\s*[：:]\s*(原生\s*HTML|单\s*HTML\s*Vue)\s*$/im)?.[1];
    const vueRoute = route ? /Vue/i.test(route) : project.statusbar.kind === 'vue';
    const buildTask = vueRoute ? 'mvu_statusbar_vue_build' : 'mvu_statusbar_native_build';
    if (artifactIntent && project.statusbar.contract.trim()) return buildTask;
    if (/讨论|需求|想法|能不能|怎么做/.test(input)) return 'mvu_statusbar_briefing';
    if (!project.statusbar.contract.trim()) return 'mvu_statusbar_briefing';
    return buildTask;
  }

  if (section === 'frontend') {
    if (artifactIntent && project.frontend.contract.trim()) return 'frontend_build';
    if (!project.frontend.contract.trim() || /讨论|需求|想法|能不能|怎么做/.test(input)) return 'frontend_briefing';
    return 'frontend_build';
  }

  if (section === 'ejs') {
    const target = project.ejsCharacters.find((item) => item.id === focus.targetId) ?? project.ejsCharacters[0];
    if (artifactIntent && target?.contract.trim()) return 'ejs_build';
    if (!target?.contract.trim() || /讨论|需求|条件|想法|能不能|怎么设计|怎么实现/.test(input)) return 'ejs_briefing';
    return 'ejs_build';
  }

  return undefined;
}

/** 等价 resolveConversationTask()。 */
export function resolveConversationTask(section, project, focus, userInput, artifactIntent, preferredTaskId, lockExistingConversation = false, previousAnswer = '') {
  // 只承接规模专项约定的明确结论，不从正文地名、题材或字数推测规模。
  const decision = section === 'worldbook' && preferredTaskId === 'worldview_scale_router'
    ? previousAnswer.replace(/\*\*/g, '').match(/^\s*世界观规模\s*[：:]\s*(小型|中型|大型)\s*$/m)?.[1]
    : undefined;
  const decidedTaskId = decision ? `worldview_${{ 小型: 'small', 中型: 'medium', 大型: 'large' }[decision]}` : '';
  const routed = resolvePageTask(section, project, focus, userInput, artifactIntent, decidedTaskId || preferredTaskId);
  if (section === 'worldbook' && preferredTaskId === 'worldview_scale_router' && routed !== preferredTaskId) {
    return { task: routed };
  }
  const explicitStatusbarPlanning = section === 'statusbar'
    && routed === 'mvu_statusbar_briefing'
    && (isStatusbarPlanningFocus(focus) || requestsStatusbarRevision(userInput));
  if (lockExistingConversation && preferredTaskId && !explicitStatusbarPlanning) {
    return { task: preferredTaskId, suggestedTask: routed && routed !== preferredTaskId ? routed : undefined };
  }
  return { task: routed ?? preferredTaskId ?? undefined };
}

/**
 * 交付意图与出片可达性 —— 等价 AssistantPanel 的汇总：
 *   artifactIntent = (selfCheck || requested) && (batchScope || task 不属于两个禁项) && domain 不属于两个禁域
 */
export function resolveDelivery(section, taskId, { explicitIntent, userInput = '', hasActiveConversation = false } = {}) {
  const inferred = requestsArtifact(userInput);
  const requested = explicitIntent === 'artifact' || (explicitIntent === undefined && inferred);
  const selfCheck = explicitIntent === 'self-check';
  const batchSection = section === 'worldbook' || section === 'mvu' ? section : undefined;
  const artifactIntent = (selfCheck || requested)
    && (Boolean(batchSection) || !['mvu_cross_check', 'worldview_scale_router'].includes(taskId))
    && !['overview', 'package'].includes(section);
  const permission = selfCheck ? 'self-check' : artifactIntent ? 'artifact' : 'answer';
  return {
    inferred, requested, selfCheck, artifactIntent, permission,
    batch: artifactIntent && batchSection ? batchSection : undefined,
    pureOutput: isPureOutputTask(taskId),
    hasActiveConversation,
  };
}
