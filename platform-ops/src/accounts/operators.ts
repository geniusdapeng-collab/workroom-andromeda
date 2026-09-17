/**
 * accounts/operators —— 平台域授权校验、break-glass 流程、平台动作留痕（写即客户可见）
 */
import type { QueryFn } from "./totp-db.js";
import { randomBytes } from "node:crypto";

export const OPERATOR_CAPABILITIES = [
  "health.view",      // 健康度查看（全员）
  "ticket.handle",    // 工单处理（持证组）
  "credit.adjust",    // 积分调整（持证组）
  "package.deploy",   // 行业包发布（发布组）
  "breakglass",       // 紧急介入（单独授权）
] as const;
export type OperatorCapability = (typeof OPERATOR_CAPABILITIES)[number];

export const newId = (p: string) => `${p}-${randomBytes(8).toString("hex")}`;

export interface Cohort { industry?: string; region?: string; cohort?: string }

/** 分组授权校验：operator 的 scope_groups 是否覆盖目标租户（组为空=未授权任何范围，安全默认） */
export async function checkOperatorScope(
  q: QueryFn,
  input: { operatorId: string; tenantId: string; capability: OperatorCapability },
): Promise<{ ok: boolean; reason?: string }> {
  const r = await q(
    `SELECT scope_groups, capabilities, status FROM platform_operators WHERE id=$1`,
    [input.operatorId],
  );
  const op = r.rows[0];
  if (!op || op.status !== "active") return { ok: false, reason: "运营账号不存在或已停用" };
  if (!(op.capabilities as string[]).includes(input.capability)) {
    return { ok: false, reason: `未持有能力 ${input.capability}` };
  }
  const t = await q(`SELECT industry FROM tenants WHERE id=$1`, [input.tenantId]).catch(() => ({ rows: [] as Record<string, unknown>[] }));
  const groups = op.scope_groups as Cohort[];
  const tenantIndustry = (t.rows[0]?.industry as string | undefined) ?? undefined;
  const covered = groups.some((g) =>
    (!g.industry || g.industry === tenantIndustry) &&
    (!g.cohort || false), // cohort 匹配在租户打标后启用（B.3 规模分层）
  );
  if (!covered) return { ok: false, reason: "目标租户不在您的负责分组内" };
  return { ok: true };
}

/** 平台动作留痕（客户审计页可见；每次跨租户动作必须调用——双向透明纪律） */
export async function logPlatformAction(
  q: QueryFn,
  e: { tenantId: string; workspaceId?: string; actorKind: "operator" | "service_account" | "breakglass"; actorId: string; action: string; detail?: Record<string, unknown> },
): Promise<void> {
  await q(
    `INSERT INTO platform_action_log (id, tenant_id, workspace_id, actor_kind, actor_id, action, detail)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [newId("pal"), e.tenantId, e.workspaceId ?? null, e.actorKind, e.actorId, e.action, JSON.stringify(e.detail ?? {})],
  );
}

/** 开启 break-glass（双人+留痕+24h 报告死线） */
export async function openBreakGlass(
  q: QueryFn,
  input: {
    tenantId: string; workspaceId?: string; reason: string;
    operatorId: string; secondOperator: string; consent?: Record<string, unknown>;
  },
): Promise<{ sessionId: string; reportDueAt: string }> {
  if (input.operatorId === input.secondOperator) throw new Error("break-glass 必须双人复核（不能是自己）");
  for (const opId of [input.operatorId, input.secondOperator]) {
    const chk = await checkOperatorScope(q, { operatorId: opId, tenantId: input.tenantId, capability: "breakglass" });
    if (!chk.ok) throw new Error(`运营 ${opId} 无 breakglass 授权：${chk.reason}`);
  }
  const id = newId("bg");
  const due = new Date(Date.now() + 24 * 3600e3);
  await q(
    `INSERT INTO break_glass_sessions (id, tenant_id, workspace_id, reason, operator_id, second_operator, customer_consent, report_due_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [id, input.tenantId, input.workspaceId ?? null, input.reason, input.operatorId, input.secondOperator,
     JSON.stringify(input.consent ?? {}), due.toISOString()],
  );
  await logPlatformAction(q, {
    tenantId: input.tenantId, workspaceId: input.workspaceId, actorKind: "breakglass",
    actorId: input.operatorId, action: "breakglass.open",
    detail: { sessionId: id, reason: input.reason, second: input.secondOperator },
  });
  return { sessionId: id, reportDueAt: due.toISOString() };
}

export async function closeBreakGlass(q: QueryFn, sessionId: string, operatorId: string): Promise<void> {
  await q(
    `UPDATE break_glass_sessions SET ended_at=now(), status='closed' WHERE id=$1 AND operator_id=$2 AND status='active'`,
    [sessionId, operatorId],
  );
}

/** 报告死线巡检（账号专员-密钥保管员的日扫对象：超期未报=overdue 工单） */
export async function overdueBreakGlassReports(q: QueryFn) {
  const r = await q(
    `SELECT id, tenant_id, operator_id, report_due_at FROM break_glass_sessions
     WHERE status IN ('active','closed') AND report_sent_at IS NULL AND report_due_at < now()`,
    [],
  );
  return r.rows;
}
