import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { computeUsageStats } from "../frontend/src/features/usage/usage-stats.ts";

const usagePage = readFileSync(new URL("../frontend/src/features/usage/usage-page.tsx", import.meta.url), "utf8");

assert.match(usagePage, /90 天/, "用量页应保留 90 天选项文案");

const oldEntry = computeUsageStats({ history: { "2026-09-01": { "s:a": { used: 3, quota: 7, tier: "paid" } } } });
assert.equal(oldEntry.days[0].spend, 0, "旧快照缺 used0 时应回退到 used");
assert.equal(oldEntry.days[0].balancePaid, 7, "历史快照的 tier 应优先于当前站点配置");

const orphan = computeUsageStats({ history: { "2026-09-01": { legacyAccount: { used: 0, quota: 1 } } } });
assert.equal(orphan.accounts[0].provider, "unknown");
assert.equal(orphan.accounts[0].name, "legacyAccount", "无法归属的旧 key 仍应显示原账号名");

const sparse = computeUsageStats({
  history: {
    "2026-09-01": { "s:a": { used: 1, used0: 1, quota: 10 } },
    "2026-09-02": {},
    "2026-09-03": { "s:a": { used: 1, used0: 1, quota: 20 } },
  },
});
assert.equal(sparse.days[2].gain, 0, "断档后的额度变化不能算作单日签到收益");
assert.equal(sparse.accounts.length, 1, "最新一天部分失败时应保留账号最近一次成功快照");

const consumedReward = computeUsageStats({
  history: {
    "2026-09-01": { "s:a": { used: 1, used0: 1, quota: 10 } },
    "2026-09-02": { "s:a": { used: 3, used0: 3, quota: 9 } },
  },
});
assert.equal(consumedReward.days[1].gain, 1, "入账应使用 Δquota + Δused，避免漏掉当天已消费的奖励");
console.log("frontend usage contract regression passed");
