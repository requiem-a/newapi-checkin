/**
 * 站点 / 账号健康态：把一次余额查询的结果翻译成一颗圆点的颜色。
 *
 * 纯逻辑，不碰 React，也不 import 任何运行时代码（只有 `import type`），
 * 这样 Node 的类型剥离能直接 import 本文件做单测——同 build-site-script.ts 的约束。
 *
 * 健康态天然与出口绑定：后端 Turnstile 缓存键是 `turnstile:{id}:{domain}:{proxy|direct}`，
 * 所以切换站点代理后健康必须重置为「尚未查询」，不能留着上一出口的结论。
 */

import type { ApiError } from "@/shared/api/client";
import type { QueryResult, SiteHealth } from "@/types";

export type { SiteHealth };

/** 页面本地保存的一次查询结论。刻意不落盘：刷新页面就该回到「尚未查询」 */
export interface SiteHealthEntry {
  health: SiteHealth;
  /** 失败原因原文（后端返回），全成功时没有 */
  detail?: string;
  /** 同步时间戳（ms），喂给 tooltip 的「上次同步」 */
  syncedAt: number;
}

/**
 * 聚合优先级。unknown 刻意排在 healthy 之上：同站点里「有一个账号还没查过」比
 * 「有一个账号正常」更值得注意，卡片上的点应该提示"信息不全"而不是抹平成绿。
 */
export const HEALTH_SEVERITY: Record<SiteHealth, number> = {
  healthy: 0,
  unknown: 1,
  warning: 2,
  error: 3,
};

/** tooltip 里的状态文案。四态各一句，别在这里拼动态内容 */
export const HEALTH_LABEL: Record<SiteHealth, string> = {
  healthy: "token 有效",
  warning: "被拒绝 / 限流 / 配置有误",
  error: "连不上",
  unknown: "尚未查询",
};

/**
 * 网络层故障关键字（一律小写比较，调用方先 toLowerCase）。
 *
 * 前 6 个是设计约定里列的；后面几个是照 curl_cffi 的真实异常文案补的——
 * 后端 `query_balance_newapi` 把异常拼成 `{type(e).__name__}: {e}`，实测：
 *   停代理 → `ConnectionError: Failed to perform, curl: (7) Failed to connect to 127.0.0.1 port 7890`
 *   域名解析不了 → `DNSError: Failed to perform, curl: (6) Could not resolve host: ...`
 *   超时 → `Timeout: Failed to perform, curl: (28) Connection timed out after ...`
 * 只按设计约定的那 6 个词扫，这三种「连不上」会被判成黄色（配置错），
 * 而验收要求是红的。
 */
export const NETWORK_ERROR_KEYWORDS: readonly string[] = [
  "typeerror",
  "fetch failed",
  "timeout",
  "连接",
  "网络",
  "超时",
  "failed to connect",
  "could not resolve",
  "failed to perform",
  "connection refused",
  "connection reset",
];

/**
 * 失败文案 → 健康态。
 *
 * 判定顺序有讲究：先看 `HTTP {状态码}` 前缀，再扫网络关键字。顺序反了的话，
 * `HTTP 429: too many requests, timeout` 这类混合文案会被关键字抢走判成红点，
 * 而它其实是连上了被限流。
 *
 * 状态码内部还要再分一层：5xx 是**对面服务本身坏了**（Cloudflare 后面的源站挂掉、
 * 返回 502 是典型），效果上等同「连不上」，标红；4xx（401/403/429）是连上了被拒绝
 * 或限流，标黄。
 */
export function healthFromErrorText(raw: string | null | undefined): SiteHealth {
  const text = (raw ?? "").trim();
  if (!text) return "warning";

  const httpStatus = /^HTTP\s+(\d{3})\b/i.exec(text);
  if (httpStatus) {
    const code = Number(httpStatus[1]);
    return code >= 500 && code < 600 ? "error" : "warning";
  }
  // 有 HTTP 前缀但抠不出状态码（罕见）：仍按「拿到响应了」处理，别掉进关键字分支
  if (/^HTTP\b/i.test(text)) return "warning";

  if (text.startsWith("API 返回失败")) return "warning";
  const lower = text.toLowerCase();
  if (NETWORK_ERROR_KEYWORDS.some((keyword) => lower.includes(keyword))) return "error";
  return "warning";
}

/** 一次查询的输入：查过的结果、整站级失败（ApiError）、或还没查过 */
export type SiteHealthSource = QueryResult | ApiError | undefined;

/**
 * 单条结果 → 健康态。
 *
 * 两类输入靠 `success` 字段区分：QueryResult 必有该字段，ApiError 只有 message/status。
 * 注意后端整站级失败（站点不存在 / 无账号 / 重名被拒）是 HTTP 200 + `{success:false}`，
 * 会被 client.ts 的 unwrapEnvelope 抛成 ApiError，所以这里不能用 status 判断。
 */
export function healthFromResult(input: SiteHealthSource): SiteHealth {
  if (!input) return "unknown";
  if ("success" in input) {
    if (input.success) return "healthy";
    return healthFromErrorText(input.error);
  }
  return healthFromErrorText(input.message);
}

/** 站点级聚合：取该站点下所有账号里最严重的一颗；空列表（站点没账号）算灰 */
export function aggregateHealth(healths: readonly SiteHealth[]): SiteHealth {
  let worst: SiteHealth | null = null;
  for (const health of healths) {
    if (worst === null || HEALTH_SEVERITY[health] > HEALTH_SEVERITY[worst]) worst = health;
  }
  return worst ?? "unknown";
}

/**
 * 站点级失败原文：取**最严重**那条失败的原因，喂给 tooltip。
 *
 * 圆点颜色取最严重（aggregateHealth），文案必须跟着同一条走——否则会出现
 * 「红点配 `HTTP 401` 文案」的自相矛盾：用户照着文案去查 401 账号，红点暗示的
 * 却是连通性故障。同严重度取第一条，保证结果稳定不抖。
 */
export function worstFailureText(results: readonly QueryResult[]): string | undefined {
  let worstHealth: SiteHealth | null = null;
  let worstText: string | undefined;
  for (const result of results) {
    if (result.success) continue;
    const health = healthFromResult(result);
    if (worstHealth === null || HEALTH_SEVERITY[health] > HEALTH_SEVERITY[worstHealth]) {
      worstHealth = health;
      worstText = result.error;
    }
  }
  return worstText;
}

/** 「上次同步」的相对时间文案。now 可注入，方便单测 */
export function syncedAgoLabel(ts: number, now: number = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - ts) / 1000));
  if (seconds < 10) return "刚刚";
  if (seconds < 60) return `${seconds} 秒前`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} 分钟前`;
  return new Date(ts).toLocaleTimeString("zh-CN", { hour12: false });
}
