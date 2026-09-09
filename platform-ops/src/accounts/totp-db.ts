/** 查询函数类型（与基座 accounts 模块同形，便于复用与测试） */
export type QueryFn = (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
