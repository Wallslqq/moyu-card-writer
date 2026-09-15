#!/usr/bin/env node
/**
 * 墨月 Harness · 打包器
 *
 * 用法：
 *   node 工具/pack.mjs --card  --project 状态/作品.json [--out 卡.json]
 *   node 工具/pack.mjs --embed --project 状态/作品.json --cover 封面.png [--out 卡.png]
 *   node 工具/pack.mjs --read  --card-png 卡.png            # 读回内嵌卡（比对用）
 *   node 工具/pack.mjs --apply --project 状态/作品.json --file 待确认.md --task <taskId> [--target <id>] [--area <栏目>] [--out 作品.新.json]
 *   node 工具/pack.mjs --self-test
 *
 * 纪律：--apply 先过 check，校验有错误级问题时**拒绝写入**。
 * 退出码：0 成功；1 被拒绝；2 用法/输入错误。
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { projectCard, frontendOuterTag, statusbarDocument } from './lib/card.mjs';
import { embedCharacterCard, readCharacterCard } from './lib/png.mjs';
import { applyArtifact, applyPreparedArtifact, prepareBatchArtifact, createCharacter, createWorldbookEntry, createRule } from './lib/apply.mjs';
import { workspaceArtifactReview } from './lib/review.mjs';
import { formatArtifactDiagnostics } from './lib/diagnostics.mjs';
import { stableId } from './lib/ids.mjs';
import { newProject, addModule, writeSource } from './lib/workshop.mjs';
import { writePending, readPending, savePending, listPending, deletePending, discardUnconfirmed } from './lib/pending.mjs';
import path2 from 'node:path';
import { fileURLToPath } from 'node:url';

const HARNESS_ROOT = path2.resolve(path2.dirname(fileURLToPath(import.meta.url)), '..');
/** 自测时切到临时目录，避免污染真实待确认区。 */
let stateRoot = HARNESS_ROOT;

function parseArgs(argv) {
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

function readProject(file) {
  if (!file || file === true) throw new Error('缺少 --project <作品.json>');
  return JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
}

function writeOut(file, data) {
  if (!file || file === true) return undefined;
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  fs.writeFileSync(path.resolve(file), data, 'utf8');
  return path.resolve(file);
}

// ── 自测夹具 ──────────────────────────────────────────────────────────
const ONE_PX_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

function fixtureProject() {
  const now = '2026-09-14T00:00:00.000Z';
  const character = createCharacter('周梦瑶');
  character.basicInformation = '<周梦瑶_基础信息>\n上海人。\n</周梦瑶_基础信息>';
  character.characterNature = '内核是想要被看见。';
  const wb = createWorldbookEntry();
  wb.title = '异乡人_世界设定';
  wb.content = '小型世界观正文。';
  const rule = createRule();
  rule.title = '称呼规则';
  rule.content = '不得替使用者决定台词。';
  return {
    id: 'proj-fixture-1',
    title: '异乡人',
    summary: '测试作品',
    stage: 'draft',
    activeSection: 'character',
    characters: [character],
    worldbook: [wb],
    rules: [rule],
    opening: { firstMessage: '她推开门。', alternateGreetings: ['', '另一个开场。'] },
    mvu: {
      enabled: true,
      initvarDesign: '开局值设计',
      updateRuleDesign: '变化规则设计',
      initvarSource: '主角:\n  金币: 0',
      updateRulesSource: '变量更新规则:\n  主角:\n    金币:\n      check: 当交易时\n      type: number',
      schemaSource: 'export const Schema = z.object({ 主角: z.object({ 金币: z.coerce.number() }) });\n$(() => { registerMvuSchema(Schema); });',
    },
    statusbar: { kind: 'native', requirements: '看金币', contract: '技术路线：原生 HTML', source: '<!doctype html><html><head></head><body><script>waitGlobalInitialized("Mvu").then(()=>{ Mvu.getMvuData({}); });</script></body></html>' },
    frontend: { requirements: '看原文', contract: '唯一外层标签：`moyu_ui`', source: '<moyu_ui>\n原始正文\n</moyu_ui>', previewHtml: '<!doctype html><html><head></head><body><script>const id=getCurrentMessageId();const raw=getChatMessages(id)[0]?.message||"";document.body.textContent=raw;</script></body></html>', testMessage: '' },
    ejsCharacters: [{ id: 'ejs-1', name: '状态', entryName: '[EJS] 状态', entryOrder: 3, requirements: '', contract: '', source: "<% if (getvar('stat_data.主角.金币') > 0) { %>有钱<% } %>" }],
    assets: [], materials: [], artifacts: [], threads: {}, activeThreadIds: {}, recoveryReplies: [],
    scriptProjects: [], createdAt: now, updatedAt: now,
  };
}

function findEntry(card, title) {
  return (card.data.character_book?.entries ?? []).find((entry) => entry.comment === title);
}

const CASES = [
  ['卡：spec 与版本正确', () => { const c = projectCard(fixtureProject()); return c.spec === 'chara_card_v3' && c.spec_version === '3.0' && c.name === '异乡人'; }],
  ['卡：initvar 条目禁用且在角色定义前', () => {
    const e = findEntry(projectCard(fixtureProject()), '[initvar]变量初始化勿开');
    return Boolean(e) && e.enabled === false && e.constant === true && e.position === 'before_char' && e.insertion_order === 14720 && e.extensions.position === 0;
  }],
  ['卡：变量列表与变量输出格式在指定深度', () => {
    const c = projectCard(fixtureProject());
    const list = findEntry(c, '变量列表'); const fmt = findEntry(c, '[mvu_update]变量输出格式');
    return list?.extensions.position === 4 && fmt?.extensions.position === 4 && list?.insertion_order === 14720;
  }],
  ['卡：人物条目在角色定义后且 order 取模 1–8', () => {
    const e = findEntry(projectCard(fixtureProject()), '[人物] 周梦瑶');
    return e?.position === 'after_char' && e?.insertion_order === 1 && e?.extensions.position === 1;
  }],
  ['卡：人物栏目按 基础信息/生活结构/人物性情/场景表达/穿衣风格 顺序拼接并补标签', () => {
    const e = findEntry(projectCard(fixtureProject()), '[人物] 周梦瑶');
    return /<周梦瑶_基础信息>\n上海人。\n<\/周梦瑶_基础信息>/.test(e.content) && /<周梦瑶_人物性情>/.test(e.content) && e.content.indexOf('基础信息') < e.content.indexOf('人物性情');
  }],
  ['卡：规则条目命名为 [规则] 前缀', () => Boolean(findEntry(projectCard(fixtureProject()), '[规则] 称呼规则'))],
  ['卡：前端运行提示词条目 order 14810', () => findEntry(projectCard(fixtureProject()), '[界面] 消息前端运行提示词')?.insertion_order === 14810],
  ['卡：EJS 条目沿用 entryName 与 entryOrder', () => {
    const e = findEntry(projectCard(fixtureProject()), '[EJS] 状态');
    return e?.insertion_order === 3 && e?.position === 'after_char';
  }],
  ['卡：MVU 加载器与变量结构脚本注入', () => {
    const scripts = projectCard(fixtureProject()).data.extensions.tavern_helper.scripts;
    return scripts.some((s) => s.id === '961f366d-e403-45c2-8155-3d14ec86de53' && s.name === 'MVU')
      && scripts.some((s) => s.name === '墨月·变量结构' && s.id === stableId('proj-fixture-1', 'mvu-schema'));
  }],
  ['卡：变量清洗正则三条 + 状态栏显示正则注入', () => {
    const ids = projectCard(fixtureProject()).data.extensions.regex_scripts.map((r) => r.id);
    return ids.includes('136c29f6-6ef4-48d7-b5c1-11653d8b04ae') && ids.includes('0cb92e0f-b6b0-446d-a2c1-2d3894e3a6a7') && ids.includes('0fdb49d7-597d-4e6a-a247-fb2c57279969')
      && ids.some((id) => id === stableId('moyu-status-display', fixtureProject().statusbar.source));
  }],
  ['卡：前端显示正则按外层标签注入', () => {
    const tag = frontendOuterTag(fixtureProject());
    const ids = projectCard(fixtureProject()).data.extensions.regex_scripts.map((r) => r.id);
    return tag === 'moyu_ui' && ids.includes(stableId('proj-fixture-1', `frontend:${tag}`));
  }],
  ['卡：状态栏存在时首楼补占位符、空备用开场白被过滤', () => {
    const c = projectCard(fixtureProject());
    return /<StatusPlaceHolderImpl\/>/.test(c.data.first_mes) && c.data.alternate_greetings.length === 1;
  }],
  ['卡：内嵌世界书绑定与条目数量', () => {
    const c = projectCard(fixtureProject());
    return c.data.character_book.name === '异乡人·世界书' && c.data.extensions.world === '异乡人·世界书' && c.data.character_book.entries.length >= 8;
  }],
  ['卡：稳定 ID 可复现（同输入同输出）', () => stableId('p', 'ns') === stableId('p', 'ns') && stableId('p', 'ns') !== stableId('p2', 'ns')],
  ['卡：含工坊模块的作品能导出运行包（不再拒绝）', () => {
    const project = fixtureProject();
    const workshop = newProject('测试工坊');
    // messages 会带出 contacts 依赖与「墨月小手机·消息格式」配套条目（含 <moyu_phone>），
    // 因此同时覆盖运行包、配套世界书与手机显示正则三条路径。
    addModule(workshop, 'messages');
    for (const item of workshop.modules) writeSource(item, 'return { render(root){ root.textContent = "x"; } };', item.revision);
    workshop.id = 'w1';
    project.scriptProjects = [workshop];
    const card = projectCard(project);
    const scriptId = stableId('proj-fixture-1', 'workshop:w1');
    const scripts = card.data.extensions.tavern_helper.scripts;
    const regexes = card.data.extensions.regex_scripts;
    return scripts.some((s) => s.id === scriptId && s.name === '测试工坊')
      && card.data.character_book.entries.some((e) => e.extensions?.moyu_script_project === scriptId)
      && regexes.some((r) => r.id === stableId('proj-fixture-1', 'workshop-phone'));
  }],
  ['PNG：内嵌后可原样读回', () => {
    const card = projectCard(fixtureProject());
    const png = embedCharacterCard(new Uint8Array(ONE_PX_PNG), card);
    const back = readCharacterCard(png);
    return JSON.stringify(back) === JSON.stringify(card);
  }],
  ['PNG：重复内嵌不叠加旧 chara 块', () => {
    const card = projectCard(fixtureProject());
    const once = embedCharacterCard(new Uint8Array(ONE_PX_PNG), card);
    const twice = embedCharacterCard(once, card);
    return Buffer.from(twice).toString('base64') === Buffer.from(once).toString('base64');
  }],
  ['写入：世界书成品落地为可选规模条目', () => {
    const project = fixtureProject();
    const content = [
      '```text', '<新设定_设定>', '正文。', '</新设定_设定>', '```', '',
      '```yaml', '对应标签: <新设定_设定>', '条目名称: 新设定_设定', '启用: true', '激活策略: 绿灯',
      '关键词: 钟楼,钟声', '插入位置: 角色定义前', 'order: 60', '激活概率: 100', '```',
    ].join('\n');
    applyArtifact(project, { taskId: 'worldview_medium', content, title: '新设定' });
    const entry = project.worldbook.find((item) => item.title === '新设定_设定');
    return entry?.activation === 'keyword' && entry.keys.length === 2 && entry.order === 60 && entry.scale === 'medium';
  }],
  ['写入：校验未通过的稿件不能写入', () => {
    const project = fixtureProject();
    const content = '```text\n<缺配置_设定>\n正文\n</缺配置_设定>\n```';
    const review = workspaceArtifactReview(project, 'worldview_small', content);
    const blocked = review.diagnostics.filter((item) => item.severity === 'error').length > 0;
    let wrote = false;
    if (!blocked) { try { applyArtifact(project, { taskId: 'worldview_small', content, title: 'x' }); wrote = true; } catch { /* 也会被 applyArtifact 拦下 */ } }
    return blocked && !wrote;
  }],
  ['写入：整批 base 变更时拒绝', () => {
    const project = fixtureProject();
    const target = project.worldbook[0];
    const artifact = {
      batch: { section: 'worldbook', items: [{ taskId: 'worldview_small', targetId: target.id, title: target.title, content: '改后正文' }], base: { [target.id]: JSON.stringify({ title: target.title, content: '旧正文' }) } },
      confirmed: false,
    };
    try { applyPreparedArtifact(project, artifact); return false; } catch (error) { return /在生成后被修改或删除/.test(error.message); }
  }],
  ['文档：状态栏文档在含 Vue 时注入运行时', () => {
    const withVue = statusbarDocument('<html><head></head><body><div v-text="x"></div><script>Vue.createApp({}).mount("body")</script></body></html>');
    const plain = statusbarDocument('<html><head></head><body><script>1</script></body></html>');
    return withVue.includes('data-moyu-vue-runtime') && !plain.includes('data-moyu-vue-runtime');
  }],
  ['注册表：准备后进入待确认区且未标记已写入', () => {
    const rec = writePending(stateRoot, { taskId: 'worldview_small', title: '钟楼', content: WORLDVIEW_ENTRY, format: 'text' });
    const back = readPending(stateRoot, rec.id);
    return back.confirmed === false && listPending(stateRoot).some((item) => item.id === rec.id);
  }],
  ['注册表：确认写入后作品改变且标记落盘', () => {
    const project = fixtureProject();
    const rec = writePending(stateRoot, { taskId: 'worldview_medium', title: '钟楼', content: WORLDVIEW_ENTRY, format: 'text' });
    applyArtifact(project, { ...rec, content: WORLDVIEW_ENTRY, confirmed: false }, rec.targetId);
    rec.confirmed = true; rec.confirmedAt = 'now'; savePending(stateRoot, rec);
    return readPending(stateRoot, rec.id).confirmed === true && project.worldbook.some((entry) => entry.title === '钟楼_地区设定');
  }],
  ['注册表：已确认记录会被守卫拦下重复确认', () => {
    const rec = listPending(stateRoot).find((item) => item.confirmed === true);
    return Boolean(rec) && rec.confirmed === true;
  }],
  ['批量：两条世界书整组准备通过', () => {
    const project = fixtureProject();
    const prepared = prepareBatchArtifact(project, 'worldbook', [
      { taskId: 'worldview_small', title: '钟楼', content: WORLDVIEW_ENTRY },
      { taskId: 'worldview_small', title: '码头', content: WORLDVIEW_ENTRY.replace(/钟楼/g, '码头') },
    ]);
    return prepared.batch.items.length === 2 && prepared.title.includes('2 项');
  }],
  ['批量：同一目标重复提交被拒', () => {
    const project = fixtureProject();
    const target = project.worldbook[0];
    try {
      prepareBatchArtifact(project, 'worldbook', [
        { taskId: 'worldview_small', targetId: target.id, title: target.title, content: WORLDVIEW_ENTRY },
        { taskId: 'worldview_small', targetId: target.id, title: target.title, content: WORLDVIEW_ENTRY },
      ]);
      return false;
    } catch (error) { return /不能在一批中重复提交/.test(error.message); }
  }],
  ['批量：整批写入后两条都进作品', () => {
    const project = fixtureProject();
    const prepared = prepareBatchArtifact(project, 'worldbook', [
      { taskId: 'worldview_small', title: '钟楼', content: WORLDVIEW_ENTRY },
      { taskId: 'worldview_small', title: '码头', content: WORLDVIEW_ENTRY.replace(/钟楼/g, '码头') },
    ]);
    const artifact = { ...prepared, confirmed: false };
    applyPreparedArtifact(project, artifact);
    return project.worldbook.some((entry) => entry.title === '钟楼_地区设定')
      && project.worldbook.some((entry) => entry.title === '码头_地区设定')
      && artifact.confirmed === true;
  }],
  ['批量：MVU 三份不能一一对应时整组拒绝', () => {
    const project = fixtureProject();
    try {
      prepareBatchArtifact(project, 'mvu', [
        { taskId: 'mvu_initvar_formatting', title: '开局值', content: '```yaml\n主角:\n  金币: 0\n  声望: 0\n```' },
        { taskId: 'mvu_update_rule_formatting', title: '变化规则', content: '```yaml\n变量更新规则:\n  主角:\n    声望:\n      check: 当声望变化时\n      type: number\n```' },
      ]);
      return false;
    } catch (error) { return /整组核对未通过/.test(error.message); }
  }],
];

const WORLDVIEW_ENTRY = [
  '```text', '<钟楼_地区设定>', '钟楼只在整点报时，钟声能覆盖半个城区。', '</钟楼_地区设定>', '```', '',
  '```yaml', '对应标签: <钟楼_地区设定>', '条目名称: 钟楼_地区设定', '启用: true', '激活策略: 绿灯',
  '关键词: 钟楼,钟声', '插入位置: 角色定义前', 'order: 60', '激活概率: 100', '```',
].join('\n');

function selfTest() {
  const tempRoot = path2.join(HARNESS_ROOT, '状态', '_selftest');
  fs.rmSync(tempRoot, { recursive: true, force: true });
  fs.mkdirSync(tempRoot, { recursive: true });
  stateRoot = tempRoot;
  let failed = 0;
  for (const [name, run] of CASES) {
    let ok = false; let detail = '';
    try { ok = run() === true; } catch (error) { detail = String(error?.message ?? error); }
    if (!ok) failed += 1;
    console.log(`${ok ? '  ✓' : '  ✗'} ${name}${detail ? `  ← ${detail}` : ''}`);
  }
  stateRoot = HARNESS_ROOT;
  fs.rmSync(tempRoot, { recursive: true, force: true });
  console.log(`\n${failed ? '✗' : '✓'} 打包器自测 ${CASES.length - failed}/${CASES.length} 通过`);
  return failed ? 1 : 0;
}

// ── main ──────────────────────────────────────────────────────────────
function main() {
  const { flags } = parseArgs(process.argv.slice(2));
  if (flags['self-test']) return selfTest();

  if (flags.read) {
    const png = new Uint8Array(fs.readFileSync(path.resolve(flags['card-png'])));
    const card = readCharacterCard(png);
    if (!card) { console.error('这张 PNG 里没有 chara/ccv3 数据块'); return 1; }
    console.log(JSON.stringify(card, null, 2));
    return 0;
  }

  if (flags.card || flags.embed) {
    const project = readProject(flags.project);
    let card;
    try { card = projectCard(project); }
    catch (error) { console.error(`✗ 拒绝打包：${error.message}`); return 1; }
    if (flags.card) {
      const json = `${JSON.stringify(card, null, 2)}\n`;
      const out = writeOut(flags.out, json);
      if (out) console.log(`✓ 已写出角色卡 JSON：${out}`);
      else process.stdout.write(json);
      return 0;
    }
    const cover = flags.cover && flags.cover !== true
      ? new Uint8Array(fs.readFileSync(path.resolve(flags.cover)))
      : coverFromAssets(project);
    if (!cover) { console.error('✗ 没有可用封面：请用 --cover 指定 PNG，或在作品里设置 coverAssetId。'); return 2; }
    const png = embedCharacterCard(cover, card);
    const out = writeOut(flags.out, Buffer.from(png));
    if (out) console.log(`✓ 已写出内嵌角色卡：${out}（${png.length} 字节）`);
    else console.error('✗ 请用 --out 指定输出 PNG');
    return 0;
  }

  if (flags.list) {
    const items = listPending(stateRoot);
    if (!items.length) { console.log('（待确认区为空）'); return 0; }
    for (const item of items) {
      const kind = item.batch ? `批量·${item.batch.section}·${item.batch.items.length} 项` : '单份';
      console.log(`${item.confirmed ? '[已写入]' : '[待确认]'} ${item.id}\n          ${kind}｜${item.taskId}｜${item.title}`);
    }
    return 0;
  }

  // ── 清理待确认区（只清"尚未写入"的稿）─────────────────────────────
  if (flags.discard || flags['discard-all']) {
    if (flags['discard-all']) {
      const removed = discardUnconfirmed(stateRoot);
      console.log(removed.length ? `✓ 已清理 ${removed.length} 份未写入的待确认稿` : '（没有需要清理的未写入稿）');
      for (const id of removed) console.log(`  - ${id}`);
      const kept = listPending(stateRoot).filter((item) => item.confirmed);
      if (kept.length) console.log(`  保留 ${kept.length} 份已写入的凭据稿。`);
      return 0;
    }
    if (flags.discard === true) {
      console.error('✗ --discard 后面缺少待确认稿 id；用 --list 查看。要清空未写入的稿用 --discard-all。');
      return 2;
    }
    const id = flags.discard;
    const result = deletePending(stateRoot, id);
    if (!result.removed) { console.error(`✗ ${result.reason}`); return 1; }
    console.log(`✓ 已删除待确认稿：${id}`);
    return 0;
  }

  // ── 准备待确认稿（等价 moyu_prepare_artifact）──────────────────────
  if (flags.prepare) {
    const project = readProject(flags.project);
    const content = fs.readFileSync(path.resolve(flags.file), 'utf8');
    const taskId = requireFlag(flags.task, '--task');
    const target = optional(flags.target);
    const finalReview = rejectIfErrors(project, taskId, content);
    const record = writePending(stateRoot, {
      taskId,
      targetId: target,
      area: optional(flags.area),
      title: optional(flags.title) ?? `${taskId} · 待确认`,
      content: finalReview.content,
      format: optional(flags.format) ?? 'text',
      diagnostics: finalReview.diagnostics.filter((item) => item.severity !== 'error'),
    });
    console.log(`✓ 已放入待确认区：${record.id}`);
    console.log('  作品内容尚未改变。确认写入请运行：');
    console.log(`  node 工具/pack.mjs --apply --id ${record.id} --project <作品.json>`);
    return 0;
  }

  // ── 准备整批待确认稿（等价 moyu_prepare_batch）────────────────────
  if (flags['prepare-batch']) {
    const project = readProject(flags.project);
    const section = requireFlag(flags.section, '--section');
    const items = JSON.parse(fs.readFileSync(path.resolve(requireFlag(flags.items, '--items')), 'utf8'));
    let prepared;
    try { prepared = prepareBatchArtifact(project, section, items); }
    catch (error) { console.error(`✗ 整组检查未通过：${error.message}`); return 1; }
    const record = writePending(stateRoot, {
      // taskId 用 `batch-<section>` 而不是 `batch:<section>`：冒号进文件名会在 NTFS 上
      // 变成数据流分隔符（见 lib/pending.mjs 的 pendingId 注释）。
      taskId: `batch-${section}`,
      title: prepared.title,
      content: prepared.content,
      format: 'text',
      batch: prepared.batch,
      diagnostics: prepared.diagnostics?.filter((item) => item.severity !== 'error') ?? [],
    });
    console.log(`✓ 整组检查通过，已放入待确认区：${record.id}（${prepared.batch.items.length} 项）`);
    for (const item of prepared.batch.items) console.log(`  - ${item.title}`);
    console.log('  作品内容尚未改变。确认整批写入请运行：');
    console.log(`  node 工具/pack.mjs --apply --id ${record.id} --project <作品.json>`);
    return 0;
  }

  // ── 确认写入 ──────────────────────────────────────────────────────
  if (flags.apply) {
    if (flags.id === true) { console.error('✗ --apply --id 后面缺少待确认稿 id；用 --list 查看。'); return 2; }
    if (flags.id && flags.id !== true) {
      const project = readProject(flags.project);
      const record = readPending(stateRoot, flags.id);
      if (record.confirmed) { console.error(`✗ 这份内容已经写入过（${record.id}），不要重复确认。`); return 1; }
      if (record.batch) {
        try {
          const message = applyPreparedArtifact(project, { ...record, confirmed: false });
          record.confirmed = true; record.confirmedAt = new Date().toISOString();
          savePending(stateRoot, record);
          const out = writeOut(flags.out ?? flags.project, `${JSON.stringify(project, null, 2)}\n`);
          console.log(`✓ ${message}`); if (out) console.log(`  作品已更新：${out}`);
          return 0;
        } catch (error) { console.error(`✗ 整批写入失败：${error.message}`); return 1; }
      }
      // 单份：确认时再跑一次校验，防止待确认稿在等待期间被改坏。
      const review = workspaceArtifactReview(project, record.taskId, record.content, '');
      const errors = review.diagnostics.filter((item) => item.severity === 'error');
      if (errors.length) { console.error('✗ 这份待确认稿现在未通过校验，拒绝写入\n'); console.error(formatArtifactDiagnostics(review.diagnostics)); return 1; }
      try {
        const message = applyArtifact(project, { ...record, content: review.content, confirmed: false }, record.targetId);
        record.confirmed = true; record.confirmedAt = new Date().toISOString();
        savePending(stateRoot, record);
        const out = writeOut(flags.out ?? flags.project, `${JSON.stringify(project, null, 2)}\n`);
        console.log(`✓ ${message}`); if (out) console.log(`  作品已更新：${out}`);
        return 0;
      } catch (error) { console.error(`✗ 写入失败：${error.message}`); return 1; }
    }

    // 直接写入：跳过待确认区，仅用于人工即时操作；会明确提示。
    if (!flags.file || flags.file === true) {
      console.error('✗ --apply 需要 --id <待确认稿 id>（确认写入），或 --file <成品文件> --task <taskId>（跳过待确认区直接写入）。');
      return 2;
    }
    const project = readProject(flags.project);
    const content = fs.readFileSync(path.resolve(flags.file), 'utf8');
    const taskId = requireFlag(flags.task, '--task');
    const target = optional(flags.target);
    const finalReview = rejectIfErrors(project, taskId, content);
    console.log('· 注意：本次使用 --file 直接写入，跳过了待确认区。');
    try {
      const message = applyArtifact(project, {
        taskId, targetId: target, area: optional(flags.area),
        title: optional(flags.title) ?? `${taskId} · 待确认`, content: finalReview.content,
      }, target);
      const out = writeOut(flags.out ?? flags.project, `${JSON.stringify(project, null, 2)}\n`);
      console.log(`✓ ${message}`); if (out) console.log(`  作品已更新：${out}`);
      return 0;
    } catch (error) { console.error(`✗ 写入失败：${error.message}`); return 1; }
  }

  console.error('用法：--card | --embed | --read | --prepare | --prepare-batch | --list | --apply | --discard <id> | --discard-all | --self-test（详见文件头）');
  return 2;
}

function optional(value) { return value && value !== true ? value : undefined; }

function requireFlag(value, name) {
  if (!value || value === true) throw new Error(`缺少 ${name}`);
  return value;
}

/** 校验前置：有错误级问题就抛错（拒绝进入待确认区或写入）。 */
function rejectIfErrors(project, taskId, content) {
  const review = workspaceArtifactReview(project, taskId, content, '');
  const errors = review.diagnostics.filter((item) => item.severity === 'error');
  if (errors.length) {
    console.error('✗ 成品未通过本地校验，拒绝进入待确认区\n');
    console.error(formatArtifactDiagnostics(review.diagnostics));
    process.exit(1);
  }
  for (const item of review.diagnostics.filter((d) => d.severity === 'repair')) console.log(`· [本地已修] ${item.title}`);
  return review;
}

function coverFromAssets(project) {
  const asset = (project.assets ?? []).find((item) => item.id === project.coverAssetId);
  if (asset?.mediaType !== 'image/png' || !asset.dataUrl) return undefined;
  const comma = asset.dataUrl.indexOf(',');
  if (comma < 0 || !asset.dataUrl.slice(0, comma).includes(';base64')) return undefined;
  return new Uint8Array(Buffer.from(asset.dataUrl.slice(comma + 1), 'base64'));
}

process.exit(main());
