import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(new URL("../.github/workflows/build-desktop.yml", import.meta.url), "utf8");
const builder = readFileSync(new URL("../electron-builder.yml", import.meta.url), "utf8");
const product = JSON.parse(readFileSync(new URL("../product.manifest.json", import.meta.url), "utf8"));
const sites = ["index.html", "en.html"].map((name) =>
  readFileSync(new URL(`../apps/site/${name}`, import.meta.url), "utf8"));

test("signed and explicitly unsigned desktop channels keep the Bundle trust chain", () => {
  assert.match(workflow, /platform_signing:/u);
  assert.match(workflow, /options: \[signed, unsigned\]/u);
  assert.match(workflow, /github\.event_name == 'workflow_dispatch'.*'unsigned'/u);
  assert.match(workflow, /BUNDLE_SIGNING_PRIVATE_KEY/u);
  assert.match(workflow, /pnpm bundle:release/u);
  assert.match(workflow, /build\/bundle-trust\.json/u);
});

test("unsigned builders cover all three installers without platform certificate secrets", () => {
  for (const name of ["打包未签名 DMG（arm64）", "打包未签名 DMG（x64）", "打包未签名 NSIS 安装包"]) {
    assert.match(workflow, new RegExp(`- name: ${name}[\\s\\S]*?if: env\\.PLATFORM_SIGNING == 'unsigned'`, "u"));
  }
  assert.match(workflow, /CSC_IDENTITY_AUTO_DISCOVERY: "false"/u);
  assert.match(workflow, /mac\.notarize=false/u);
  assert.match(workflow, /unsigned 模式：[^\n]*Developer ID/u);
  assert.match(workflow, /grep -q '\^Authority='/u);
  assert.ok((workflow.match(/Get-AuthenticodeSignature/gu) ?? []).length >= 4);
  assert.match(workflow, /未签名、未 Apple 公证的 macOS/u);
  assert.match(workflow, /SmartScreen/u);
});

test("product identity and stable asset names are consistent", () => {
  assert.equal(product.displayName, "仙女座运营运维系统");
  assert.equal(product.release.artifactPrefix, "Workroom Andromeda");
  assert.match(builder, /productName: 仙女座运营运维系统/u);
  assert.match(builder, /workloomPortOffset: 120/u);
  assert.match(builder, /artifactName: "Workroom Andromeda-\$\{os\}-\$\{arch\}\.\$\{ext\}"/u);
  for (const site of sites) {
    assert.match(site, /workroom-andromeda\/releases\/latest/u);
    assert.doesNotMatch(site, /releases\/latest\/download\/WorkLoom-macOS\.zip/u);
  }
});

test("Windows packaged-app smoke is isolated from the runner PostgreSQL toolchain", () => {
  for (const [name, port] of [
    ["WORKLOOM_PG_PORT", "55432"],
    ["WORKLOOM_SERVER_PORT", "58787"],
    ["WORKLOOM_WEB_PORT", "55173"],
    ["WORKLOOM_NATS_PORT", "54222"],
  ]) {
    assert.ok(workflow.includes(`${name}: "${port}"`), `缺少 ${name} 隔离端口`);
  }
  for (const root of ["wl-smoke", "wl-app-smoke", "wl-render-default"]) {
    assert.ok(workflow.includes(`$RUNNER_TEMP/${root}`), `${root} 未统一使用 RUNNER_TEMP`);
    assert.ok(workflow.includes(`\${{ runner.temp }}/${root}/logs/`), `${root} 日志未进入失败诊断`);
    assert.ok(workflow.includes(`\${{ runner.temp }}/${root}/install-state.json`), `${root} 状态未进入失败诊断`);
  }
  assert.match(workflow, /actions\/upload-artifact@v4/u);
  assert.match(workflow, /锁定源安装 17\.11\.0/u);
  assert.doesNotMatch(workflow, /\$\{TEMP\}\/wl-/u);
  assert.doesNotMatch(workflow, /\$env:TEMP\\wl-/u);
});
