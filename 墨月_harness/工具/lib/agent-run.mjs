/**
 * Agent 运行预算 —— 逐字移植墨月 `agent-run.ts` 的常量与 normalizeAgentToolCallLimit()。
 * `snapshotAgentProject()` 的等价物是 `pending.mjs` 的 `snapshotProject()`（发送时冻结作品）。
 */

export const MAX_CONCURRENT_RUNS = 2;
export const DEFAULT_AGENT_TOOL_CALL_LIMIT = 30;
export const MIN_AGENT_TOOL_CALL_LIMIT = 1;
export const MAX_AGENT_TOOL_CALL_LIMIT = 100;

export function normalizeAgentToolCallLimit(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return DEFAULT_AGENT_TOOL_CALL_LIMIT;
  return Math.min(MAX_AGENT_TOOL_CALL_LIMIT, Math.max(MIN_AGENT_TOOL_CALL_LIMIT, Math.round(numeric)));
}

/** 等价墨月 `authorizedReadSections()`：选择 Agent 即开放当前作品全部页面的只读工具。 */
export function authorizedReadSections(workspaceSections) {
  return workspaceSections.map((page) => page.id);
}
