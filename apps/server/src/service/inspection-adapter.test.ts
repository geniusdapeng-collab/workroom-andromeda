import { describe, expect, it } from "vitest";
import { loadBundleUiProjection } from "@workloom/base/bundles";
import {
  bindInspectionAdapter,
  registeredInspectionBundleIds,
} from "./inspection-adapter.js";

describe("仙女座巡检适配器边界", () => {
  it("平台包未声明行业巡检时失败关闭且目录保持空集", () => {
    const binding = bindInspectionAdapter({
      workspaceBundleId: "platform",
      activeInstalls: [{ id: "install-platform", bundleId: "platform" }],
    });
    expect(binding).toMatchObject({
      state: "adapter-not-declared",
      adapter: null,
      bundleId: "platform",
    });
    expect(registeredInspectionBundleIds()).toEqual([]);
  });

  it("平台包伪造任意行业适配器标识时因未登记失败关闭", () => {
    const platform = loadBundleUiProjection("platform");
    const binding = bindInspectionAdapter({
      workspaceBundleId: "platform",
      activeInstalls: [{ id: "install-platform", bundleId: "platform" }],
    }, () => ({
      ...platform,
      ui: { ...platform.ui, inspection: { enabled: true, adapterId: "hotel.inspection-v1" } },
    }));
    expect(binding).toMatchObject({ state: "adapter-not-registered", adapter: null });
  });

  it("活动安装与工作区指针冲突时在适配器选择前失败关闭", () => {
    const binding = bindInspectionAdapter({
      workspaceBundleId: "platform",
      activeInstalls: [{ id: "install-hotel", bundleId: "hotel" }],
    });
    expect(binding).toMatchObject({ state: "bundle-mismatch", adapter: null });
  });
});
