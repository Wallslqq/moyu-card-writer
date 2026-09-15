/**
 * 写作质量粗筛（第一道防线的**机械部分**）。
 *
 * 定位：这只是**提示器**，不是裁判。
 *   · 能做：抓可机械识别的表面特征（破折号、烂词、情绪宣告词……），提醒人去细看。
 *   · 不能做：判断"这个抽象词有没有作者含义"。那需要读上下文，由审稿子代理或作者判断。
 *
 * 判据来源：`知识库/核心/_写作自检.md`。两边必须保持一致。
 *
 * 输出刻意区分「违规」与「疑似」：
 *   · 违规：几乎没有正当理由，命中即需处理（破折号、元叙事标记）。
 *   · 疑似：有正当用法，只作提醒（「仿佛」在作者原文里可能是刻意的）。
 */

const RULES = [
  { id: 'dash', label: '破折号', level: '违规', pattern: /——/g,
    advice: '删掉破折号及后半段后前半段仍完整，则删；否则改逗号或冒号。' },
  { id: 'meta', label: '元叙事', level: '违规',
    pattern: /(AI\s*写作要点|戏剧用途|本卡独家|本卡专属|写作指引|此阶段让角色)/g,
    advice: '这是写给作者看的笔记，删。' },
  { id: 'vague', label: '模糊词', level: '疑似', pattern: /(似乎|几乎|仿佛|如同|宛如)/g,
    advice: '删掉或改为具体描述。作者原文里的刻意用法可保留。' },
  { id: 'micro', label: '八股微表情', level: '疑似',
    pattern: /(嘴角微微(上扬|勾起)|眼中闪过|眼底闪过|眸光微闪)/g,
    advice: '删掉，或改为简洁动作。' },
  { id: 'emotion', label: '情绪宣告', level: '疑似',
    pattern: /(感到一阵|涌上心头|涌了上来|蔓延开来|被一种.{0,6}情绪(包裹|笼罩)|心中(一|猛)紧)/g,
    advice: '改为具体行为：「她别过脸去」而不是「她感到一阵悲伤」。' },
  { id: 'cognition', label: '自我认知宣告', level: '疑似',
    pattern: /(意识到自己|她对自己说|他对自己说|她明白过来|他明白过来)/g,
    advice: '改为行为或对话。' },
  { id: 'fakeSubject', label: '假性主体', level: '疑似',
    pattern: /((念头|想法|回忆|烦躁|暖意|情绪)(在她|在他|在心中|在心里))/g,
    advice: '命名真实行为者：「她想到……」而不是「一个念头在她心里成形」。' },
  { id: 'translation', label: '翻译腔', level: '疑似',
    pattern: /(她是.{1,8}的。|他是.{1,8}的。|对.{1,10}，她(始终|一直)|对.{1,10}，他(始终|一直))/g,
    advice: '改自然语序：「她表现得拘谨」而不是「她是拘谨的」。' },
  { id: 'emptyPraise', label: '空泛评价', level: '疑似',
    pattern: /(很鲜活|很真实|很有张力|有画面感|沉浸感)/g,
    advice: '评价必须指向可检查的作用或具体风险，不能只说好。' },
];

/**
 * 审计一段文字。
 * @param {string} text
 * @returns {{level:string,label:string,count:number,samples:string[],advice:string}[]}
 */
export function auditText(text) {
  const findings = [];
  for (const rule of RULES) {
    const hits = String(text ?? '').match(rule.pattern);
    if (!hits || !hits.length) continue;
    findings.push({
      level: rule.level,
      label: rule.label,
      count: hits.length,
      samples: [...new Set(hits)].slice(0, 3),
      advice: rule.advice,
    });
  }
  return findings;
}

/** 汇总多份文件。`entries` 形如 [{ file, where }]，`readFile` 返回文本。 */
export function auditFiles(entries, readFile) {
  const out = [];
  for (const entry of entries) {
    const text = readFile(entry.file);
    if (text === undefined) continue;
    const findings = auditText(text);
    if (!findings.length) continue;
    out.push({ ...entry, findings });
  }
  return out;
}
