import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");
const product = JSON.parse(readFileSync(resolve(root, "product.manifest.json"), "utf8"));
const builder = readFileSync(resolve(root, "electron-builder.yml"), "utf8");
const workflow = readFileSync(resolve(root, ".github/workflows/build-desktop.yml"), "utf8");

test("仙女座固定下载资产沿用稳定 ASCII 点号前缀", () => {
  assert.equal(product.release.artifactPrefix, "Workroom.Andromeda");
  assert.match(builder, /artifactName: "Workroom\.Andromeda-\$\{os\}-\$\{arch\}\.\$\{ext\}"/u);
  assert.doesNotMatch(product.release.artifactPrefix, /\s/u);
});

test("未签名桌面发行不向 electron-builder 注入空证书变量", () => {
  assert.equal((workflow.match(/CSC_IDENTITY_AUTO_DISCOVERY: "false"/gu) ?? []).length, 3);
  assert.doesNotMatch(workflow, /CSC_LINK=|CSC_KEY_PASSWORD=|APPLE_ID=|WIN_CSC_LINK=|WIN_CSC_KEY_PASSWORD=/u);
  assert.equal((workflow.match(/if: needs\.preflight\.outputs\.platform-signing == 'unsigned'/gu) ?? []).length, 3);
  assert.match(workflow, /-c\.mac\.notarize=false/u);
});

test("桌面 Release 写入 job 与基座受审模板逐字节同源", () => {
  const marker = "  # WorkLoom 下游桌面正式发行的唯一写入 job 模板。";
  const start = workflow.indexOf(marker);
  assert.ok(start >= 0, "缺少基座 publisher 模板标记");
  const normalized = workflow.slice(start).split("\n")
    .map((line) => line.startsWith("  ") ? line.slice(2) : line)
    .join("\n");
  assert.equal(
    createHash("sha256").update(normalized).digest("hex"),
    "af712bcbef7e284921a31ea4d45b8a82df9671b1061d183568da9a8540188df6",
  );
  assert.equal((normalized.match(/merge-multiple: true/gu) ?? []).length, 2);
});
