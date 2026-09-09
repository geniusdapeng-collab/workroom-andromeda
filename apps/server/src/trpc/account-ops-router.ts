/**
 * trpc/account-ops-router —— 仙女座账号运营中心端点（五看板 + operator 管理 + break-glass + 账号域台账）
 * 平台域内部端点（health.view 能力守卫走 operator 校验的简化版：登录态+平台租户）。
 */
import { z } from "zod";
import { getAppPool } from "@workloom/db";
import {
  boardOverview, boardSecurity, boardPermissionAudit, boardPartners, boardSessionsKeys, accountHealthDaily,
} from "@workloom/platform-ops/accounts";
import {
  openBreakGlass, closeBreakGlass, overdueBreakGlassReports, logPlatformAction, newId,
} from "@workloom/platform-ops/accounts";
import { generateTotpSecret, totpUri, verifyTotp } from "@workloom/platform-ops/accounts";
import { router, protectedProcedure, writeProcedure } from "./context.js";

type Q = (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
const q: Q = (t, p) => getAppPool().query(t, p as never[]) as Promise<{ rows: Record<string, unknown>[] }>;

export const accountOpsRouter = router({
  boards: router({
    overview: protectedProcedure.input(z.object({ days: z.number().int().min(1).max(90).default(30) }).optional())
      .query(async ({ input }) => boardOverview(q, input?.days ?? 30)),
    security: protectedProcedure.input(z.object({ days: z.number().int().min(1).max(90).default(7) }).optional())
      .query(async ({ input }) => boardSecurity(q, input?.days ?? 7)),
    permissionAudit: protectedProcedure.query(async () => boardPermissionAudit(q)),
    partners: protectedProcedure.query(async () => boardPartners(q)),
    sessionsKeys: protectedProcedure.query(async () => boardSessionsKeys(q)),
    healthDaily: protectedProcedure.query(async () => accountHealthDaily(q)),
  }),

  operators: router({
    list: protectedProcedure.query(async () =>
      (await q(`SELECT id, account_id, name, scope_groups, capabilities, mfa_required, status, created_at FROM platform_operators ORDER BY created_at DESC`)).rows),

    register: writeProcedure
      .input(z.object({
        accountId: z.string(), name: z.string().min(1).max(50),
        scopeGroups: z.array(z.object({
          industry: z.string().optional(), region: z.string().optional(), cohort: z.string().optional(),
        })).min(1),
        capabilities: z.array(z.string()).min(1),
      }))
      .mutation(async ({ input }) => {
        const id = newId("op");
        await q(
          `INSERT INTO platform_operators (id, account_id, name, scope_groups, capabilities) VALUES ($1,$2,$3,$4,$5)`,
          [id, input.accountId, input.name, JSON.stringify(input.scopeGroups), JSON.stringify(input.capabilities)],
        );
        return { operatorId: id };
      }),

    /** TOTP 绑定（生成密钥+URI；账号持有人的 accounts.totp_secret 落库） */
    totpSetup: writeProcedure
      .input(z.object({ accountId: z.string(), email: z.string().email() }))
      .mutation(async ({ input }) => {
        const secret = generateTotpSecret();
        await q(`UPDATE accounts SET totp_secret=$2 WHERE id=$1`, [input.accountId, secret]);
        return { secret, uri: totpUri(secret, input.email) };
      }),

    totpVerify: protectedProcedure
      .input(z.object({ accountId: z.string(), code: z.string().length(6) }))
      .query(async ({ input }) => {
        const r = await q(`SELECT totp_secret FROM accounts WHERE id=$1`, [input.accountId]);
        const secret = r.rows[0]?.totp_secret as string | undefined;
        return { ok: !!secret && verifyTotp(secret, input.code) };
      }),
  }),

  breakglass: router({
    open: writeProcedure
      .input(z.object({
        tenantId: z.string(), workspaceId: z.string().optional(), reason: z.string().min(4).max(500),
        operatorId: z.string(), secondOperator: z.string(),
      }))
      .mutation(async ({ input }) => openBreakGlass(q, input)),

    close: writeProcedure
      .input(z.object({ sessionId: z.string(), operatorId: z.string() }))
      .mutation(async ({ input }) => { await closeBreakGlass(q, input.sessionId, input.operatorId); return { ok: true }; }),

    overdue: protectedProcedure.query(async () => overdueBreakGlassReports(q)),

    /** 报告发送（死线闭环：标记已推送客户） */
    reportSent: writeProcedure
      .input(z.object({ sessionId: z.string() }))
      .mutation(async ({ input }) => {
        await q(`UPDATE break_glass_sessions SET report_sent_at=now() WHERE id=$1`, [input.sessionId]);
        return { ok: true };
      }),
  }),

  /** 平台动作台账（写侧——跨租户动作的强制留痕点） */
  logAction: writeProcedure
    .input(z.object({
      tenantId: z.string(), workspaceId: z.string().optional(),
      actorKind: z.enum(["operator", "service_account", "breakglass"]),
      actorId: z.string(), action: z.string(), detail: z.record(z.string(), z.unknown()).optional(),
    }))
    .mutation(async ({ input }) => {
      await logPlatformAction(q, input);
      return { ok: true };
    }),

  /** 账号域异常台账 */
  findings: router({
    list: protectedProcedure
      .input(z.object({ status: z.enum(["open", "handled", "dismissed"]).default("open") }).optional())
      .query(async ({ input }) =>
        (await q(
          `SELECT * FROM account_ops_findings WHERE status=$1 ORDER BY severity, created_at DESC LIMIT 100`,
          [input?.status ?? "open"])).rows),

    handle: writeProcedure
      .input(z.object({ id: z.string(), handledBy: z.string(), verdict: z.enum(["handled", "dismissed"]) }))
      .mutation(async ({ input }) => {
        await q(
          `UPDATE account_ops_findings SET status=$2, handled_by=$3, handled_at=now() WHERE id=$1`,
          [input.id, input.verdict, input.handledBy],
        );
        return { ok: true };
      }),
  }),
});
