import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("账号运营路由守卫接线", () => {
  it("所有读取与写入接口都使用同一行业导航权限", () => {
    const source = readFileSync(new URL("./account-ops-router.ts", import.meta.url), "utf8");

    expect(source).toContain('navigationPermissionProcedure("platform.account-operations.read")');
    expect(source).toContain('navigationPermissionWriteProcedure("platform.account-operations.read")');
    expect(source.match(/platformAccountReadProcedure(?:\.|\n)/g)).toHaveLength(10);
    expect(source.match(/platformAccountWriteProcedure(?:\.|\n)/g)).toHaveLength(7);
    expect(source).not.toMatch(/\bprotectedProcedure\b/);
    expect(source).not.toMatch(/\bwriteProcedure\b/);
  });
});
