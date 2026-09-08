/**
 * bus/stream —— 事件总线（P0-3 转口层：语义与引擎已下沉基座 packages/base/event-bus）
 *
 * 本文件只保留两件「一方资产」：
 *  ① STREAM_TOPOLOGY 四流拓扑声明（平台运营的业务拓扑，永不同步出仓）；
 *  ② 旧构造签名的兼容别名（new EventBus(now) → 基座 MemoryEventBus 起步形态）。
 *
 * 接口与实现全部来自基座 @workloom/base/event-bus：
 *  - EventBusLike / BusMessage / ConsumerGroupLike（接口冻结，上层零改动）；
 *  - MemoryEventBus（起步/测试形态）；
 *  - NatsEventBus / RedisEventBus（持久化适配器：本地镜像 + 后台同步泵；
 *    生产 EVENT_BUS=nats|redis 切换，见 platform-ops/docs/bus-failover-drill.md 演练手册）。
 */
import { MemoryEventBus, createEventBusFromEnv } from "@workloom/base/event-bus";

export type { BusMessage, ConsumerGroupLike, EventBusLike, StreamName } from "@workloom/base/event-bus";
/** 旧类型别名（消费方零改动） */
export type { ConsumerGroupLike as ConsumerGroup } from "@workloom/base/event-bus";
export {
  MemoryEventBus, MirroredEventBus, createNatsBus, createRedisBus,
  type BusBackend, type OutboxMsg, type PersistedMsg, type StreamSpec,
} from "@workloom/base/event-bus";
export { createEventBusFromEnv } from "@workloom/base/event-bus";

/** §17.3 四条流的拓扑声明（单一事实源，生产部署按本表建流；一方资产） */
export const STREAM_TOPOLOGY = {
  "events-core":    { subject: "ev.{tenant}.{type}",        retention: "limits-72h",  consumers: ["projector", "chain-verifier", "cdc-relay"] },
  "credits-ledger": { subject: "credits.{tenant}",          retention: "workqueue-30d", consumers: ["balance-projector", "anomaly-detector", "daily-reconciler"] },
  "tickets-flow":   { subject: "ticket.{tenant}.{ticket}",  retention: "workqueue-30d", consumers: ["ticket-projector", "sla-timer", "push-matcher", "revisit-scheduler"] },
  "ops-signals":    { subject: "ops.{check}.{object}",      retention: "limits-7d",   consumers: ["alert-aggregator", "inspection-dispatch", "strategy-trigger"] },
} as const;

export type TopologyStreamName = keyof typeof STREAM_TOPOLOGY;

/** 拓扑 → 基座 StreamSpec（生产建流参数：留存窗口毫秒化） */
export function topologySpecs(): import("@workloom/base/event-bus").StreamSpec[] {
  const maxAge = (r: string): number | undefined =>
    r === "limits-72h" ? 72 * 3600e3 : r === "limits-7d" ? 7 * 24 * 3600e3 : undefined;
  return (Object.entries(STREAM_TOPOLOGY) as Array<[TopologyStreamName, (typeof STREAM_TOPOLOGY)[TopologyStreamName]]>)
    .map(([name, t]) => ({
      name,
      subjects: [`${name}.>`],
      retention: t.retention.startsWith("workqueue") ? "workqueue" as const : "limits" as const,
      maxAgeMs: maxAge(t.retention),
    }));
}

/**
 * 起步形态（内存实现）——构造签名保持旧形态（new EventBus(now)），
 * 消费方与既有测试零改动；生产持久化装配走 createEventBusFromEnv（基座工厂）。
 */
export class EventBus extends MemoryEventBus {
  constructor(now: () => number = () => Date.now()) {
    super(Object.keys(STREAM_TOPOLOGY), now);
  }
}

/**
 * 平台运行时一行装配入口（P0-3 闭环）：拓扑 + 切换机制一次到位。
 * 用法：const bus = await createPlatformEventBus();
 *  ① EVENT_BUS=nats|redis（+EVENT_BUS_URL）→ 持久化适配器（生产）；
 *  ② EVENT_BUS=memory → 内存形态（测试/开发）；
 *  ③ 缺省自动：内嵌 NATS 可连则 nats，否则 memory（桌面自包含包启动器已注入 EVENT_BUS=nats）。
 * 切换/回退/演练见 platform-ops/docs/bus-failover-drill.md（科目四：环境变量改回即秒级回退）。
 */
export async function createPlatformEventBus(
  env: Record<string, string | undefined> = typeof process !== "undefined" ? process.env : {},
  now: () => number = () => Date.now(),
): Promise<import("@workloom/base/event-bus").EventBusLike> {
  return createEventBusFromEnv(env, { streams: topologySpecs(), now });
}
