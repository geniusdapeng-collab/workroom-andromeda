/**
 * 仙女座平台运营扩展：账号运营中心。
 *
 * 该页面属于 platform-bundle，不进入 WorkLoom IM 的受管客户端壳。页面能力由
 * Bundle 导航投影与服务端权限共同授权；这里仅负责呈现已经脱敏的运营汇总。
 */
import { useEffect, useState } from "react";
import { ensureDemoLogin, trpc } from "../../lib/trpc";

interface Overview {
  newAccounts: number;
  activeAccounts: number;
  totalTenants: number;
  newTenants: number;
}

interface Security {
  loginFails: number;
  locks: number;
  sessionRevokes: number;
  abnormalWorkspaces: { workspace_id: string; fails: number }[];
}

interface Audit {
  zombieAccounts: unknown[];
  expiringGrants: { id: string; partner_name: string; expires_at: string }[];
  orphanWorkspaces: { tenant_id: string; workspace_id: string }[];
}

interface Finding {
  id: string;
  kind: string;
  severity: string;
  summary: string;
  created_at: string;
}

const SEVERITY_LABELS: Readonly<Record<string, string>> = {
  p0: "紧急",
  p1: "高",
  p2: "中",
  p3: "低",
};

const FINDING_LABELS: Readonly<Record<string, string>> = {
  login_failure: "登录失败异常",
  account_lock: "账号锁定异常",
  stale_account: "长期未使用账号",
  expiring_grant: "伙伴授权即将到期",
  orphan_workspace: "工作区负责人失联",
};

function findingLabel(finding: Finding): string {
  return FINDING_LABELS[finding.kind] ?? "账号域异常";
}

function severityLabel(severity: string): string {
  return SEVERITY_LABELS[severity.toLowerCase()] ?? "待分级";
}

function severityTone(severity: string): string {
  const normalized = severity.toLowerCase();
  if (normalized === "p0" || normalized === "p1") return "bg-red-600/30 text-red-300";
  if (normalized === "p2") return "bg-amber-600/20 text-amber-300";
  return "bg-neutral-700 text-neutral-300";
}

function safeErrorText(error: unknown): string {
  if (error instanceof DOMException && error.name === "AbortError") return "请求已取消，请重试。";
  return "账号运营数据暂时无法加载，请稍后重试。";
}

export default function AccountOperations() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [security, setSecurity] = useState<Security | null>(null);
  const [audit, setAudit] = useState<Audit | null>(null);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [errorText, setErrorText] = useState("");
  const [loading, setLoading] = useState(true);
  const [reloadToken, setReloadToken] = useState(0);

  const service = () => trpc.accountOps as unknown as {
    boards: {
      overview: { query: () => Promise<Overview> };
      security: { query: () => Promise<Security> };
      permissionAudit: { query: () => Promise<Audit> };
    };
    findings: { list: { query: () => Promise<Finding[]> } };
  };

  useEffect(() => {
    void (async () => {
      setLoading(true);
      setErrorText("");
      try {
        await ensureDemoLogin();
        const [nextOverview, nextSecurity, nextAudit, nextFindings] = await Promise.all([
          service().boards.overview.query(),
          service().boards.security.query(),
          service().boards.permissionAudit.query(),
          service().findings.list.query(),
        ]);
        setOverview(nextOverview);
        setSecurity(nextSecurity);
        setAudit(nextAudit);
        setFindings(nextFindings);
      } catch (error) {
        setErrorText(safeErrorText(error));
      } finally {
        setLoading(false);
      }
    })();
  }, [reloadToken]);

  const abnormalLoginFailures = security?.abnormalWorkspaces.reduce((sum, item) => sum + item.fails, 0) ?? 0;

  return (
    <main className="mx-auto max-w-5xl space-y-6 px-6 py-8" aria-busy={loading} aria-labelledby="account-operations-title">
      <header>
        <h1 id="account-operations-title" className="text-xl font-bold">账号运营中心</h1>
        <p className="mt-1 text-sm text-neutral-400">查看账号、租户、安全和权限健康状况；所有结果来自账号专员团队的同一巡检数据源。</p>
      </header>
      {loading && <p role="status" className="text-sm text-neutral-400">正在加载账号运营数据…</p>}
      {errorText && (
        <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-red-400">
          <span className="min-w-0 break-words">{errorText}</span>
          <button
            type="button"
            className="shrink-0 rounded-lg border border-red-500/50 px-3 py-1 text-red-200 hover:bg-red-900/30"
            onClick={() => setReloadToken((current) => current + 1)}
          >
            重新加载
          </button>
        </div>
      )}

      <section aria-label="账号运营概览" className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {[
          { label: "近 30 天新增账号", value: overview?.newAccounts },
          { label: "近 30 天活跃账号", value: overview?.activeAccounts },
          { label: "租户总数", value: overview?.totalTenants },
          { label: "近 30 天新增租户", value: overview?.newTenants },
        ].map((item) => (
          <div key={item.label} className="min-w-0 rounded-xl border border-neutral-800 bg-neutral-900 p-4 text-center">
            <div className="text-2xl font-bold text-emerald-400">{item.value ?? "—"}</div>
            <div className="mt-1 break-words text-xs leading-5 text-neutral-400">{item.label}</div>
          </div>
        ))}
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        <section className={card} aria-labelledby="security-board-title">
          <h2 id="security-board-title" className={heading}>近 7 天安全看板</h2>
          <div className="mt-3 grid grid-cols-3 gap-2 text-center">
            <div className="min-w-0"><div className="text-xl font-bold text-amber-400">{security?.loginFails ?? "—"}</div><div className="break-words text-xs text-neutral-500">登录失败</div></div>
            <div className="min-w-0"><div className="text-xl font-bold text-red-400">{security?.locks ?? "—"}</div><div className="break-words text-xs text-neutral-500">账号锁定</div></div>
            <div className="min-w-0"><div className="text-xl font-bold text-neutral-300">{security?.sessionRevokes ?? "—"}</div><div className="break-words text-xs text-neutral-500">强制下线</div></div>
          </div>
          {(security?.abnormalWorkspaces.length ?? 0) > 0 && (
            <p className="mt-3 break-words rounded-lg bg-red-900/20 p-3 text-xs leading-5 text-red-300">
              {security!.abnormalWorkspaces.length} 个工作区出现登录失败异常，累计 {abnormalLoginFailures} 次。
            </p>
          )}
        </section>

        <section className={card} aria-labelledby="permission-audit-title">
          <h2 id="permission-audit-title" className={heading}>权限审计</h2>
          <div className="mt-3 space-y-2 text-sm">
            <div className="flex min-w-0 justify-between gap-3"><span className="min-w-0 break-words">90 天未登录账号</span><b className="shrink-0 text-amber-400">{audit?.zombieAccounts.length ?? 0}</b></div>
            <div className="flex min-w-0 justify-between gap-3"><span className="min-w-0 break-words">14 天内到期伙伴授权</span><b className="shrink-0 text-amber-400">{audit?.expiringGrants.length ?? 0}</b></div>
            <div className="flex min-w-0 justify-between gap-3"><span className="min-w-0 break-words">负责人失联工作区</span><b className="shrink-0 text-red-400">{audit?.orphanWorkspaces.length ?? 0}</b></div>
          </div>
        </section>
      </div>

      <section className={card} aria-labelledby="account-findings-title">
        <h2 id="account-findings-title" className={heading}>账号域未决异常（{findings.length}）</h2>
        {findings.length === 0 && <p className="mt-2 text-xs leading-5 text-neutral-500">当前没有未决账号异常。</p>}
        {findings.map((finding) => (
          <div key={finding.id} className="mt-2 flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-lg bg-neutral-800/60 px-4 py-2 text-sm">
            <div className="flex min-w-0 items-center gap-2">
              <span className={`shrink-0 rounded px-1.5 text-xs font-bold ${severityTone(finding.severity)}`}>
                {severityLabel(finding.severity)}
              </span>
              <span className="min-w-0 break-words">{findingLabel(finding)}</span>
            </div>
            <time className="shrink-0 text-xs text-neutral-500" dateTime={finding.created_at}>
              {new Date(finding.created_at).toLocaleDateString("zh-CN")}
            </time>
          </div>
        ))}
      </section>
    </main>
  );
}

const card = "min-w-0 rounded-xl border border-neutral-800 bg-neutral-900 p-5";
const heading = "break-words text-sm font-bold text-neutral-200";
