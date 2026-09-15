/**
 * 11 个制卡域 —— 与墨月 `workspace-pages.ts` 的 WORKSPACE_SECTIONS 一一对应。
 * 导航、路由、工具目录、装配都共用这一份。
 */
export const KNOWLEDGE_DOMAINS = [
  'overview', 'carddata', 'character', 'worldbook', 'rules', 'opening',
  'mvu', 'statusbar', 'frontend', 'ejs', 'package',
];

/** 有代码工作区检查的域（等价墨月 CODE_SECTIONS）。 */
export const CODE_DOMAINS = ['mvu', 'statusbar', 'frontend', 'ejs'];

export function isKnowledgeDomain(value) {
  return KNOWLEDGE_DOMAINS.includes(value);
}
