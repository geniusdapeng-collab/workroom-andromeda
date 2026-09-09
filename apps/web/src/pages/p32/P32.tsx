/**
 * P32 · 账号运营中心（仙女座 · PRD §7 五看板 + 账号域健康日报 + 异常台账）
 */
import { useEffect, useState } from "react";
import { ensureDemoLogin, trpc } from "../../lib/trpc";

interface Overview { newAccounts: number; activeAccounts: number; totalTenants: number; newTenants: number }
interface Security { loginFails: number; locks: number; sessionRevokes: number; abnormalWorkspaces: { workspace_id: string; fails: number }[] }
interface Audit { zombieAccounts: unknown[]; expiringGrants: { id: string; partner_name: string; expires_at: string }[]; orphanWorkspaces: { tenant_id: string; workspace_id: string }[] }
interface Finding { id: string; kind: string; severity: string; summary: string; created_at: string }

export default function P32() {
  const [ov, setOv] = useState<Overview | null>(null);
  const [sec, setSec] = useState<Security | null>(null);
  const [audit, setAudit] = useState<Audit | null>(null);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [err, setErr] = useState("");

  const svc = () => trpc.accountOps as unknown as {
    boards: {
      overview: { query: () => Promise<Overview> };
      security: { query: () => Promise<Security> };
      permissionAudit: { query: () => Promise<Audit> };
    };
    findings: { list: { query: () => Promise<Finding[]> } };
  };

  useEffect(() => {
    void (async () => {
      await ensureDemoLogin();
      try {
        const [a, b, c, f] = await Promise.all([
          svc().boards.overview.query(), svc().boards.security.query(),
          svc().boards.permissionAudit.query(), svc().findings.list.query(),
        ]);
        setOv(a); setSec(b); setAudit(c); setFindings(f);
      } catch (e) { setErr(e instanceof Error ? e.message : "加载失败"); }
    })();
  }, []);

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-6 py-8">
      <h1 className="text-xl font-bold">账号运营中心</h1>
      <p className="text-sm text-neutral-400">三域账号的健康全景——账号专员数字员工团队每日巡检的同一数据源</p>
      {err && <p className="text-sm text-red-400">{err}</p>}

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {[
          { label: "新增账号（30d）", v: ov?.newAccounts },
          { label: "活跃账号（30d）", v: ov?.activeAccounts },
          { label: "租户总数", v: ov?.totalTenants },
          { label: "新增租户（30d）", v: ov?.newTenants },
        ].map((x) => (
          <div key={x.label} className="rounded-xl border border-neutral-800 bg-neutral-900 p-4 text-center">
            <div className="text-2xl font-bold text-emerald-400">{x.v ?? "—"}</div>
            <div className="mt-1 text-xs text-neutral-400">{x.label}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <section className={card}>
          <h2 className={h2}>安全看板（7d）</h2>
          <div className="mt-3 grid grid-cols-3 gap-2 text-center">
            <div><div className="text-xl font-bold text-amber-400">{sec?.loginFails ?? "—"}</div><div className="text-xs text-neutral-500">登录失败</div></div>
            <div><div className="text-xl font-bold text-red-400">{sec?.locks ?? "—"}</div><div className="text-xs text-neutral-500">锁定</div></div>
            <div><div className="text-xl font-bold text-neutral-300">{sec?.sessionRevokes ?? "—"}</div><div className="text-xs text-neutral-500">强制下线</div></div>
          </div>
          {(sec?.abnormalWorkspaces?.length ?? 0) > 0 && (
            <div className="mt-3 rounded-lg bg-red-900/20 p-3 text-xs text-red-300">
              失败率异常工作区：{sec!.abnormalWorkspaces.map((w) => `${w.workspace_id}(${w.fails})`).join("、")}
            </div>
          )}
        </section>

        <section className={card}>
          <h2 className={h2}>权限审计</h2>
          <div className="mt-3 space-y-1 text-sm">
            <div className="flex justify-between"><span>僵尸账号（90 天未登录）</span><b className="text-amber-400">{audit?.zombieAccounts.length ?? 0}</b></div>
            <div className="flex justify-between"><span>14 天内到期伙伴授权</span><b className="text-amber-400">{audit?.expiringGrants.length ?? 0}</b></div>
            <div className="flex justify-between"><span>owner 失联工作区</span><b className="text-red-400">{audit?.orphanWorkspaces.length ?? 0}</b></div>
          </div>
        </section>
      </div>

      <section className={card}>
        <h2 className={h2}>账号域异常台账（open · {findings.length}）</h2>
        {findings.length === 0 && <p className="mt-2 text-xs text-neutral-500">台账清爽——账号专员团队巡检无未决发现</p>}
        {findings.map((f) => (
          <div key={f.id} className="mt-2 flex items-center justify-between rounded-lg bg-neutral-800/60 px-4 py-2 text-sm">
            <div>
              <span className={`mr-2 rounded px-1.5 text-xs font-bold ${f.severity === "p1" ? "bg-red-600/30 text-red-300" : "bg-amber-600/20 text-amber-300"}`}>{f.severity.toUpperCase()}</span>
              <span>{f.summary}</span>
            </div>
            <span className="text-xs text-neutral-500">{new Date(f.created_at).toLocaleDateString("zh-CN")}</span>
          </div>
        ))}
      </section>
    </div>
  );
}

const card = "rounded-xl border border-neutral-800 bg-neutral-900 p-5";
const h2 = "text-sm font-bold text-neutral-200";
