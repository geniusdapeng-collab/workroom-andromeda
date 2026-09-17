-- 0001_platform_accounts.sql —— 平台域账号体系（仙女座一方资产，不同步行业仓）
-- 三类表：真人运营（MFA 强制+分组授权）/ 数字员工服务账号 / break-glass 紧急介入

CREATE TABLE IF NOT EXISTS platform_operators (
  id              TEXT PRIMARY KEY,                   -- op-xxxxxxxx
  account_id      TEXT NOT NULL REFERENCES accounts(id),
  name            TEXT NOT NULL,
  scope_groups    JSONB NOT NULL DEFAULT '[]',        -- [{industry?, region?, cohort?}] 分组授权（百万家不列清单）
  capabilities    JSONB NOT NULL DEFAULT '[]',        -- health.view / ticket.handle / credit.adjust / package.deploy / breakglass
  mfa_required    BOOLEAN NOT NULL DEFAULT true,
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS service_accounts (         -- 平台数字员工操作主体（17+6 岗）
  id             TEXT PRIMARY KEY,                    -- sa-xxxxxxxx
  preset_id      TEXT NOT NULL UNIQUE,                -- billing-officer / account-steward / login-guard …
  capabilities   JSONB NOT NULL DEFAULT '[]',         -- 岗位能力白名单
  fence_profile  TEXT NOT NULL DEFAULT 'strict',      -- 围栏档位（只紧不松）
  status         TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS break_glass_sessions (     -- 紧急介入：客户预授权+双人+全留痕+事后报告
  id               TEXT PRIMARY KEY,
  tenant_id        TEXT NOT NULL,
  workspace_id     TEXT,
  reason           TEXT NOT NULL,
  operator_id      TEXT NOT NULL REFERENCES platform_operators(id),
  second_operator  TEXT NOT NULL REFERENCES platform_operators(id),  -- 双人复核
  customer_consent JSONB NOT NULL DEFAULT '{}',       -- 客户预授权协议快照
  started_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at         TIMESTAMPTZ,
  report_due_at    TIMESTAMPTZ NOT NULL,              -- 结束后 24h 内必须向客户推送报告
  report_sent_at   TIMESTAMPTZ,
  status           TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','closed','overdue'))
);

CREATE TABLE IF NOT EXISTS platform_action_log (      -- 平台在客户租户内动作（客户审计页可见=信任卖点）
  id           TEXT PRIMARY KEY,
  tenant_id    TEXT NOT NULL,
  workspace_id TEXT,
  actor_kind   TEXT NOT NULL CHECK (actor_kind IN ('operator','service_account','breakglass')),
  actor_id     TEXT NOT NULL,
  action       TEXT NOT NULL,                         -- ticket.reply / credit.adjust / package.deploy / breakglass.open …
  detail       JSONB NOT NULL DEFAULT '{}',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pal_tenant ON platform_action_log(tenant_id, created_at DESC);

-- 账号域运营台账（账号专员团队的工作面：异常/处置/复核）
CREATE TABLE IF NOT EXISTS account_ops_findings (
  id          TEXT PRIMARY KEY,
  kind        TEXT NOT NULL,   -- zombie-account / over-privileged / idle-grant / orphan-owner / login-anomaly / key-suspect / grant-expiring
  severity    TEXT NOT NULL DEFAULT 'p2' CHECK (severity IN ('p1','p2','p3')),
  domain      TEXT NOT NULL,   -- customer / partner / platform
  tenant_id   TEXT,
  subject     JSONB NOT NULL DEFAULT '{}',            -- {accountId/grantId/keyId/operatorId…}
  summary     TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','handled','dismissed')),
  handled_by  TEXT,                                   -- 处置者（sa-*/op-*）
  handled_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_aof_status ON account_ops_findings(status, severity, created_at DESC);
