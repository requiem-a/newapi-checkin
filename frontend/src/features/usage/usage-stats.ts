/**
 * 用量统计的纯计算层：全部是无副作用的纯函数，输入是 GET /api/usage/history 的
 * { "YYYY-MM-DD": { "provider:账号名": {used, quota, used0} } }，输出各种视图形状。
 * 与展示组件严格分离——方便单测，也方便灌 mock 数据验证视觉效果。
 *
 * 关键口径（与后端对齐；new-api 的 /api/user/self 里 quota 就是剩余额度，站点控制台
 * 显示的「余额」= quota / quota_per_unit，used_quota 是独立的已用统计）：
 * - 余额 = quota（美元）
 * - 余额按站点分区分成「公益 / 付费」两桶（tierOf 给出 provider → 分区，见 shared/lib/site-tier.ts）
 * - 每日消耗 = used - used0（当天基线）
 * - 签到/充值入账：后端没有持久化签到历史（checkin_state.date 每轮覆盖），用相邻快照的
 *   Δquota + Δused 正增量近似；断档不计入，UI 必须标注。
 */

import type { SiteTier, UsageHistory, UsageDayMap } from "@/types";
import type { TierOf } from "@/shared/lib/site-tier";

export interface DayPoint {
  date: string;
  /** 全账号余额合计 = balancePublic + balancePaid */
  balance: number;
  /** 公益站余额合计 */
  balancePublic: number;
  /** 付费站余额合计 */
  balancePaid: number;
  /** 全账号当日消耗合计 */
  spend: number;
  /** 全账号签到/充值入账合计（Δquota + Δused 正增量） */
  gain: number;
}

export interface AccountStat {
  /** usage key：provider:账号名 */
  key: string;
  provider: string;
  name: string;
  /** 账号所属分区：公益 / 付费 */
  tier: SiteTier;
  balance: number;
  /** 窗口期内总消耗 */
  spend: number;
  /** 近 7 日日均消耗 */
  burnRate7: number;
  /** 近 30 日日均消耗 */
  burnRate30: number;
  /** 签到/充值入账合计（Δquota + Δused 正增量） */
  gain: number;
  /** 按近 7 日速率推算的剩余天数；消耗为 0 或无数据时为 null */
  daysLeft: number | null;
  /** 热力图：每一天是否签到成功（按 quota 增量反推） */
  signedDays: Set<string>;
}

export interface ProviderStat {
  provider: string;
  tier: SiteTier;
  balance: number;
}

export interface UsageStats {
  days: DayPoint[];
  accounts: AccountStat[];
  providers: ProviderStat[];
  dateRange: [string, string] | null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const fallbackTierOf: TierOf = () => "public";

function entrySpend(entry: UsageDayMap[string]): number {
  return Math.max(0, entry.used - (entry.used0 ?? entry.used));
}

function isConsecutiveDate(previous: string, current: string): boolean {
  const previousMs = Date.parse(`${previous}T00:00:00Z`);
  const currentMs = Date.parse(`${current}T00:00:00Z`);
  return Number.isFinite(previousMs) && Number.isFinite(currentMs) && currentMs - previousMs === 86_400_000;
}

/** 解析 `provider:账号名`；迁移无法归属的旧裸 key 保留原账号名并标成 unknown。 */
function parseUsageKey(key: string): { provider: string; name: string } {
  const separator = key.indexOf(":");
  if (separator < 0) return { provider: "unknown", name: key };
  return { provider: key.slice(0, separator), name: key.slice(separator + 1) };
}

function providerOfKey(key: string): string {
  return parseUsageKey(key).provider;
}

export function computeUsageStats(history: UsageHistory, tierOf: TierOf = fallbackTierOf): UsageStats {
  const dates = Object.keys(history.history).sort();
  if (dates.length === 0) {
    return { days: [], accounts: [], providers: [], dateRange: null };
  }

  // ── 按天聚合 ──
  const days: DayPoint[] = dates.map((date) => {
    const day = history.history[date]!;
    let balance = 0;
    let spend = 0;
    const byTier: Record<SiteTier, number> = { public: 0, paid: 0 };
    for (const [key, entry] of Object.entries(day)) {
      balance += entry.quota;
      byTier[entry.tier ?? tierOf(providerOfKey(key))] += entry.quota;
      spend += entrySpend(entry);
    }
    // gain 先置 0：精确的逐日入账在下面用 computeDailyGains 回填
    // （按天聚合时拿不到前一日的 quota，在这里算不出增量）
    return {
      date,
      balance: round2(balance),
      balancePublic: round2(byTier.public),
      balancePaid: round2(byTier.paid),
      spend: round2(spend),
      gain: 0,
    };
  });

  // ── 按账号聚合 ──
  const latestByKey = new Map<string, UsageDayMap[string]>();
  const providerTiers = new Map<string, SiteTier>();
  for (const date of dates) {
    for (const [key, entry] of Object.entries(history.history[date]!)) {
      latestByKey.set(key, entry);
      const provider = providerOfKey(key);
      providerTiers.set(provider, entry.tier ?? tierOf(provider));
    }
  }
  const accountKeys = [...latestByKey.keys()];
  const accountStats: AccountStat[] = [];
  const providerTotals = new Map<string, number>();

  for (const key of accountKeys) {
    const { provider, name } = parseUsageKey(key);
    let spend = 0;
    let gain = 0;
    let prevQuota: number | null = null;
    let prevUsed: number | null = null;
    let prevDate: string | null = null;
    const signedDays = new Set<string>();
    const spends: number[] = [];

    for (const date of dates) {
      const entry = history.history[date]![key];
      if (!entry) {
        prevQuota = null;
        prevUsed = null;
        prevDate = null;
        continue;
      }
      if (prevQuota !== null && prevUsed !== null && prevDate !== null && isConsecutiveDate(prevDate, date)) {
        const credit = entry.quota - prevQuota + (entry.used - prevUsed);
        if (credit > 0.005) {
          gain += credit;
          signedDays.add(date);
        }
      }
      prevQuota = entry.quota;
      prevUsed = entry.used;
      prevDate = date;
      const daySpend = entrySpend(entry);
      spend += daySpend;
      spends.push(daySpend);
    }

    const last = latestByKey.get(key)!;
    const balance = round2(last.quota);
    const last7 = spends.slice(-7);
    const last30 = spends.slice(-30);
    const burn7 = last7.length > 0 ? last7.reduce((a, b) => a + b, 0) / last7.length : 0;
    const burn30 = last30.length > 0 ? last30.reduce((a, b) => a + b, 0) / last30.length : 0;

    accountStats.push({
      key,
      provider: provider!,
      name,
      tier: last.tier ?? tierOf(provider!),
      balance,
      spend: round2(spend),
      burnRate7: round2(burn7),
      burnRate30: round2(burn30),
      gain: round2(gain),
      daysLeft: burn7 > 0.005 ? round2(balance / burn7) : null,
      signedDays,
    });

    providerTotals.set(provider!, (providerTotals.get(provider!) ?? 0) + balance);
  }

  // 入账回填到天数序列（按天聚合时拿不到前一日快照，这里单独计算）
  const gainsByDay = computeDailyGains(history.history, dates);
  for (const point of days) point.gain = gainsByDay.get(point.date) ?? 0;

  return {
    days,
    accounts: accountStats.sort((a, b) => b.spend - a.spend),
    providers: [...providerTotals.entries()]
      .map(([provider, balance]) => ({ provider, tier: providerTiers.get(provider) ?? tierOf(provider), balance: round2(balance) }))
      .sort((a, b) => b.balance - a.balance),
    dateRange: [dates[0]!, dates[dates.length - 1]!],
  };
}

/** 逐日入账（近似值）：相邻快照的 Δquota + Δused 正增量合计；断档视为新基线 */
export function computeDailyGains(history: Record<string, UsageDayMap>, dates: string[]): Map<string, number> {
  const gains = new Map<string, number>();
  const prevByKey = new Map<string, { quota: number; used: number; date: string }>();
  for (const date of dates) {
    let dayGain = 0;
    for (const [key, entry] of Object.entries(history[date]!)) {
      const prev = prevByKey.get(key);
      if (prev && isConsecutiveDate(prev.date, date)) {
        const credit = entry.quota - prev.quota + (entry.used - prev.used);
        if (credit > 0.005) dayGain += credit;
      }
      prevByKey.set(key, { quota: entry.quota, used: entry.used, date });
    }
    gains.set(date, round2(dayGain));
  }
  return gains;
}

/** 环比：后 N 天均值 vs 前 N 天均值的百分比变化；基数不足或为 0 时返回 null */
export function periodOverPeriod(days: DayPoint[], windowDays: number): number | null {
  if (days.length < windowDays * 2) return null;
  const recent = days.slice(-windowDays);
  const before = days.slice(-windowDays * 2, -windowDays);
  const avg = (arr: DayPoint[]) => arr.reduce((s, d) => s + d.spend, 0) / arr.length;
  const a = avg(recent);
  const b = avg(before);
  if (b <= 0) return null;
  return round2(((a - b) / b) * 100);
}

/** 账号健康度分级 */
export type HealthLevel = "exhausted" | "low" | "idle" | "ok";

export function healthLevel(stat: AccountStat, lowBalanceThreshold = 10): HealthLevel {
  if (stat.balance <= 0.01) return "exhausted";
  if (stat.balance < lowBalanceThreshold) return "low";
  if (stat.burnRate30 < 0.01) return "idle";
  return "ok";
}

export const healthLabel: Record<HealthLevel, string> = {
  exhausted: "已耗尽",
  low: "余额告警",
  idle: "长期闲置",
  ok: "正常",
};

export const healthTextClass: Record<HealthLevel, string> = {
  exhausted: "text-checkin-failed",
  low: "text-balance-low",
  idle: "text-muted-foreground",
  ok: "text-checkin-done",
};
