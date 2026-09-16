/**
 * 仙女座平台运营包没有行业巡检探针。
 *
 * 平台巡检事件/技能不等于行业对象探针；在 platform Bundle 明确声明并完成
 * 适配器评测前，目录必须保持显式空集，禁止回退到酒店或其他行业语义。
 */
import type { InspectionAdapterRegistration } from "../service/inspection-adapter.js";

export const BUNDLED_INSPECTION_ADAPTERS: readonly InspectionAdapterRegistration[] = Object.freeze([]);
