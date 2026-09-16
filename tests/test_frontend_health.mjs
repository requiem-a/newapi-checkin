/**
 * 站点健康点纯函数回归。直接 import .ts（Node 自带类型剥离，只要求模块里没有运行时 import）。
 *   node tests/test_frontend_health.mjs
 */

import assert from "node:assert/strict";

import {
  aggregateHealth,
  worstFailureText,
  healthFromErrorText,
  healthFromResult,
  HEALTH_SEVERITY,
  syncedAgoLabel,
} from "../frontend/src/shared/lib/site-health.ts";

// ── 四态映射 ───────────────────────────────────────────────────────────────
assert.equal(healthFromResult(undefined), "unknown", "还没查过应是灰点");
assert.equal(healthFromResult({ name: "a", success: true, quota: 1, used: 2, username: "u" }), "healthy", "token 有效应是绿点");

assert.equal(healthFromResult({ name: "a", success: false, error: "HTTP 401" }), "warning", "401 是连上了被拒绝，黄点");
assert.equal(healthFromResult({ name: "a", success: false, error: "HTTP 403" }), "warning", "403 被拒绝是黄点");
assert.equal(healthFromResult({ name: "a", success: false, error: "HTTP 404" }), "warning", "404 是路径配错了，黄点");
assert.equal(healthFromResult({ name: "a", success: false, error: "HTTP 429" }), "warning", "429 限流是黄点");
assert.equal(healthFromResult({ name: "a", success: false, error: "API 返回失败: token 无效" }), "warning", "上游 200 但 success:false 是黄点");
assert.equal(healthFromResult({ name: "a", success: false, error: "同一站点内账号 name 不能重复，请使用唯一名称" }), "warning", "配置类原文是黄点");

// 5xx：请求是发出去了，但对面服务本身坏了（Cloudflare 后面的源站挂掉是典型），等同连不上
assert.equal(healthFromResult({ name: "a", success: false, error: "HTTP 500" }), "error", "500 是红点");
assert.equal(healthFromResult({ name: "a", success: false, error: "HTTP 502" }), "error", "502 源站不可达是红点");
assert.equal(healthFromResult({ name: "a", success: false, error: "HTTP 503" }), "error", "503 是红点");
assert.equal(healthFromResult({ name: "a", success: false, error: "HTTP 599" }), "error", "5xx 整段都算红");
assert.equal(healthFromResult({ name: "a", success: false, error: "http 502" }), "error", "状态码大小写不敏感");

assert.equal(
  healthFromResult({ name: "a", success: false, error: "Timeout: Failed to perform, curl: (28) Connection timed out after 30011 milliseconds" }),
  "error",
  "curl 超时是红点",
);
assert.equal(
  healthFromResult({ name: "a", success: false, error: "ConnectionError: Failed to perform, curl: (7) Failed to connect to 127.0.0.1 port 7890" }),
  "error",
  "停代理导致的连接失败是红点",
);
assert.equal(
  healthFromResult({ name: "a", success: false, error: "DNSError: Failed to perform, curl: (6) Could not resolve host: gorouter.app" }),
  "error",
  "域名解析不了是红点",
);

// ── 关键字大小写不敏感，且前缀类判定优先于网络关键字 ──────────────────────
assert.equal(healthFromErrorText("TIMEOUT"), "error", "关键字大小写不敏感");
assert.equal(healthFromErrorText("Fetch Failed"), "error", "关键字大小写不敏感");
assert.equal(healthFromErrorText("TypeError: Failed to fetch"), "error", "浏览器侧 TypeError 是红点");
assert.equal(healthFromErrorText("请求超时，请重试"), "error", "前端 client 的超时文案是红点");
assert.equal(healthFromErrorText("HTTP 429: too many requests, timeout"), "warning", "4xx 优先于网络关键字，混合文案不许判成红点");
assert.equal(healthFromErrorText("HTTP 502: upstream timeout"), "error", "5xx 同样优先于网络关键字，且结论是红");
assert.equal(healthFromErrorText("HTTP"), "warning", "只有 HTTP 前缀抠不出状态码时，仍按「拿到响应了」处理");

// ── 空 error ───────────────────────────────────────────────────────────────
assert.equal(healthFromErrorText(""), "warning", "空 error 按「其他失败」黄点");
assert.equal(healthFromErrorText("   "), "warning", "纯空白 error 同上");
assert.equal(healthFromErrorText(undefined), "warning", "缺 error 字段同上");
assert.equal(healthFromResult({ name: "a", success: false, error: "" }), "warning", "error 为空串也不炸");

// ── 整站级失败（ApiError 形状：只有 message/status，没有 success）──────────
assert.equal(
  healthFromResult({ name: "ApiError", status: 200, message: "同一站点内账号 name 不能重复，请使用唯一名称" }),
  "warning",
  "重名导致整站被拒是黄点，不是网络红点",
);
assert.equal(healthFromResult({ name: "ApiError", status: 200, message: "没有 GoRouter 账号" }), "warning", "站点没账号是黄点");
assert.equal(healthFromResult({ name: "ApiError", status: 200, message: "站点 xxx 不存在" }), "warning", "站点不存在是黄点");
assert.equal(
  healthFromResult({ name: "ApiError", status: 0, message: "网络错误，请检查连接后重试" }),
  "error",
  "本机到后端都不通时是红点",
);

// ── 站点级聚合优先级：红 > 黄 > 灰 > 绿 ────────────────────────────────────
assert.ok(
  HEALTH_SEVERITY.error > HEALTH_SEVERITY.warning &&
    HEALTH_SEVERITY.warning > HEALTH_SEVERITY.unknown &&
    HEALTH_SEVERITY.unknown > HEALTH_SEVERITY.healthy,
  "严重程度必须严格是 红 > 黄 > 灰 > 绿",
);
assert.equal(aggregateHealth(["healthy", "healthy"]), "healthy", "全绿才是绿");
assert.equal(aggregateHealth(["healthy", "warning"]), "warning", "有一个黄就取黄");
assert.equal(aggregateHealth(["healthy", "unknown"]), "unknown", "有一个没查过就取灰（信息不全比全绿更值得注意）");
assert.equal(aggregateHealth(["warning", "unknown"]), "warning", "黄重于灰");
assert.equal(aggregateHealth(["warning", "error"]), "error", "红最重");
assert.equal(aggregateHealth(["healthy", "warning", "error", "unknown"]), "error", "四个混在一起取红");
assert.equal(aggregateHealth([]), "unknown", "站点没有账号时是灰点，不能是绿");

// ── tooltip 用的失败原文：必须与圆点颜色同源 ─────────────────────────────
assert.equal(
  worstFailureText([
    { name: "a", success: true, quota: 1, used: 0, username: "a" },
    { name: "b", success: false, error: "HTTP 403" },
    { name: "c", success: false, error: "HTTP 500" },
  ]),
  "HTTP 500",
  "取最严重那条的原文，而不是第一条——否则红点会配着 401 文案自相矛盾",
);
assert.equal(
  worstFailureText([
    { name: "a", success: false, error: "HTTP 500" },
    { name: "b", success: false, error: "HTTP 403" },
  ]),
  "HTTP 500",
  "顺序无关，只看严重程度",
);
assert.equal(
  worstFailureText([
    { name: "a", success: false, error: "HTTP 403" },
    { name: "b", success: false, error: "HTTP 401" },
  ]),
  "HTTP 403",
  "同严重度（都是 4xx）时取第一条，保证稳定不抖",
);
assert.equal(
  worstFailureText([
    { name: "a", success: false, error: "ConnectionError: Failed to connect" },
    { name: "b", success: false, error: "HTTP 403" },
  ]),
  "ConnectionError: Failed to connect",
  "网络红比 4xx 黄更严重，取网络那条",
);
assert.equal(worstFailureText([]), undefined, "空列表没有原文");
assert.equal(
  worstFailureText([{ name: "a", success: true, quota: 1, used: 0, username: "a" }]),
  undefined,
  "全成功没有原文",
);

// ── 上次同步时间文案 ───────────────────────────────────────────────────────
const t0 = 1_700_000_000_000;
assert.equal(syncedAgoLabel(t0, t0 + 3_000), "刚刚", "10 秒内是「刚刚」");
assert.equal(syncedAgoLabel(t0, t0 + 30_000), "30 秒前", "一分钟内按秒");
assert.equal(syncedAgoLabel(t0, t0 + 5 * 60_000), "5 分钟前", "一小时内按分钟");
assert.match(syncedAgoLabel(t0, t0 + 3 * 3_600_000), /\d{1,2}:\d{2}:\d{2}/, "超过一小时回落到绝对时间");

console.log("frontend health dot regression passed");
