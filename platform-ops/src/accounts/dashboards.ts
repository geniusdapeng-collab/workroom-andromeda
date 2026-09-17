/**
 * accounts/dashboards —— 平台侧账号管理五看板（PRD §7）
 * 全部按 cohort 分组、可下钻单租户；数据源=事件/台账投影，与客户审计页同源。
 */
import type { QueryFn } from "./totp-db.js";

/** 看板一：账号大盘（注册/活跃/留存漏斗） */
export async function boardOverview(q: QueryFn, days = 30) {
  const since = new Date(Date.now() - days * 24 * 3600e3).toISOString();
  const [registered, active, tenants] = await Promise.all([
    q(`SELECT count(*)::int AS c FROM accounts WHERE created_at > $1`, [since]),
    q(`SELECT count(DISTINCT account_id)::int AS c FROM login_events WHERE kind='login.ok' AND created_at > $1`, [since]),
    q(`SELECT count(*)::int AS total, count(*) FILTER (WHERE created_at > $1)::int AS recent FROM tenants`, [since]),
  ]);
  return {
    days,
    newAccounts: registered.rows[0]!.c,
    activeAccounts: active.rows[0]!.c,
    totalTenants: tenants.rows[0]!.total,
    newTenants: tenants.rows[0]!.recent,
  };
}

/** 看板二：安全看板（异常登录/爆破锁定/强制下线；组级失败率预警） */
export async function boardSecurity(q: QueryFn, days = 7) {
  const since = new Date(Date.now() - days * 24 * 3600e3).toISOString();
  const [fails, locks, revokes, byWs] = await Promise.all([
    q(`SELECT count(*)::int AS c FROM login_events WHERE kind='login.fail' AND created_at > $1`, [since]),
    q(`SELECT count(*)::int AS c FROM login_events WHERE kind='login.locked' AND created_at > $1`, [since]),
    q(`SELECT count(*)::int AS c FROM login_events WHERE kind='session.revoked' AND created_at > $1`, [since]),
    q(`SELECT workspace_id, count(*)::int AS fails FROM login_events
       WHERE kind='login.fail' AND created_at > $1 AND workspace_id IS NOT NULL
       GROUP BY workspace_id HAVING count(*) > 20 ORDER BY fails DESC LIMIT 10`, [since]),
  ]);
  return {
    days,
    loginFails: fails.rows[0]!.c,
    locks: locks.rows[0]!.c,
    sessionRevokes: revokes.rows[0]!.c,
    abnormalWorkspaces: byWs.rows, // 失败率突增的工作区（批量事故预警）
  };
}

/** 看板三：权限审计（僵尸账号/超权/闲置 grant/owner 失联） */
export async function boardPermissionAudit(q: QueryFn) {
  const [zombies, idleGrants, orphanTenants] = await Promise.all([
    q(`SELECT a.id, a.phone, a.last_login_at FROM accounts a
       WHERE a.status='active' AND (a.last_login_at IS NULL OR a.last_login_at < now() - interval '90 days')
       ORDER BY a.last_login_at NULLS FIRST LIMIT 50`, []),
    q(`SELECT g.id, g.tenant_id, p.name AS partner_name, g.expires_at FROM partner_grants g
       JOIN partners p ON p.id=g.partner_id
       WHERE g.revoked_at IS NULL AND g.expires_at < now() + interval '14 days'
       ORDER BY g.expires_at LIMIT 50`, []),
    q(`SELECT w.tenant_id, w.id AS workspace_id FROM workspaces w
       WHERE NOT EXISTS (
         SELECT 1 FROM members m WHERE m.workspace_id=w.id AND m.role='owner' AND m.status='active'
       ) LIMIT 50`, []),
  ]);
  return {
    zombieAccounts: zombies.rows,        // 90 天未登录
    expiringGrants: idleGrants.rows,     // 14 天内到期的伙伴授权
    orphanWorkspaces: orphanTenants.rows, // 无有效 owner 的工作区（owner 失联）
  };
}

/** 看板四：伙伴授权台账（全平台视角 + 异常动作） */
export async function boardPartners(q: QueryFn, days = 30) {
  const since = new Date(Date.now() - days * 24 * 3600e3).toISOString();
  const [issued, revoked, active, byType] = await Promise.all([
    q(`SELECT count(*)::int AS c FROM partner_grants WHERE issued_at > $1`, [since]),
    q(`SELECT count(*)::int AS c FROM partner_grants WHERE revoked_at > $1`, [since]),
    q(`SELECT count(*)::int AS c FROM partner_grants WHERE revoked_at IS NULL AND expires_at > now()`, []),
    q(`SELECT p.type, count(*)::int AS c FROM partner_grants g JOIN partners p ON p.id=g.partner_id
       WHERE g.revoked_at IS NULL AND g.expires_at > now() GROUP BY p.type`, []),
  ]);
  return {
    days,
    issued: issued.rows[0]!.c,
    revoked: revoked.rows[0]!.c,
    active: active.rows[0]!.c,
    activeByType: byType.rows,
  };
}

/** 看板五：会话与密钥（活跃会话/API key 使用与闲置/泄露嫌疑） */
export async function boardSessionsKeys(q: QueryFn) {
  const [sessions, keys, suspectKeys, bgOverdue] = await Promise.all([
    q(`SELECT count(*)::int AS c FROM auth_sessions WHERE revoked_at IS NULL AND expires_at > now()`, []),
    q(`SELECT count(*)::int AS total,
             count(*) FILTER (WHERE last_used_at IS NULL)::int AS never_used,
             count(*) FILTER (WHERE revoked_at IS NOT NULL)::int AS revoked
       FROM api_keys`, []),
    q(`SELECT id, workspace_id, name, key_prefix, last_used_at FROM api_keys
       WHERE revoked_at IS NULL AND last_used_at > now() - interval '1 day'
       ORDER BY last_used_at DESC LIMIT 20`, []), // 高频使用=基线监控对象（泄露嫌疑由 key-custodian 深扫）
    q(`SELECT count(*)::int AS c FROM break_glass_sessions
       WHERE status IN ('active','closed') AND report_sent_at IS NULL AND report_due_at < now()`, []),
  ]);
  return {
    activeSessions: sessions.rows[0]!.c,
    apiKeys: keys.rows[0],
    recentlyUsedKeys: suspectKeys.rows,
    overdueBreakGlassReports: bgOverdue.rows[0]!.c,
  };
}

/** 账号域健康日报（账号专员晨报四格） */
export async function accountHealthDaily(q: QueryFn) {
  const [ov, sec, audit] = await Promise.all([
    boardOverview(q, 1), boardSecurity(q, 1), boardPermissionAudit(q),
  ]);
  return {
    date: new Date().toISOString().slice(0, 10),
    growth: { newAccounts: ov.newAccounts, newTenants: ov.newTenants },
    security: { loginFails: sec.loginFails, locks: sec.locks },
    audit: {
      zombieAccounts: audit.zombieAccounts.length,
      expiringGrants: audit.expiringGrants.length,
      orphanWorkspaces: audit.orphanWorkspaces.length,
    },
  };
}
