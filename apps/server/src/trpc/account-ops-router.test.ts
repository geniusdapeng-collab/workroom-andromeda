import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Identity } from "@workloom/base/tenancy";

const { currentMemberAuthority, resolveAuthoritativeClientAccess, dbQuery } = vi.hoisted(() => ({
  currentMemberAuthority: vi.fn(),
  resolveAuthoritativeClientAccess: vi.fn(),
  dbQuery: vi.fn(),
}));

vi.mock("@workloom/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workloom/db")>();
  return { ...actual, getAppPool: () => ({ query: dbQuery }) };
});

vi.mock("../service/access-authority.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../service/access-authority.js")>();
  return { ...actual, currentMemberAuthority, resolveAuthoritativeClientAccess };
});

import { accountOpsRouter } from "./account-ops-router.js";

const identity: Identity = {
  tenantId: "tenant-platform",
  workspaceId: "workspace-platform",
  memberId: "member-platform",
  memberNo: "MEM-PLATFORM",
  name: "平台运营员",
  role: "manager",
  plan: "pro",
};

const context = {
  session: identity,
  identity,
  partnerIdentity: null,
  headers: new Headers(),
};

describe("账号运营接口权限", () => {
  beforeEach(() => {
    currentMemberAuthority.mockReset();
    currentMemberAuthority.mockImplementation(async (member: Identity) => ({
      identity: member,
      permissions: {},
    }));
    resolveAuthoritativeClientAccess.mockReset();
    dbQuery.mockReset();
  });

  it("当前行业包未授予账号运营权限时，读取接口返回 403 且不进入查询", async () => {
    resolveAuthoritativeClientAccess.mockResolvedValue({
      navigationPermissions: [],
      actionPermissions: [],
      bundle: { configured: true },
    });
    const caller = accountOpsRouter.createCaller(context);

    await expect(caller.boards.overview()).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("只有读取导航权限但没有写角色时，写接口仍返回 403", async () => {
    resolveAuthoritativeClientAccess.mockResolvedValue({
      navigationPermissions: ["platform.account-operations.read"],
      actionPermissions: [],
      bundle: { configured: true },
    });
    const readonlyIdentity: Identity = { ...identity, role: "readonly" };
    const caller = accountOpsRouter.createCaller({
      ...context,
      session: readonlyIdentity,
      identity: readonlyIdentity,
    });

    await expect(caller.findings.handle({
      id: "finding-1",
      handledBy: "member-platform",
      verdict: "handled",
    })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("平台运营成员获得当前活动行业包授权后，可以读取账号运营数据", async () => {
    resolveAuthoritativeClientAccess.mockResolvedValue({
      navigationPermissions: ["platform.account-operations.read"],
      actionPermissions: ["workspace.write"],
      bundle: { configured: true },
    });
    dbQuery.mockResolvedValue({
      rows: [{
        id: "operator-1",
        account_id: "account-1",
        name: "平台运营员",
        scope_groups: [],
        capabilities: [],
        mfa_required: true,
        status: "active",
        created_at: "2026-09-16T00:00:00.000Z",
      }],
    });
    const caller = accountOpsRouter.createCaller(context);

    await expect(caller.operators.list()).resolves.toEqual([
      expect.objectContaining({ id: "operator-1", name: "平台运营员" }),
    ]);
    expect(dbQuery).toHaveBeenCalledTimes(1);
  });
});
