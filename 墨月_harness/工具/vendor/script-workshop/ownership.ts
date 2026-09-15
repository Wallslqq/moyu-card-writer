import type { MoyuLocalState, MoyuProject } from '../moyu/types.ts';
import { clone, type ScriptProject } from './project.ts';

// 旧独立库只读保留。归入记录随作品库保存，删除作品后也不会再次把旧工程自动迁回。
export function adoptLegacyProject(state: MoyuLocalState, card: MoyuProject, legacy: ScriptProject): void {
  if (state.importedScriptProjectIds?.includes(legacy.id)) return;
  if (card.scriptProjects.some(item => item.id === legacy.id)) throw new Error('这张角色卡已有同一工程，请先核对，未覆盖原内容。');
  const project = clone(legacy);
  project.linkedCardId = '';
  card.scriptProjects.push(project);
  card.updatedAt = new Date().toISOString();
  (state.importedScriptProjectIds ??= []).push(legacy.id);
}

export function migrateLinkedProjects(state: MoyuLocalState, legacy: ScriptProject[]): boolean {
  let changed = false;
  for (const project of legacy) {
    if (state.importedScriptProjectIds?.includes(project.id)) continue;
    const card = state.projects.find(item => item.id === project.linkedCardId);
    if (!card) continue;
    adoptLegacyProject(state, card, project);
    changed = true;
  }
  return changed;
}
