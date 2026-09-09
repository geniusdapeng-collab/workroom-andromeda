---
name: key-baseline
version: 1.0.0
description: API 密钥基线与 break-glass 记录——泄露嫌疑检测（异地/超速率/非常用能力）、报告死线追踪；停用必人审。
---

# 密钥基线与紧急介入记录

## 一、何时调用
- 每日例行；API key 高频调用告警；break-glass 开启/关闭/报告死线到达时。

## 二、执行步骤
1. **使用基线**：每 key 的调用频率/来源 IP/能力分布建 30 日基线；
2. **泄露嫌疑**：异地 IP 首用 / 超 rate_limit 突刺 / 调用从未声明的能力 → P1 告警 + 停用建议卡（必人审）；
3. **闲置清理**：90 天未用 key → 吊销建议卡；
4. **break-glass 记录**：开启/动作/关闭全程入客户可见日志；报告死线 24h 超期未报 → overdue 工单升级账号专员+平台负责人。

## 三、边界与围栏
- 检测自动，停用 key 必人审——误停断的是客户系统对接；
- break-glass 报告死线没有弹性：超期即 overdue，无豁免通道。

## 四、协作
- 上游：api_keys/调用事件/break_glass_sessions；下游：account-steward、平台负责人审批卡。
