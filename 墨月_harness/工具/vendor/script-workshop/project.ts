import { z } from 'zod';
import type { MoyuThread } from '../moyu/types.ts';
import { dependencyIds, moduleKind, specialty } from './catalog.ts';
import { addAppCompanion, addPhoneCompanion, companionBookSchema, companionDraftSchema, newCompanionBook, writeCompanionEntries, type CompanionBook } from './worldbook.ts';

export interface ScriptModule {
  id: string;
  specialtyId?: string;
  dependencies?: string[];
  icon?: string;
  title: string;
  brief: string;
  source: string;
  sourceDraft?: string;
  revision: number;
  versions: { source: string; revision: number; at: string }[];
  threads: (MoyuThread & { draft?: string })[];
  activeThreadId: string;
  pending?: { source: string; reason: string; baseRevision: number; dependencies?: string[]; sourceRevisions?: Record<string, number>; worldbook?: NonNullable<CompanionBook['pending']> };
}
export interface ScriptProject {
  format: 'moyu-script-workshop';
  version: 1;
  id: string;
  title: string;
  linkedCardId: string;
  modules: ScriptModule[];
  selectedModuleId: string;
  worldbook: CompanionBook;
  testVariables: Record<string, unknown>;
  testMessages: { id: number; role: string; content: string; swipeId?: number }[];
  variablesDraft?: string;
  messagesDraft?: string;
  updatedAt: string;
}

export const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
export function newThread(id: string): MoyuThread {
  const at = new Date().toISOString();
  return { id: crypto.randomUUID(), taskId: `script:${id}`, section: 'frontend', scopeKey: id,
    title: '新对话', messages: [], memoryRecords: [], createdAt: at, updatedAt: at };
}
export function newProject(title = '未命名脚本'): ScriptProject {
  return { format: 'moyu-script-workshop', version: 1, id: crypto.randomUUID(), title, linkedCardId: '',
    modules: [], selectedModuleId: '', worldbook: newCompanionBook(), testVariables: {}, testMessages: [], updatedAt: new Date().toISOString() };
}
export function addModule(project: ScriptProject, id: string): void {
  const hadPhone = project.modules.some(item => item.id === 'messages' || item.id === 'forum');
  for (const key of [...dependencyIds(id).reverse(), id]) {
    if (project.modules.some(item => item.id === key)) continue;
    const thread = newThread(key);
    project.modules.push({ id: key, title: specialty(key).name, brief: '', source: '', revision: 0,
      versions: [], threads: [thread], activeThreadId: thread.id });
    addAppCompanion(project.worldbook, key, specialty(key).name);
  }
  project.selectedModuleId = id;
  if (!hadPhone) addPhoneCompanion(project.worldbook, project.modules.map(item => item.id));
}
export function writeSource(module: ScriptModule, source: string, expectedRevision: number): void {
  if (module.revision !== expectedRevision) throw new Error('这份代码已经修改过，请基于当前版本重新检查，旧稿没有覆盖它。');
  if (module.source === source) return;
  module.versions.push({ source: module.source, revision: module.revision, at: new Date().toISOString() });
  module.source = source;
  module.revision++;
}

export function addCustomApp(project: ScriptProject): ScriptModule {
  const id = crypto.randomUUID(), thread = newThread(id);
  const module: ScriptModule = { id, specialtyId: 'custom-app', dependencies: [], icon: '✦', title: '我的 APP', brief: '', source: '',
    revision: 0, versions: [], threads: [thread], activeThreadId: thread.id };
  project.modules.push(module); project.selectedModuleId = id;
  return module;
}
export function moduleDependencies(project: Pick<ScriptProject, 'modules'>, id: string): string[] {
  const result = new Set<string>(), active = new Set<string>();
  const visit = (key: string) => {
    const module = project.modules.find(item => item.id === key);
    if (!module) throw new Error('关联模块不存在，请核对当前工程。');
    if (active.has(key)) throw new Error('模块不能互相循环依赖。');
    active.add(key);
    const direct = module.dependencies ?? specialty(moduleKind(module)).requires;
    for (const dep of direct) {
      if (!result.has(dep)) { visit(dep); result.add(dep); }
    }
    active.delete(key);
  };
  visit(id);
  return [...result];
}
export function checkModuleDependencies(project: ScriptProject, module: ScriptModule, dependencies: string[]): void {
  if (moduleKind(module) !== 'custom-app') throw new Error('只有自定义 APP 在此处调整关联；标准模块沿用固定关联。');
  if (new Set(dependencies).size !== dependencies.length) throw new Error('关联模块不能重复。');
  moduleDependencies({ modules: project.modules.map(item => item.id === module.id ? { ...item, dependencies } : item) }, module.id);
}

function checkCompanionSources(project: ScriptProject, draft: NonNullable<CompanionBook['pending']>): void {
  for (const [id, revision] of Object.entries(draft.sourceRevisions ?? {})) {
    if (project.modules.find(item => item.id === id)?.revision !== revision) throw new Error('配套脚本已经修改过，请按当前代码重新核对世界书，旧稿没有写入。');
  }
}
export function acceptModuleDraft(project: ScriptProject, module: ScriptModule): void {
  const draft = module.pending;
  if (!draft) return;
  if (module.sourceDraft !== undefined) throw new Error('编辑框还有未应用的改动，请先保存代码或恢复已保存版本，再确认写入。');
  // 两份稿先全部核对，再一起应用；任一版本过期都不能留下半份更新。
  const book = clone(project.worldbook);
  if (draft.dependencies) checkModuleDependencies(project, module, draft.dependencies);
  for (const [id, revision] of Object.entries(draft.sourceRevisions ?? {})) {
    if (project.modules.find(item => item.id === id)?.revision !== revision) throw new Error('关联模块已经修改过，请基于当前内容重新核对这份稿。');
  }
  if (draft.worldbook) {
    checkCompanionSources(project, draft.worldbook);
    writeCompanionEntries(book, draft.worldbook.entries, draft.worldbook.baseRevision);
  }
  const changedDependencies = draft.dependencies && JSON.stringify(draft.dependencies) !== JSON.stringify(module.dependencies ?? []);
  writeSource(module, draft.source, draft.baseRevision);
  if (draft.dependencies) {
    module.dependencies = [...draft.dependencies];
    if (changedDependencies && module.revision === draft.baseRevision) module.revision++;
  }
  if (draft.worldbook) project.worldbook = book;
  delete module.pending;
}
export function acceptCompanionDraft(project: ScriptProject): void {
  const draft = project.worldbook.pending;
  if (!draft) return;
  checkCompanionSources(project, draft);
  writeCompanionEntries(project.worldbook, draft.entries, draft.baseRevision);
  delete project.worldbook.pending;
}

export function patchSource(source: string, patches: { find: string; replace: string }[]): string {
  let next = source;
  for (const patch of patches) {
    if (!patch.find || typeof patch.replace !== 'string') throw new Error('修复片段必须包含原文和替换内容。');
    const first = next.indexOf(patch.find);
    if (first < 0 || next.indexOf(patch.find, first + 1) >= 0) throw new Error('没有唯一匹配的原文，请重新读取当前代码后定位。');
    next = next.slice(0, first) + patch.replace + next.slice(first + patch.find.length);
  }
  return next;
}

const messageSchema = z.object({ id: z.string(), role: z.enum(['user', 'assistant']), content: z.string(), createdAt: z.string(),
  toolActivity: z.array(z.object({ id: z.string(), name: z.string(), label: z.string(), status: z.enum(['success', 'error']), detail: z.string().optional() })).optional(),
});
const threadSchema = z.object({
  id: z.string(), taskId: z.string(), section: z.literal('frontend'), scopeKey: z.string(), title: z.string(),
  messages: z.array(messageSchema), createdAt: z.string(), updatedAt: z.string(),
  draft: z.string().optional(),
  memoryRecords: z.array(z.object({ id: z.string(), content: z.string(), coveredMessageIds: z.array(z.string()),
    sourceTokenCount: z.number(), summaryTokenCount: z.number(), modelId: z.string(), createdAt: z.string() })),
});
const projectSchema = z.object({
  format: z.literal('moyu-script-workshop'), version: z.literal(1), id: z.string().uuid(), title: z.string(), linkedCardId: z.string(),
  selectedModuleId: z.string(), updatedAt: z.string(), testVariables: z.record(z.string(), z.json()),
  testMessages: z.array(z.object({ id: z.number().int().nonnegative(), role: z.string(), content: z.string(), swipeId: z.number().int().nonnegative().optional() })),
  variablesDraft: z.string().optional(), messagesDraft: z.string().optional(),
  worldbook: companionBookSchema.optional(),
  modules: z.array(z.object({ id: z.string(), title: z.string(), brief: z.string(), source: z.string(), revision: z.number().int().nonnegative(),
    specialtyId: z.string().optional(), dependencies: z.array(z.string()).optional(), icon: z.string().max(12).optional(),
    sourceDraft: z.string().optional(),
    versions: z.array(z.object({ source: z.string(), revision: z.number().int().nonnegative(), at: z.string() })),
    threads: z.array(threadSchema).min(1), activeThreadId: z.string(),
    pending: z.object({ source: z.string(), reason: z.string(), baseRevision: z.number().int().nonnegative(), dependencies: z.array(z.string()).optional(),
      sourceRevisions: z.record(z.string(), z.number().int().nonnegative()).optional(), worldbook: companionDraftSchema.optional() }).optional(),
  })),
});
export function parseProject(value: unknown): ScriptProject {
  const project = projectSchema.parse(value);
  const ids = new Set<string>();
  for (const item of project.modules) {
    specialty(moduleKind(item));
    if (item.id === '__phone') throw new Error('这个 APP ID 是手机外观的保留名称。');
    if (ids.has(item.id)) throw new Error('工程中存在重复模块。');
    ids.add(item.id);
    if (!item.threads.some(thread => thread.id === item.activeThreadId)) throw new Error('模块的当前对话不存在。');
  }
  for (const item of project.modules) {
    moduleDependencies(project, item.id);
  }
  if (project.modules.length && !ids.has(project.selectedModuleId)) throw new Error('工程的当前模块不存在。');
  // 老工程原本只下载固定手机规则；第一次打开才补入可编辑副本，不重置已有世界书。
  return { ...project, worldbook: project.worldbook ?? newCompanionBook(project.modules.map(item => item.id)) };
}
