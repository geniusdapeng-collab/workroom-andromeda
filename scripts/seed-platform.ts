/**
 * seed-platform · 仙女座运营运维系统（platform 行业包）种子
 * 用法：DATABASE_URL=... tsx scripts/seed-platform.ts
 * 内容：demo 租户 / 「仙女座运营运维中心」工作区（is_example=true）/ 3 人类成员 /
 *      platform 17 preset 实例（平台客服长 FAE 领队）/ R-PL 基线围栏 / 技能安装 /
 *      业务种子（需求台账/工单台账/策略台账/客户健康/知识地图进知识库）/ 审批样例 /
 *      夜班编排 / 行业考题 / bundle_installs 装配台账登记（一键清空依据）
 * 口径：与 scripts/seed-aipm.ts 同构（平台包无 C 端服务前台种子——一方运营系统无 C 端剧本）
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import YAML from "yaml";

import { fileURLToPath } from "node:url";
const REPO_ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const BUNDLE_DIR = join(REPO_ROOT, "bundles/platform");
const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://postgres:workloom@localhost:5432/workloom";

const TENANT_ID = "demo";
const WS_ID = "ws-platform-demo";
const WS_SLUG = "platform-demo";
const WS_NAME = "仙女座运营运维中心（平台运营演示团队）";

interface Preset {
  preset_key: string; name: string; version: string; kind: string;
  description: string; readonly: boolean; night_shift: boolean; high_risk: boolean;
  fence_bindings: string[]; skills: string[];
  tools: Array<{ name: string; access: string; desc: string }>;
  prompt: Record<string, unknown>;
}
interface FenceRule { rule_id: string; name: string; level: string; match: Record<string, unknown>; when?: Record<string, unknown>; note?: string }
interface SkillDoc { name: string; description: string; body: string; fenceBindings: string[] }

function loadPresets(): Preset[] {
  const dir = join(BUNDLE_DIR, "presets");
  return readdirSync(dir).filter((f) => f.endsWith(".yml")).map((f) => YAML.parse(readFileSync(join(dir, f), "utf-8")) as Preset);
}
function loadFences(): FenceRule[] {
  const file = readdirSync(join(BUNDLE_DIR, "fences")).find((f) => f.endsWith(".yml"))!;
  const doc = YAML.parse(readFileSync(join(BUNDLE_DIR, "fences", file), "utf-8")) as { fences: FenceRule[] };
  return doc.fences;
}
function loadSkills(): SkillDoc[] {
  const dir = join(BUNDLE_DIR, "skills");
  return readdirSync(dir).map((d) => {
    const raw = readFileSync(join(dir, d, "SKILL.md"), "utf-8");
    const m = /^---\n([\s\S]*?)\n---/.exec(raw);
    const fm = m ? (YAML.parse(m[1]!) as { name: string; description: string }) : { name: d, description: "" };
    return { name: fm.name, description: fm.description, body: raw, fenceBindings: [] };
  });
}
function loadSeed<T>(file: string): T {
  return JSON.parse(readFileSync(join(BUNDLE_DIR, "seeds", file), "utf-8")) as T;
}

const MEMBERS = [
  { id: "MEM-001", name: "平台运营负责人", role: "owner" },
  { id: "MEM-002", name: "客户成功经理", role: "manager" },
  { id: "MEM-003", name: "值班工程师", role: "readonly" },
];

async function main(): Promise<void> {
  const presets = loadPresets();
  const fences = loadFences();
  const skillsDocs = loadSkills();
  console.log(`✓ platform Bundle 资产：${presets.length} preset / ${fences.length} 围栏 / ${skillsDocs.length} 技能`);

  const owner = new pg.Client({ connectionString: DATABASE_URL });
  await owner.connect();
  const q = (text: string, params: unknown[]) => owner.query(text, params);

  await q(`INSERT INTO tenants (id, name, plan) VALUES ($1,$2,'pro') ON CONFLICT (id) DO NOTHING`, [TENANT_ID, "仙女座演示租户"]);
  await q(
    `INSERT INTO workspaces (id, tenant_id, name, slug, industry, stage, night_config, bundle_id, is_example)
     VALUES ($1,$2,$3,$4,'platform','stable',$5,'platform',true) ON CONFLICT (id) DO UPDATE SET bundle_id='platform', is_example=true`,
    [WS_ID, TENANT_ID, WS_NAME, WS_SLUG, JSON.stringify({ enabled: true, candidateTime: "18:00", startTime: "22:00", packageTime: "08:30", timezone: "Asia/Shanghai" })],
  );
  console.log(`✓ 租户与工作区：demo / ${WS_NAME}（is_example=true）`);

  for (const m of MEMBERS) {
    await q(
      `INSERT INTO members (id, workspace_id, member_no, name, role)
       VALUES ($1,$2,$3,$4,$5) ON CONFLICT (workspace_id, member_no) DO NOTHING`,
      [`${m.id.toLowerCase()}-${WS_ID}-id`, WS_ID, m.id, m.name, m.role],
    );
  }
  console.log(`✓ 人类成员 ×${MEMBERS.length}`);

  for (const p of presets) {
    await q(
      `INSERT INTO agents (id, workspace_id, preset_key, name, version, kind, readonly, fence_bindings, skills, status, meta)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'ready',$10)
       ON CONFLICT (id) DO NOTHING`,
      [`agt-${p.preset_key}`, WS_ID, p.preset_key, p.name, p.version, p.kind, p.readonly,
       JSON.stringify(p.fence_bindings), JSON.stringify(p.skills),
       JSON.stringify({ description: p.description, night_shift: p.night_shift, high_risk: p.high_risk, tools: p.tools, prompt: p.prompt })],
    );
  }
  console.log(`✓ Agent 实例 ×${presets.length}（平台客服长领队的运营运维团队）`);

  for (const r of fences) {
    await q(
      `INSERT INTO fence_rules (id, rule_id, version, workspace_id, name, level, match_spec, action, is_baseline, status, created_by)
       VALUES ($1,$2,'v1',$3,$4,$5,$6,$7,false,'active','system:seed')
       ON CONFLICT (rule_id, version, workspace_id) DO NOTHING`,
      [`fr-${r.rule_id.toLowerCase()}-v1-${WS_ID}`, r.rule_id, WS_ID, r.name, r.level,
       JSON.stringify(r.match), JSON.stringify({ result: r.level === "auto" ? "pass" : r.level === "review" ? "review" : "blocked" })],
    );
  }
  console.log(`✓ 基线围栏 ×${fences.length}（platform-baseline/v1，active）`);

  for (const s of skillsDocs) {
    const skillId = `skill-${s.name}`;
    await q(
      `INSERT INTO skills (id, level, bundle, name, version, description, fence_bindings, body, desensitized)
       VALUES ($1,'official','platform',$2,'1.0.0',$3,'[]',$4,false)
       ON CONFLICT (id) DO UPDATE SET body=EXCLUDED.body, version=EXCLUDED.version
       WHERE skills.version IS DISTINCT FROM EXCLUDED.version`,
      [skillId, s.name, s.description, s.body],
    );
    await q(
      `INSERT INTO skill_installs (skill_id, workspace_id, installed_by, fence_bindings_snapshot, installed_version)
       SELECT s.id, $2, 'MEM-001', s.fence_bindings, s.version FROM skills s WHERE s.id=$1
       ON CONFLICT (skill_id, workspace_id) DO NOTHING`,
      [skillId, WS_ID],
    );
  }
  console.log(`✓ 技能 ×${skillsDocs.length} 已安装`);

  // —— 业务种子进知识库（需求台账/工单台账/策略台账/客户健康/知识地图/夜班编排） ——
  type Col = { name: string; desc: string; docs: () => Array<{ title: string; body: unknown }> };
  const colDefs: Col[] = [
    {
      name: "需求台账", desc: "客户需求分诊与流水线注入台账",
      docs: () => loadSeed<{ requirements: Array<Record<string, unknown>> }>("requirements.json")
        .requirements.map((x) => ({ title: `${x.id} ${x.title}`, body: x })),
    },
    {
      name: "工单台账", desc: "平台工单全域（意图/优先级/SLA/分派）",
      docs: () => loadSeed<{ tickets: Array<Record<string, unknown>> }>("tickets.json")
        .tickets.map((x) => ({ title: `${x.id} [${x.intent}] ${x.title}`, body: x })),
    },
    {
      name: "策略台账", desc: "运营策略（知识补缺/续约守护/健康干预）",
      docs: () => loadSeed<{ strategies: Array<Record<string, unknown>> }>("strategies.json")
        .strategies.map((x) => ({ title: `${x.strategy_id} ${x.type}`, body: x })),
    },
    {
      name: "客户健康", desc: "客户健康分维度模型与当前读数",
      docs: () => {
        const d = loadSeed<Record<string, unknown>>("health.json");
        return [{ title: "客户健康分模型（维度/权重/读数）", body: d }];
      },
    },
    {
      name: "知识地图", desc: "平台企业知识库集合与文档目录",
      docs: () => loadSeed<{ collections: Array<{ name: string; docs: string[] }> }>("kb.json")
        .collections.map((c) => ({ title: `知识集「${c.name}」（${c.docs.length} 篇）`, body: c })),
    },
    {
      name: "夜班编排", desc: "夜班自动作业时刻表（巡检/保鲜/对账/晨报）",
      docs: () => loadSeed<{ jobs: Array<Record<string, unknown>> }>("night-jobs.json")
        .jobs.map((x) => ({ title: `${x.time} ${x.task}`, body: x })),
    },
  ];
  for (const col of colDefs) {
    const colId = `kc-${WS_ID}-${col.name}`;
    await q(
      `INSERT INTO kb_collections (id, workspace_id, name, description) VALUES ($1,$2,$3,$4)
       ON CONFLICT (id) DO NOTHING`,
      [colId, WS_ID, col.name, col.desc],
    );
    const docs = col.docs();
    for (const [i, doc] of docs.entries()) {
      await q(
        `INSERT INTO kb_documents (id, workspace_id, collection_id, title, source_kind, source_url, version, status, content_md, hash, created_at)
         VALUES ($1,$2,$3,$4,'manual',NULL,1,'active',$5,$6,now())
         ON CONFLICT (id) DO NOTHING`,
        [`kd-${WS_ID}-${col.name}-${i}`, WS_ID, colId, doc.title, JSON.stringify(doc.body, null, 1), `seedhash-${col.name}-${i}`],
      );
    }
    console.log(`✓ 知识集「${col.name}」×${docs.length}`);
  }

  // —— 审批样例（seeds/approvals.json：R-PL 围栏命中的待裁决卡） ——
  const approvals = loadSeed<{ approvals: Array<Record<string, unknown>> }>("approvals.json");
  for (const [i, a] of approvals.approvals.entries()) {
    const evId = `ev-seed-platform-apr-${i}`;
    await q(
      `INSERT INTO biz_events (event_id, tenant_id, workspace_id, seq, payload, prev_hash, hash)
       VALUES ($1,$2,$3,(SELECT COALESCE(MAX(seq),0)+1 FROM biz_events WHERE workspace_id=$3),$4,'',$5)
       ON CONFLICT DO NOTHING`,
      [evId, TENANT_ID, WS_ID,
       JSON.stringify({
         who: { type: "agent", id: String(a.object ?? "platform-ops") },
         context: { tenant_id: TENANT_ID, workspace_id: WS_ID, time: new Date().toISOString(), channel: "inapp" },
         object: { type: "approval", id: `apr-seed-platform-${i}` },
         decision: { action: String(a.action ?? "review"), after: { title: a.summary, ai_advice: a.ai_advice } },
         rule_impact: [{ rule_id: a.rule ?? "R-PL", result: "review" }],
       }),
       `seedhash-${evId}`],
    );
    await q(
      `INSERT INTO approvals (approval_id, tenant_id, workspace_id, event_id, channel, status, gesture, snapshot, decided_by, decided_at)
       VALUES ($1,$2,$3,$4,'inapp','pending',NULL,$5,NULL,NULL)
       ON CONFLICT (event_id, channel) DO NOTHING`,
      [`apr-seed-platform-${i}`, TENANT_ID, WS_ID, evId,
       JSON.stringify({ action: a.action, after: { title: a.summary, ai_advice: a.ai_advice }, expires_at: new Date(Date.now() + 24 * 3600 * 1000).toISOString() })],
    );
  }
  console.log(`✓ 审批样例 ×${approvals.approvals.length}（pending）`);

  // 晨报由夜班节拍运行时真实生成（系统无静态晨报表）——不在种子内伪造
  console.log("✓ 晨报：运行时夜班生成（种子不伪造）");

  // —— 行业考题（考试院 platform 科目；eval/questions.json → eval_questions） ——
  try {
    const evalPack = JSON.parse(readFileSync(join(BUNDLE_DIR, "eval/questions.json"), "utf-8")) as { questions: Array<Record<string, unknown>> };
    for (const [i, qu] of evalPack.questions.entries()) {
      await q(
        `INSERT INTO eval_questions
           (id, workspace_id, subject, structure, primary_dimensions, red_line, difficulty, source, tags, scenario, assertions, judge_rubric, holdout)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'seed',$8,$9,$10,$11,false)
         ON CONFLICT (id) DO NOTHING`,
        [
          `evq-platform-seed-${i}`, WS_ID, qu.subject, qu.structure,
          JSON.stringify(qu.primary_dimensions), qu.red_line, qu.difficulty,
          JSON.stringify(qu.tags ?? []), JSON.stringify(qu.scenario),
          JSON.stringify(qu.assertions ?? []), qu.judgeRubric ? JSON.stringify(qu.judgeRubric) : null,
        ],
      );
    }
    console.log(`✓ 行业考题 ×${evalPack.questions.length}`);
  } catch (e) {
    console.log("  （行业考题注入跳过：", (e as Error).message.slice(0, 60), "）");
  }

  // —— bundle_installs 装配台账（一键清空的精确卸载依据） ——
  await q(
    `INSERT INTO bundle_installs (id, workspace_id, bundle_id, assets, status)
     VALUES ($1,$2,'platform',$3,'active')
     ON CONFLICT (id) DO NOTHING`,
    [`bi-${WS_ID}-platform`, WS_ID,
     JSON.stringify({
       preset_ids: presets.map((p) => `agt-${p.preset_key}`),
       fence_rule_ids: fences.map((r) => `fr-${r.rule_id.toLowerCase()}-v1-${WS_ID}`),
       skill_ids: skillsDocs.map((s) => `skill-${s.name}`),
       kb_collection_ids: colDefs.map((c) => `kc-${WS_ID}-${c.name}`),
       seed_batch_id: `seed-platform-${WS_ID}`,
     })],
  );
  console.log("✓ 装配台账登记（bundle_installs，清空可精确卸载）");

  await owner.end();
  console.log(`\n✅ platform 示例包装配完成：${WS_NAME}——打开客户端即见平台运营团队在岗`);
}

main().catch((e) => { console.error("seed-platform 失败:", e); process.exit(1); });
