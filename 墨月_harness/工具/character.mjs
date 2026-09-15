#!/usr/bin/env node
/**
 * 墨月 Harness · 人物建档入口
 *
 * 为什么需要它：全仓库只有 `lib/apply.mjs:106` 一处 `project.characters.push`，
 * 且它在 `taskId === 'npc_light_habitat'` 分支里；`createCharacter()` 也只被自测与差分调用。
 * 于是**空工程**下人物模块无法入账：
 *   · `pack --apply --task airp_basic_information` → 「请先建立并选择要写入的人物」
 *   · `prompt.mjs --domain character` → 因 `!project.characters.length` **恒回 `airp_intake_router`**
 *     （须用 `--task` 强行锁定专项）
 * 网页版对应的是「建立人物」按钮，DSH 侧缺这一口。本工具就是那一口的最小实现。
 *
 * **这是"只有 pack --apply 能改作品工程"的一个有意例外**，与 `new-project.mjs` 同类：
 * 它只写**骨架记录**（姓名 + id，六个栏位全空），不写任何正文。
 * 正文仍然只能经 `check → pack --prepare → 作者确认 → pack --apply` 写入。
 * 因此它不构成"绕过闸门"——但也**只准用来建空壳**，不许顺手写栏位。
 *
 * 用法：
 *   node 工具/character.mjs --add --project <作品.json> --name "人物名" [--dry]
 *   node 工具/character.mjs --list --project <作品.json>
 *   node 工具/character.mjs --self-test
 *
 * 退出码：0 成功；1 运行错误；2 用法错误。
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { createCharacter } from './lib/apply.mjs';

export function parseArgs(argv) {
  const out = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token.startsWith('--')) {
      const key = token.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) { out.flags[key] = next; i += 1; }
      else out.flags[key] = true;
    } else out._.push(token);
  }
  return out;
}

/**
 * 建立人物空壳。返回 { created, already, character }。
 * 逐字走官方 `createCharacter()`，保证记录形状与 `validateProject` 期望一致。
 */
export function addCharacter(project, name) {
  const trimmed = String(name ?? '').trim();
  if (!trimmed) throw new Error('人物名不能为空。');
  const existing = (project.characters ?? []).find((item) => item.name === trimmed);
  if (existing) return { created: false, already: true, character: existing };
  const character = createCharacter(trimmed);
  project.characters ??= [];
  project.characters.push(character);
  project.updatedAt = new Date().toISOString();
  return { created: true, already: false, character };
}

function readProject(file) {
  const full = path.resolve(file);
  if (!fs.existsSync(full)) throw new Error(`找不到作品工程：${full}`);
  return { full, project: JSON.parse(fs.readFileSync(full, 'utf8')) };
}

export function main() {
  const { flags } = parseArgs(process.argv.slice(2));
  if (flags['self-test']) return selfTest();

  const file = typeof flags.project === 'string' ? flags.project : '';
  if (!file) { usage(); return 2; }

  try {
    const { full, project } = readProject(file);

    if (flags.list) {
      const characters = project.characters ?? [];
      if (!characters.length) { console.log('（还没有人物）'); return 0; }
      for (const item of characters) {
        const filled = ['basicInformation', 'lifeStructure', 'characterNature', 'sceneExpression', 'clothingStyle', 'notes']
          .filter((key) => String(item[key] ?? '').trim()).length;
        console.log(`· ${item.name}（${item.id}）已填 ${filled}/6 栏`);
      }
      return 0;
    }

    const name = typeof flags.name === 'string' ? flags.name : '';
    if (!name) { usage(); return 2; }

    if (flags.dry) {
      const existing = (project.characters ?? []).find((item) => item.name === name.trim());
      console.log(existing ? `[dry] 已有同名人物，将跳过：${existing.name}` : `[dry] 将建立人物：${name.trim()}`);
      return 0;
    }

    const result = addCharacter(project, name);
    if (!result.created) {
      console.log(`· 已有同名人物，未重复建立：${result.character.name}（id=${result.character.id}）`);
      return 0;
    }
    fs.writeFileSync(full, `${JSON.stringify(project, null, 2)}\n`, 'utf8');
    console.log(`✓ 已建立人物：${result.character.name}（id=${result.character.id}，空壳，未写任何栏位）`);
    console.log('  下一步：装配该人物域的请求时用 --task 锁定专项，或先让 prompt.mjs 路由。');
    return 0;
  } catch (error) {
    console.error(`✗ ${error?.message ?? error}`);
    return 1;
  }
}

function usage() {
  console.error('用法：');
  console.error('  node 工具/character.mjs --add  --project <作品.json> --name "人物名" [--dry]');
  console.error('  node 工具/character.mjs --list --project <作品.json>');
  console.error('  node 工具/character.mjs --self-test');
  console.error('');
  console.error('  只建立空壳记录（姓名 + id，六栏全空）。正文仍走 pack --apply。');
}

// ── 自测 ─────────────────────────────────────────────────────────────
export function selfTest() {
  const stubProject = () => ({ id: 'proj-t', title: 'T', characters: [], updatedAt: '' });
  const cases = [
    ['建人：产生记录且六栏全空', () => {
      const project = stubProject();
      const result = addCharacter(project, '男主');
      const c = result.character;
      return result.created === true
        && project.characters.length === 1
        && c.name === '男主'
        && Boolean(c.id)
        && !c.basicInformation && !c.lifeStructure && !c.characterNature
        && !c.sceneExpression && !c.clothingStyle && !c.notes;
    }],
    ['建人：记录形状与构造器一致（validateProject 不会炸）', () => {
      const project = stubProject();
      const { character } = addCharacter(project, '男主');
      const keys = ['id', 'name', 'basicInformation', 'lifeStructure', 'characterNature', 'sceneExpression', 'clothingStyle', 'notes', 'createdAt', 'updatedAt'];
      return keys.every((key) => key in character);
    }],
    ['建人：同名不重复建立', () => {
      const project = stubProject();
      addCharacter(project, '男主');
      const again = addCharacter(project, '男主');
      return again.created === false && again.already === true && project.characters.length === 1;
    }],
    ['建人：名字两端空白被裁掉，空名字被拒', () => {
      const project = stubProject();
      const result = addCharacter(project, '  男主  ');
      let refused = false;
      try { addCharacter(project, '   '); } catch { refused = true; }
      return result.character.name === '男主' && refused;
    }],
    ['建人：可连续建立多个人物', () => {
      const project = stubProject();
      for (const name of ['男主', '苏晚', '温栀', '周予安']) addCharacter(project, name);
      return project.characters.length === 4 && new Set(project.characters.map((c) => c.id)).size === 4;
    }],
    ['建人：不碰任何栏位内容（只写骨架）', () => {
      const project = stubProject();
      const { character } = addCharacter(project, '男主');
      return Object.keys(character).filter((k) => !['id', 'name', 'createdAt', 'updatedAt'].includes(k))
        .every((k) => character[k] === '');
    }],
  ];
  let failed = 0;
  for (const [name, run] of cases) {
    let ok = false; let detail = '';
    try { ok = run() === true; } catch (error) { detail = String(error?.message ?? error); }
    if (!ok) failed += 1;
    console.log(`${ok ? '  ✓' : '  ✗'} ${name}${detail ? `  ← ${detail}` : ''}`);
  }
  console.log(`\n${failed ? '✗' : '✓'} 人物建档自测 ${cases.length - failed}/${cases.length} 通过`);
  return failed ? 1 : 0;
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) process.exit(main());
