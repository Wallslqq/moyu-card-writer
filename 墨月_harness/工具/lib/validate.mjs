/**
 * 作品结构检查 —— 逐字移植墨月 `workspace.ts` 的 validateProject() 及其两个辅助函数。
 *
 * 这是「检查与导出」域的那一格：判断当前正式资料是否满足打包角色卡的条件。
 * 与成品级校验的区别：成品级看"这一份稿子能不能写入"，这里看"整个作品能不能打包"。
 *
 * 有意未移植：`sectionState()`（墨月用于界面徽章的 blocked/ready 推导）。harness 没有界面，
 * 且它的判断完全建立在 validateProject 之上，需要时可一行拼出。已在基线矩阵中标注。
 */
import { importedCardData } from './apply.mjs';
import { checkMvuFiles } from './mvu.mjs';
import { statusbarArtifactIssues, frontendArtifactIssues } from './html.mjs';
import { ejsArtifactIssues } from './ejs.mjs';
import { frontendOuterTag, containsTagPair } from './card.mjs';
import { checkSource, moduleDependencies } from './workshop.mjs';

function issue(id, level, section, title, detail) {
  return { id, level, section, title, detail };
}

export function validateProject(project) {
  const issues = [];
  if (!project.title.trim()) issues.push(issue('title', 'error', 'overview', '作品没有名字', '先填写作品名称，导出的角色卡会使用它。'));
  const importedData = importedCardData(project);
  // 原卡修改模式必须允许保留只有世界书、脚本或扩展资料的合法角色卡，不能套用新卡的人物正文门槛。
  const importedCharacterReady = Boolean(project.importedCard && importedData);
  if (!project.characters.length && !importedCharacterReady) issues.push(issue('character', 'error', 'character', '还没有人物', '至少建立一个人物，才能打包角色卡。'));
  for (const character of project.characters) {
    if (!character.basicInformation.trim()) issues.push(issue(`basic-${character.id}`, 'error', 'character', `${character.name} 缺少基础信息`, '人物最基本的身份与关系尚未写入。'));
    if (!character.characterNature.trim()) issues.push(issue(`nature-${character.id}`, 'warning', 'character', `${character.name} 缺少人物性情`, '可以导出，但人物在实测中容易显得不稳定。'));
  }
  if (!project.opening.firstMessage.trim()) issues.push(issue('opening', 'warning', 'opening', '还没有开场白', '角色卡可以导出，但首次打开不会有可用的开场。'));
  for (const entry of project.worldbook.filter((item) => item.enabled)) {
    if (!entry.content.trim()) issues.push(issue(`world-empty-${entry.id}`, 'warning', 'worldbook', `${entry.title} 没有正文`, '空条目不会进入角色卡，建议补完或删除。'));
    if (entry.activation === 'keyword' && !entry.keys.some((key) => key.trim())) {
      const level = project.importedCard && entry.sourceRaw ? 'warning' : 'error';
      issues.push(issue(`world-key-${entry.id}`, level, 'worldbook', `${entry.title} 没有关键词`, '关键词唤醒条目没有主要关键词，因此永远不会触发。'));
    }
  }
  if (project.mvu.enabled) {
    mvuSourceIssues(project).forEach((detail, index) => issues.push(issue(`mvu-files-${index}`, 'error', 'mvu', 'MVU 文件无法运行', detail)));
  }
  if (project.statusbar.kind !== 'none' && !mvuRuntimeReady(project)) issues.push(issue('statusbar-mvu', 'error', 'statusbar', '状态栏没有可读取的 MVU', '先完成变量结构、开局值与变化规则，再制作状态栏。'));
  if (project.statusbar.kind !== 'none' && !project.statusbar.source.trim()) issues.push(issue('statusbar-source', 'error', 'statusbar', '状态栏还没有成品', '完成需求讨论后生成并预览状态栏。'));
  if (project.statusbar.kind !== 'none' && project.statusbar.source.trim()) {
    statusbarArtifactIssues(project.statusbar.source, project.statusbar.kind)
      .forEach((detail, index) => issues.push(issue(`statusbar-html-${index}`, 'error', 'statusbar', '状态栏成品无法运行', detail)));
  }
  const frontendStarted = [project.frontend.requirements, project.frontend.contract, project.frontend.source, project.frontend.previewHtml]
    .some((value) => value.trim());
  if (frontendStarted && (!project.frontend.source.trim() || !project.frontend.previewHtml.trim())) {
    const missing = [
      !project.frontend.source.trim() ? '运行提示词' : '',
      !project.frontend.previewHtml.trim() ? '消息前端 HTML' : '',
    ].filter(Boolean);
    issues.push(issue('frontend-source', 'warning', 'frontend', '消息前端仍未完成', `${missing.join('、')}为空。两份文件必须同时存在，才能形成完整前端。`));
  }
  if (project.frontend.previewHtml.trim()) {
    const outerTag = frontendOuterTag(project);
    if (!outerTag) issues.push(issue('frontend-tag', 'error', 'frontend', '消息前端缺少唯一外层标签', '创作合同与运行提示词必须明确同一个外层标签，打包器才能建立显示规则。'));
    else if (!containsTagPair(project.frontend.source, outerTag) || !project.frontend.previewHtml.includes(outerTag)) {
      issues.push(issue('frontend-tag-mismatch', 'error', 'frontend', '消息前端的标签没有对齐', `运行提示词与 HTML 必须共同读取 <${outerTag}>，当前成品不能安全建立显示规则。`));
    }
    frontendArtifactIssues(project.frontend.source, project.frontend.previewHtml, project.frontend.contract)
      .forEach((detail, index) => issues.push(issue(`frontend-structure-${index}`, 'error', 'frontend', '消息前端成品无法运行', detail)));
  }
  for (const item of project.ejsCharacters) {
    if (!item.entryName.trim()) issues.push(issue(`ejs-name-${item.id}`, 'error', 'ejs', `${item.name} 缺少世界书名称`, '填写最终写入世界书的条目名称。'));
    if (!Number.isInteger(item.entryOrder) || item.entryOrder < 1 || item.entryOrder > 8) issues.push(issue(`ejs-order-${item.id}`, 'error', 'ejs', `${item.name} 的世界书顺序无效`, 'EJS 工件必须放在角色定义之后的 1–8。'));
    if (!item.source.trim()) issues.push(issue(`ejs-${item.id}`, 'warning', 'ejs', `${item.name} 尚未写入代码`, '空工件不会进入角色卡。'));
    else {
      ejsArtifactIssues(item.source)
        .forEach((detail, index) => issues.push(issue(`ejs-source-${item.id}-${index}`, 'error', 'ejs', `${item.name} 的 EJS 无法运行`, detail)));
    }
  }
  for (const workshop of project.scriptProjects) {
    for (const module of workshop.modules.filter((item) => item.source.trim())) {
      const errors = checkSource(module.source);
      const missing = moduleDependencies(workshop, module.id).filter((id) => !workshop.modules.find((item) => item.id === id)?.source.trim());
      if (missing.length) errors.push('关联模块还没有代码，请在脚本工坊完成后再运行。');
      for (const [index, detail] of errors.entries()) issues.push(issue(`workshop-${workshop.id}-${module.id}-${index}`, 'error', 'package', `${workshop.title} · ${module.title}`, detail));
    }
  }
  if (!issues.length) issues.push(issue('ready', 'ready', 'package', '结构检查通过', '当前正式资料已经满足角色卡打包条件。'));
  return issues;
}

function mvuRuntimeReady(project) {
  return project.mvu.enabled && !mvuSourceIssues(project).length;
}

function mvuSourceIssues(project) {
  return checkMvuFiles(project.mvu).issues;
}

export function projectState(project) {
  const issues = validateProject(project);
  return {
    ready: issues.filter((item) => item.level === 'ready').length,
    errors: issues.filter((item) => item.level === 'error'),
    warnings: issues.filter((item) => item.level === 'warning'),
    blocked: issues.some((item) => item.level === 'error'),
  };
}
