# 事件总线持久化切换演练手册（P0-3 · 一方运维资产）

> 对象：平台生产环境的事件总线从内存起步形态切换为持久化适配器（NATS JetStream 主选 / Redis Streams 备选）。
> 纪律：接口不变、上层零改动；切换必须可回退；四科目全部通过才算切换完成。
> 引擎与一致性举证：基座 `packages/base/event-bus`（三实现同一套一致性测试套件，CI 常绿）。

## 切换机制（配置面）

```bash
EVENT_BUS=memory            # 起步/演示形态（默认回退位）
EVENT_BUS=nats  EVENT_BUS_URL=nats://127.0.0.1:4222   # 生产主选
EVENT_BUS=redis EVENT_BUS_URL=redis://127.0.0.1:6379  # 生产备选
# 自包含安装包：内嵌 nats-server 由启动器拉起（scripts/embedded-nats.mjs），
# 启动器自动注入 EVENT_BUS=nats + EVENT_BUS_URL——开箱即持久化。
```

## 科目一：双写过渡（memory → nats 零停机）

1. 目标端建流：`EVENT_BUS=nats` 启动一个影子实例（topologySpecs() 四流 + wl-delayed 自动建立）；
2. 生产实例开启双写 30 分钟（outbox-relay 同时指向 memory 与 nats，消费组仍在 memory 读）；
3. 核对两镜像一致性（事件数/最新位点/延迟队列深度）；
4. 读侧按消费组逐组切到 nats（projector → sla-timer → 其余），每组观察 10 分钟无异常再切下一组。

## 科目二：在途不丢验证（故障注入）

1. 注入 10,000 条混合消息（events-core 8,000 + tickets-flow 1,500 + deliver-at 500）；
2. 消费 50% 后 `kill -9` 服务进程（不 flush、不 close）；
3. 重启实例，验收：
   - 流日志消息数 = 10,000（一条不少）；
   - 未 ack 消息全部重投（deliverCount ≥ 2）；
   - 已 ack 消息零重投；
   - deliver-at 消息到点必达（延迟队列深度归零时序正确）。
   （基座一致性套件「持久化 · 崩溃重启」三用例即本科目的自动化版本，每次发版必跑。）

## 科目三：重放基准（投影重建）

1. 以 72h 留存窗口的事件量（基准 10 万条）执行 `replay(events-core, 0)` 全量重放重建投影；
2. 达标线：重放吞吐 ≥ 2,000 条/秒，10 万条端到端 < 60 秒；
3. 重建投影与在线投影逐条比对一致（哈希一致）。

## 科目四：回退预案（秒级回退）

1. 切换后异常（延迟毛刺/消费错位/连接抖动）：`EVENT_BUS=memory` 重启即回退；
2. 回退期间已落库事件不丢：outbox 未发布位点由 relay 续发补齐（先落库后上总线纪律天然兜底）;
3. 回退后 24h 观察期，问题定位修复后按科目一重新切换。

## 验收签字栏

| 科目 | 通过标准 | 日期 | 执行人 |
|---|---|---|---|
| 一 双写过渡 | 双镜像一致，逐组切换零异常 | | |
| 二 在途不丢 | kill -9 后 0 丢失、未 ack 全重投、已 ack 零重投 | | |
| 三 重放基准 | 10 万条 < 60s，投影哈希一致 | | |
| 四 回退预案 | 秒级回退成功，outbox 补齐无缺口 | | |

---

## 首次演练实录（2026-09-08，fake ×2 + 真实 nats-server v2.11.4 JetStream）

演练在开发期即抓到并修复了 3 个真实缺陷（这正是演练的意义）：

| # | 缺陷 | 现象 | 根因 | 修复 |
|---|---|---|---|---|
| 1 | **flush 重入重复发布** | ack 路由整体偏移 +1，「已 ack 零重投」失败 | 内部定时器与外部调用并发 flush，两条泵看到同一未出队项 → 重复发布挤占流内 seq | flush 互斥锁 + 补跑标记（定时器重入不置标记防 do-while 死循环）；回归用例：并发 flush 服务器侧零重复 |
| 2 | **真实 JetStream 协议不兼容** | 真服务器直接断连 / err 10098 | ① CONNECT 未协商 headers（HPUB 被拒）② 建组请求体未包 config 嵌套层 ③ workqueue 流拒绝 ack_policy=none 的重放消费者 ④ API 错误响应未识别（4xx 当成功） | 四处协议对齐；重放改 explicit 不 ack + 临时消费者自动回收 |
| 3 | **字节/字符长度混淆（NATS+RESP 双侧）** | 含中文的帧永远等不到「完整帧」→ 5s 超时 | 协议长度字段是字节数，字符串组帧用字符数——中文负载帧对齐崩坏（生产 payload 必含中文，属 P0 级隐患） | 客户端与 fake 双侧全部改字节级组帧（Buffer 组帧）；回归用例：中文/emoji 事件全链路原样往返 + 重启后仍原样 |

另：恢复路径从「读客户端内存」改为「以 CONSUMER.INFO.num_ack_pending 为目标数有界等待服务器重投」（fake 即时、真实 ≤ ack_wait+余量；消费组 ack_wait 可配，演练调 3s 加速）。

**最终状态**：fake-nats ✅ / fake-redis ✅ / 真实 nats-server v2.11.4（JetStream file storage）✅ 三环境六科目全绿；基座一致性套件 30/30（三实现同跑）+ platform-ops 101/101。
