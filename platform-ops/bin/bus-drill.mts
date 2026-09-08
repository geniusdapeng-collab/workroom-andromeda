#!/usr/bin/env node
/**
 * bus-drill.mjs —— 事件总线切换演练自动化脚本（演练手册科目二/三的本地可跑版）
 *
 * 用法：
 *   node platform-ops/bin/bus-drill.mjs --backend nats|redis --url nats://127.0.0.1:4222
 *   （无真服务器时自动起进程内仿真服务器——与基座一致性套件同套 fake，零外部依赖）
 *
 * 科目二（在途不丢）：注入混合消息 → 模拟 kill（不 flush）→ 重建 → 校验
 * 科目三（重放基准）：全量重放计时，对比达标线（默认 10 万条 < 60s；演示规模 1 万条）
 */
import { MirroredEventBus, NatsBackend, TcpNatsConnection, RedisBackend, TcpRedisConnection, FakeNatsServer, FakeRedisServer } from "@workloom/base/event-bus";
import { topologySpecs } from "../src/bus/stream.js";

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; };
const BACKEND = arg("backend", "nats");
const URL = arg("url", "");
const SCALE = Number(arg("scale", "10000"));
const REPLAY_LINE_MS = Number(arg("replay-line-ms", "60000"));

let fakeServerRef = null;
async function makeServer() {
  if (URL) return { url: URL, stop: async () => undefined };
  if (BACKEND === "nats") {
    const s = new FakeNatsServer(); await s.start();
    fakeServerRef = s;
    return { url: s.url(), stop: () => s.stop() };
  }
  const s = new FakeRedisServer(); await s.start();
  fakeServerRef = s;
  return { url: s.url(), stop: () => s.stop() };
}

async function makeBus(url, now) {
  const backend = BACKEND === "nats" ? new NatsBackend(new TcpNatsConnection(url)) : new RedisBackend(new TcpRedisConnection(url));
  const bus = new MirroredEventBus(backend, topologySpecs(), () => now.t, 25, 3000);
  await bus.start();
  return bus;
}

const now = { t: Date.now() };
const server = await makeServer();
let failures = 0;
const check = (name, cond) => { console.log(`${cond ? "✅" : "❌"} ${name}`); if (!cond) failures++; };

console.log(`═══ 事件总线演练（backend=${BACKEND} scale=${SCALE}）═══`);

/* ---------- 科目二：在途不丢 ---------- */
console.log("\n▶ 科目二：kill -9 在途消息不丢 / 未 ack 重投 / 已 ack 零重投 / 延迟必达");
let bus = await makeBus(server.url, now);
const DELAY_N = Math.max(10, Math.floor(SCALE * 0.05));
for (let i = 0; i < SCALE - DELAY_N; i++) bus.publish("events-core", `ev.drill.${i % 7}`, { i });
for (let i = 0; i < DELAY_N; i++) bus.publish("events-core", "ev.drill.sla", { sla: i }, { deliverAt: now.t + 60_000 });
await bus.flush();
let group = bus.consumer("events-core", "drill");
await bus.flush();
const half = group.pull(Math.floor(SCALE / 2), now.t);
for (const m of half.slice(0, Math.floor(half.length / 2))) group.ack(m.seq); // ack 一半
await bus.flush();
const unackedBefore = half.length - Math.floor(half.length / 2);
await bus.close(); // 模拟崩溃（服务器状态保留）

now.t += 60_000; // 到点
bus = await makeBus(server.url, now);
const logBeforeLift = bus.logOf("events-core").length;
check(`在途消息不丢（${SCALE - DELAY_N} 条即时消息全在）`, logBeforeLift === SCALE - DELAY_N);
group = bus.consumer("events-core", "drill");
await bus.flush();
const redelivered = [...group.pull(SCALE, now.t), ...group.pull(SCALE, now.t)];
check(`未 ack 重投（${unackedBefore} 条）`, redelivered.length >= unackedBefore);
const ackedSet = new Set(half.slice(0, Math.floor(half.length / 2)).map((m) => m.payload.i));
check("已 ack 零重投", redelivered.every((m) => !ackedSet.has(m.payload.i ?? -1)));
check("延迟消息到点必达", redelivered.filter((m) => m.payload.sla !== undefined).length === DELAY_N);
check(`流日志完整（lift 后 ${SCALE} 条全量）`, bus.logOf("events-core").length === SCALE);

/* ---------- 科目三：重放基准 ---------- */
console.log("\n▶ 科目三：全量重放基准");
const t0 = Date.now();
const all = bus.replay("events-core", 0);
const elapsed = Date.now() - t0;
check(`重放 ${all.length} 条耗时 ${elapsed}ms（达标线 ${REPLAY_LINE_MS}ms）`, all.length === SCALE && elapsed < REPLAY_LINE_MS);

await bus.close();
await server.stop();
console.log(failures === 0 ? "\n✅ 演练全部通过" : `\n❌ ${failures} 项未达标`);
process.exit(failures === 0 ? 0 : 1);
