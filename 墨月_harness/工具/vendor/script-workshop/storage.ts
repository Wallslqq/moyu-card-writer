import { parseProject, type ScriptProject } from './project.ts';

export interface StoredProject { project: ScriptProject; revision: number }
// 仅用于读取升级前的独立工程；新工程随所属角色卡保存，不再写入这个旧库。
async function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('moyu-script-workshop', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('projects', { keyPath: 'project.id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export async function loadProjects(): Promise<StoredProject[]> {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction('projects').objectStore('projects').getAll();
      request.onsuccess = () => {
        try { resolve(request.result.map(item => ({ project: parseProject(item.project), revision: item.revision }))); }
        catch (error) { reject(error); }
      };
      request.onerror = () => reject(request.error);
    });
  } finally { db.close(); }
}
