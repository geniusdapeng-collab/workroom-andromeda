import { describe, expect, it } from "vitest";
import { industryRoutes } from "./routes";

describe("账号运营行业路由", () => {
  it("使用语义主路由，并把旧编号地址仅作为兼容入口", () => {
    expect(industryRoutes).toHaveLength(1);
    expect(industryRoutes[0]).toMatchObject({
      path: "/platform/account-operations",
      legacyPaths: ["/p32"],
      capabilityId: "platform.account-operations",
    });
  });
});
