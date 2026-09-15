#!/usr/bin/env node
/**
 * 脚本工坊导出链验证 —— 从"作品含工坊模块"一路验到"角色卡里真的有可运行的工坊脚本"。
 *
 * 用法：node 验收/verify-workshop.mjs
 * 退出码：0 全通过；1 有失败。
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const load = (rel) => import(new URL(`../${rel}`, import.meta.url).href);

const { projectCard } = await load('工具/lib/card.mjs');
const { stableId } = await load('工具/lib/ids.mjs');
const { javascriptSyntaxIssue } = await load('工具/lib/syntax.mjs');
const { newProject, addModule, writeSource, phoneDisplayRegex } = await load('工具/lib/workshop.mjs');

const MODULE_SOURCE = (title) => `const title = ${JSON.stringify(title)};
return { render(root) { const h = document.createElement('h2'); h.textContent = title; root.append(h); } };`;

/** 造一个含工坊工程的作品。 */
function buildProject({ withPhone = true, legacyWorkshopEntry = false } = {}) {
  const base = JSON.parse(fs.readFileSync(path.join(ROOT, '工具', 'fixtures', 'project.fixture.json'), 'utf8'));
  const workshop = newProject('测试工坊');
  addModule(workshop, 'collection');
  if (withPhone) addModule(workshop, 'messages');
  for (const module of workshop.modules) writeSource(module, MODULE_SOURCE(module.title), module.revision);
  workshop.id = 'workshop-fixture-1';

  if (legacyWorkshopEntry) {
    // 上一版导出时写进作品的世界书条目：本版不应重复注入
    base.worldbook.push({
      id: 'legacy-wb', title: '旧版工坊条目', content: '旧正文', keys: [], secondaryKeys: [],
      activation: 'always', placement: 'before_character', depth: 0, order: 10, probability: 100, enabled: true,
      sourceRaw: { extensions: { moyu_script_project: stableId(base.id, 'workshop:workshop-fixture-1') } },
    });
  }
  base.scriptProjects = [workshop];
  return { project: base, workshop };
}

let failed = 0;
let total = 0;
const check = (name, ok, extra = '') => {
  total += 1;
  if (!ok) failed += 1;
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${extra ? `  ${extra}` : ''}`);
};

console.log('## 一、含工坊模块导出（成就与图鉴 + 消息与私信）\n');
const { project, workshop } = buildProject();
let card;
try { card = projectCard(project); }
catch (error) { console.log(`  ✗ 导出抛错：${error.message}`); process.exit(1); }

const scripts = card.data.extensions.tavern_helper.scripts;
const entries = card.data.character_book.entries;
const regexes = card.data.extensions.regex_scripts;
const scriptId = stableId(project.id, 'workshop:workshop-fixture-1');

const workshopScript = scripts.find((s) => s.id === scriptId);
check('工坊运行包已注入脚本区', Boolean(workshopScript), workshopScript ? `id=${scriptId.slice(0, 8)}…` : '');
check('脚本名 = 工坊标题', workshopScript?.name === '测试工坊');
check('运行包内含四个序列化框架函数', ['installTavernWorkshop', 'changeNumbers', 'createFloatingWindow', 'floatingLayout']
  .every((n) => workshopScript?.content.includes(`function ${n}`)), `content ${workshopScript?.content.length} 字符`);

let syntaxIssue = '';
try { syntaxIssue = javascriptSyntaxIssue(workshopScript.content, 'script'); }
catch (error) { syntaxIssue = error.message; }
check('运行包是可解析的合法 JavaScript', syntaxIssue === '', syntaxIssue);

const companionEntries = entries.filter((e) => e.extensions?.moyu_script_project === scriptId);
check('配套世界书条目带工坊来源标记', companionEntries.length >= 1, companionEntries.map((e) => e.comment).join('、'));
check('配套条目为指定深度（扩展 position=4）', companionEntries.every((e) => e.extensions.position === 4));
check('手机格式条目被判为常驻（constant）', companionEntries.some((e) => e.constant === true));

const phoneRegex = regexes.find((r) => r.id === stableId(project.id, 'workshop-phone'));
check('手机显示正则已注入且 id 稳定', Boolean(phoneRegex), phoneRegex?.scriptName ?? '');
check('手机正则与原件一致', JSON.stringify(phoneRegex?.findRegex) === JSON.stringify(phoneDisplayRegex('异乡人').findRegex));
check('运行包脚本未被 MVU 脚本挤掉', scripts.some((s) => s.name === 'MVU') && scripts.some((s) => s.name === '墨月·变量结构'));

console.log('\n## 二、上一版工坊条目不应重复注入\n');
const legacy = buildProject({ legacyWorkshopEntry: true });
const legacyCard = projectCard(legacy.project);
check('带工坊来源标记的旧条目被过滤', !legacyCard.data.character_book.entries.some((e) => e.comment === '旧版工坊条目'));

console.log('\n## 三、仅非手机模块时不应注入手机正则\n');
const noPhone = buildProject({ withPhone: false });
const noPhoneCard = projectCard(noPhone.project);
check('无手机配套条目', !noPhoneCard.data.character_book.entries.some((e) => e.extensions?.moyu_script_project && e.content.includes('<moyu_phone>')));
check('不注入手机显示正则', !noPhoneCard.data.extensions.regex_scripts.some((r) => r.id === stableId(noPhone.project.id, 'workshop-phone')));
check('工坊脚本仍然注入', noPhoneCard.data.extensions.tavern_helper.scripts.some((s) => s.id === stableId(noPhone.project.id, 'workshop:workshop-fixture-1')));

console.log('\n## 四、重复导出稳定（同作品两次导出逐字段一致）\n');
const again = projectCard(JSON.parse(JSON.stringify(project)));
check('两次导出结果完全一致', JSON.stringify(again) === JSON.stringify(card));

export const workshopVerification = { total, failed, passed: total - failed };
console.log(`\n${failed ? '✗' : '✓'} 工坊导出链验证 ${failed ? `${failed} 项未通过` : '全部通过'}`);
// 作为脚本直接运行时才决定退出码；被验收脚本 import 时不终止进程。
if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('/verify-workshop.mjs')) {
  process.exit(failed ? 1 : 0);
}
