/**
 * 待确认稿注册表 —— 等价于墨月 project.artifacts 里 confirmed=false 的那些条目。
 *
 * 位置：<harness>/状态/待确认/<id>.json
 * 作用：把"模型产出了什么"与"作者确认写入"彻底分开；pack --apply --id 是唯一的落地入口。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export function stateDir(root) {
  return path.join(root, '状态');
}

export function pendingDir(root) {
  return path.join(stateDir(root), '待确认');
}

export function pendingId(taskId, target) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const suffix = crypto.createHash('sha1').update(`${taskId}:${target ?? ''}`).digest('hex').slice(0, 6);
  return `${stamp}-${taskId}-${suffix}`;
}

export function writePending(root, record) {
  const dir = pendingDir(root);
  fs.mkdirSync(dir, { recursive: true });
  const id = record.id ?? pendingId(record.taskId, record.targetId);
  const full = {
    confirmed: false,
    createdAt: new Date().toISOString(),
    ...record,
    id,
  };
  fs.writeFileSync(path.join(dir, `${id}.json`), `${JSON.stringify(full, null, 2)}\n`, 'utf8');
  return full;
}

export function readPending(root, id) {
  const file = path.join(pendingDir(root), `${id}.json`);
  if (!fs.existsSync(file)) throw new Error(`没有找到待确认稿「${id}」。用 --list 查看现有稿件。`);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function savePending(root, record) {
  const file = path.join(pendingDir(root), `${record.id}.json`);
  fs.writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  return record;
}

export function listPending(root) {
  const dir = pendingDir(root);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((name) => name.endsWith('.json'))
    .map((name) => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

/** 每轮发送时冻结的作品快照；本轮所有读取都来自它。 */
export function snapshotProject(root, project, label = '') {
  const dir = path.join(stateDir(root), '快照');
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(dir, `${stamp}${label ? `-${label}` : ''}.json`);
  fs.writeFileSync(file, `${JSON.stringify(project, null, 2)}\n`, 'utf8');
  return file;
}

// ── 会话存档（按 (域, 专项, 焦点对象) 分区） ──────────────────────────
export function threadDir(root) {
  return path.join(stateDir(root), '会话');
}

/** 文件名用 scopeKey 的稳定哈希，避免路径里出现引号与中文括号。 */
export function threadFile(root, scopeKey) {
  const hash = crypto.createHash('sha1').update(scopeKey).digest('hex').slice(0, 16);
  return path.join(threadDir(root), `${hash}.json`);
}

export function ensureThread(root, { scopeKey, section, taskId, focus = {}, label = '' }) {
  const file = threadFile(root, scopeKey);
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  const now = new Date().toISOString();
  const thread = {
    id: crypto.randomUUID(),
    scopeKey,
    section,
    taskId,
    targetId: focus.targetId,
    area: focus.area,
    label,
    messages: [],
    memoryRecords: [],
    createdAt: now,
    updatedAt: now,
  };
  writeThread(root, thread);
  return thread;
}

export function readThread(root, scopeKey) {
  const file = threadFile(root, scopeKey);
  if (!fs.existsSync(file)) return undefined;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function writeThread(root, thread) {
  const dir = threadDir(root);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(threadFile(root, thread.scopeKey), `${JSON.stringify(thread, null, 2)}\n`, 'utf8');
  return thread;
}

export function listThreads(root) {
  const dir = threadDir(root);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((name) => name.endsWith('.json'))
    .map((name) => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')))
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

export function appendThreadMessage(thread, { role, content, taskId, attachments = [] }) {
  const message = {
    id: crypto.randomUUID(),
    role,
    content,
    taskId: taskId ?? thread.taskId,
    ...(attachments.length ? { attachments } : {}),
    createdAt: new Date().toISOString(),
  };
  thread.messages.push(message);
  thread.updatedAt = message.createdAt;
  return message;
}

// ── 附件集（一轮发送所用的文件与图片） ────────────────────────────────
export function attachmentDir(root) {
  return path.join(stateDir(root), '附件');
}

export function attachmentFile(root, id) {
  return path.join(attachmentDir(root), `${id}.json`);
}

export function newAttachmentSet(root, authorRequest = '') {
  const now = new Date().toISOString();
  const set = {
    id: `att-${now.replace(/[:.]/g, '-')}`,
    authorRequest,
    attachments: [],
    createdAt: now,
    updatedAt: now,
  };
  writeAttachmentSet(root, set);
  return set;
}

export function readAttachmentSet(root, id) {
  const file = attachmentFile(root, id);
  if (!fs.existsSync(file)) throw new Error(`没有找到附件集「${id}」。用 --list 查看。`);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function writeAttachmentSet(root, set) {
  fs.mkdirSync(attachmentDir(root), { recursive: true });
  set.updatedAt = new Date().toISOString();
  fs.writeFileSync(attachmentFile(root, set.id), `${JSON.stringify(set, null, 2)}\n`, 'utf8');
  return set;
}

export function listAttachmentSets(root) {
  const dir = attachmentDir(root);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((name) => name.endsWith('.json'))
    .map((name) => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')))
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}
