/**
 * server · dialog 意图/置信度纯函数单测（不触 DB）
 * M8：与 base intents 同一张规则表；行业业务词只有在已验证适配器注入后才生效。
 * H5：置信度归一化三档边界（≥0.72 直答 / 0.5–0.72 附提示 / <0.5 拒答）。
 */
import { describe, expect, it } from "vitest";
import {
  classify,
  tierOfScore,
  ticketKindOf,
  sharesDistinctiveEvidence,
  CONFIDENCE_HIGH,
  CONFIDENCE_MEDIUM,
} from "./dialog.js";
import type { ServiceFrontBusinessAdapter } from "./adapters/business.js";

const platformTestAdapter: ServiceFrontBusinessAdapter = {
  id: "platform-test",
  classify: (text) => text.includes("平台账务明细")
    ? { tool: "query_catalog", answer: "正在查询平台账务明细。" }
    : null,
  ticketKind: (text) => text.includes("平台异常") ? "other" : null,
  queryOrder: async () => ({ demo: true, orders: [] }),
  queryMember: async () => ({ demo: true, member: null }),
  queryCatalog: async () => ({ demo: true, cardTitle: "平台服务", items: [] }),
};

describe("classify 意图规则（M8 与 base 同表）", () => {
  const cases: Array<[string, string, string?]> = [
    ["我要投诉服务响应太慢", "complaint"],
    ["查一下我的订单", "kb_qa"],
    ["我的会员积分还有多少", "kb_qa"],
    ["豪华大床房多少钱一晚", "kb_qa"],
    ["我的工单进度怎么样了", "biz_query", "query_ticket"],
    ["如何提交服务工单", "kb_qa"],
  ];
  for (const [text, intent, tool] of cases) {
    it(`「${text}」→ ${intent}${tool ? `/${tool}` : ""}`, () => {
      const r = classify(text);
      expect(r.intent).toBe(intent);
      if (tool) expect(r.tool).toBe(tool);
    });
  }

  it("行业能力只能由显式注入的适配器识别", () => {
    expect(classify("请查询平台账务明细", platformTestAdapter)).toMatchObject({
      intent: "biz_query",
      tool: "query_catalog",
      answer: "正在查询平台账务明细。",
    });
  });
});

describe("ticketKindOf service_request → 工单类型", () => {
  it("基座不猜行业工单类型，适配器可显式提供分类", () => {
    expect(ticketKindOf("平台异常需要处理")).toBe("other");
    expect(ticketKindOf("平台异常需要处理", platformTestAdapter)).toBe("other");
  });
});

describe("tierOfScore 置信度三档（H5，归一化 0..1）", () => {
  it("阈值边界", () => {
    expect(CONFIDENCE_HIGH).toBe(0.72);
    expect(CONFIDENCE_MEDIUM).toBe(0.45); // 评测校准：区分度地板与拒答边界拉开
    expect(tierOfScore(0.95)).toBe("high");
    expect(tierOfScore(0.72)).toBe("high");
    expect(tierOfScore(0.71)).toBe("medium");
    expect(tierOfScore(0.45)).toBe("medium");
    expect(tierOfScore(0.44)).toBe("low");
    expect(tierOfScore(0)).toBe("low");
    expect(tierOfScore(undefined)).toBe("low");
  });
  it("越界输入归一化", () => {
    expect(tierOfScore(1.2)).toBe("high");
    expect(tierOfScore(-0.3)).toBe("low");
  });
});

describe("知识块合并词义由活动 Bundle 注入", () => {
  const first = { heading: "订单", content: "第一段" };
  const second = { heading: "订单", content: "第二段" };

  it("基座默认不把行业词擅自降为弱词", () => {
    expect(sharesDistinctiveEvidence(first, second)).toBe(true);
  });

  it("显式词表可以阻止仅共享弱词的知识块合并", () => {
    expect(sharesDistinctiveEvidence(first, second, { weakTokens: ["订单"] })).toBe(false);
  });
});
