/**
 * 脚本工坊适配层 —— 转发到 vendored 的墨月原件（GPL-3.0-only，同源）。
 *
 * 为什么不做"重写移植"：工坊成品把 `installTavernWorkshop / changeNumbers /
 * createFloatingWindow / floatingLayout` 用 `Function.prototype.toString()` 序列化进角色卡，
 * 手抄一份错一个字符，离线测试全绿但玩家端直接跑挂。原文与本 harness 同许可同源，
 * vendor 是唯一既忠实又安全的做法（见 工具/vendor/script-workshop/README.md）。
 *
 * 本文件只做接口收敛：card.mjs 只依赖这里的几个名字。
 */
export { exportScript, installTavernWorkshop } from '../vendor/script-workshop/export.ts';
export { phoneDisplayRegex, phoneOutputRule, parsePhoneMessages } from '../vendor/script-workshop/phone.ts';
export { relatedCompanions, newCompanionBook, newCompanionEntry, exportCompanionBook } from '../vendor/script-workshop/worldbook.ts';
export { newProject, addModule, addCustomApp, writeSource, moduleDependencies, clone } from '../vendor/script-workshop/project.ts';
export { checkSource, changeNumbers, scriptDocument } from '../vendor/script-workshop/runtime.ts';
export { specialty, specialties, moduleKind, dependencyIds, publicShapes } from '../vendor/script-workshop/catalog.ts';
