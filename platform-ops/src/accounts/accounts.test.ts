/**
 * 平台域账号测试：TOTP RFC6238 往返 / 分组授权 / break-glass 双人纪律 / 五看板投影（fake db）
 */
import { describe, expect, it } from "vitest";
import { generateTotpSecret, totpCode, verifyTotp, totpUri } from "./totp.js";
import { checkOperatorScope, openBreakGlass, closeBreakGlass, overdueBreakGlassReports, logPlatformAction, newId } from "./operators.js";
import { accountHealthDaily } from "./dashboards.js";
import type { QueryFn } from "./totp-db.js";

/* ---------- 超轻 fake db（按 SQL 特征路由到内存表） ---------- */
function fakeDb(seed: {
  operators?: Record<string, unknown>[];
  tenants?: Record<string, unknown>[];
}): { q: QueryFn; tables: Map<string, Record<string, unknown>[]> } {
  const tables = new Map<string, Record<string, unknown>[]>([
    ["platform_operators", [...(seed.operators ?? [])]],
    ["tenants", [...(seed.tenants ?? [])]],
    ["break_glass_sessions", []],
    ["platform_action_log", []],
  ]);
  const q: QueryFn = async (text, params = []) => {
    const t = tables;
    if (text.includes("FROM platform_operators WHERE id=")) {
      return { rows: t.get("platform_operators")!.filter((r) => r.id === params[0]) };
    }
    if (text.includes("FROM tenants WHERE id=")) {
      return { rows: t.get("tenants")!.filter((r) => r.id === params[0]) };
    }
    if (text.startsWith("INSERT INTO break_glass_sessions")) {
      t.get("break_glass_sessions")!.push({
        id: params[0], tenant_id: params[1], workspace_id: params[2], reason: params[3],
        operator_id: params[4], second_operator: params[5], customer_consent: params[6],
        report_due_at: params[7], status: "active", report_sent_at: null, ended_at: null,
      });
      return { rows: [] };
    }
    if (text.startsWith("UPDATE break_glass_sessions SET ended_at")) {
      const rows = t.get("break_glass_sessions")!;
      const s = rows.find((r) => r.id === params[0] && r.operator_id === params[1]);
      if (s) { s.ended_at = new Date().toISOString(); s.status = "closed"; }
      return { rows: [] };
    }
    if (text.startsWith("INSERT INTO platform_action_log")) {
      t.get("platform_action_log")!.push({ id: params[0], tenant_id: params[1], action: params[5] });
      return { rows: [] };
    }
    if (text.includes("FROM break_glass_sessions")) return { rows: t.get("break_glass_sessions")! };
    // 看板聚合查询：返回固定一行
    return { rows: [{ c: 0, total: 0, recent: 0, never_used: 0, revoked: 0 }] };
  };
  return { q, tables };
}

describe("TOTP（RFC 6238）", () => {
  it("生成密钥→出码→验证通过；错码拒绝；容忍 ±30s 漂移", () => {
    const secret = generateTotpSecret();
    expect(secret.length).toBeGreaterThanOrEqual(20);
    const t = Date.now();
    const code = totpCode(secret, t);
    expect(code).toMatch(/^\d{6}$/);
    expect(verifyTotp(secret, code, t)).toBe(true);
    expect(verifyTotp(secret, code, t + 25_000)).toBe(true);  // 窗内漂移
    expect(verifyTotp(secret, "000000", t)).toBe(false);
  });

  it("otpauth URI 可扫码绑定", () => {
    expect(totpUri("ABC123", "op@workloom")).toContain("otpauth://totp/");
  });
});

describe("平台分组授权", () => {
  const op = { id: "op-1", scope_groups: [{ industry: "hotel" }], capabilities: ["health.view", "ticket.handle"], status: "active" };

  it("组内行业+持能力=放行；行业不符/能力未持/账号停用=拒绝", async () => {
    const { q } = fakeDb({ operators: [op], tenants: [{ id: "t-hotel", industry: "hotel" }, { id: "t-ecom", industry: "ecommerce" }] });
    expect((await checkOperatorScope(q, { operatorId: "op-1", tenantId: "t-hotel", capability: "ticket.handle" })).ok).toBe(true);
    expect((await checkOperatorScope(q, { operatorId: "op-1", tenantId: "t-ecom", capability: "ticket.handle" })).ok).toBe(false);
    expect((await checkOperatorScope(q, { operatorId: "op-1", tenantId: "t-hotel", capability: "breakglass" })).ok).toBe(false);
    const { q: q2 } = fakeDb({ operators: [{ ...op, status: "disabled" }], tenants: [{ id: "t-hotel", industry: "hotel" }] });
    expect((await checkOperatorScope(q2, { operatorId: "op-1", tenantId: "t-hotel", capability: "ticket.handle" })).ok).toBe(false);
  });

  it("空 scope_groups = 未授权任何范围（安全默认）", async () => {
    const { q } = fakeDb({ operators: [{ ...op, scope_groups: [] }], tenants: [{ id: "t-hotel", industry: "hotel" }] });
    expect((await checkOperatorScope(q, { operatorId: "op-1", tenantId: "t-hotel", capability: "health.view" })).ok).toBe(false);
  });
});

describe("break-glass 双人纪律", () => {
  const opA = { id: "op-a", scope_groups: [{ industry: "hotel" }], capabilities: ["breakglass"], status: "active" };
  const opB = { id: "op-b", scope_groups: [{ industry: "hotel" }], capabilities: ["breakglass"], status: "active" };

  it("开启需双人均持 breakglass 且不得同人；动作写入客户可见日志", async () => {
    const { q, tables } = fakeDb({ operators: [opA, opB], tenants: [{ id: "t-1", industry: "hotel" }] });
    await expect(openBreakGlass(q, { tenantId: "t-1", reason: "x", operatorId: "op-a", secondOperator: "op-a" }))
      .rejects.toThrow("双人");
    const r = await openBreakGlass(q, { tenantId: "t-1", reason: "无人酒店夜间应急", operatorId: "op-a", secondOperator: "op-b" });
    expect(r.sessionId).toBeTruthy();
    expect(new Date(r.reportDueAt).getTime() - Date.now()).toBeGreaterThan(23 * 3600e3);
    const log = tables.get("platform_action_log")!;
    expect(log.some((l) => l.action === "breakglass.open" && l.tenant_id === "t-1")).toBe(true);
  });

  it("无 breakglass 能力者不得开启；关闭后报告死线巡检可追", async () => {
    const { q, tables } = fakeDb({ operators: [opA, { ...opB, capabilities: [] }], tenants: [{ id: "t-1", industry: "hotel" }] });
    await expect(openBreakGlass(q, { tenantId: "t-1", reason: "x", operatorId: "op-a", secondOperator: "op-b" }))
      .rejects.toThrow("breakglass");
    // 关闭流程
    const { q: q2, tables: t2 } = fakeDb({ operators: [opA, opB], tenants: [{ id: "t-1", industry: "hotel" }] });
    const r = await openBreakGlass(q2, { tenantId: "t-1", reason: "应急", operatorId: "op-a", secondOperator: "op-b" });
    await closeBreakGlass(q2, r.sessionId, "op-a");
    expect(t2.get("break_glass_sessions")![0]!.status).toBe("closed");
    // 死线已过且未报告 → 巡检命中
    t2.get("break_glass_sessions")![0]!.report_due_at = new Date(Date.now() - 1000).toISOString();
    const overdue = await overdueBreakGlassReports(q2);
    expect(overdue.length).toBe(1);
  });
});

describe("账号域健康日报", () => {
  it("四格结构齐全（增长/安全/审计）", async () => {
    const { q } = fakeDb({});
    const daily = await accountHealthDaily(q);
    expect(daily).toHaveProperty("growth");
    expect(daily).toHaveProperty("security");
    expect(daily).toHaveProperty("audit");
    expect(daily.audit).toHaveProperty("zombieAccounts");
  });
});
