/**
 * 站点分区（公益 / 付费）：把用量快照里的 provider 映射到两个桶之一。
 *
 * 用量快照的 key 是 `provider:账号名`（见 balance_server.py 的 usage_key），
 * provider 只有三种来源：站点 id、`anyrouter`、`agentrouter`。站点那部分从
 * 站点注册表的 `tier` 字段读；后两个不是站点（走 WAF / 账密登录，没有注册表条目），
 * 默认算公益——真要改成付费，改 BUILTIN_PROVIDER_TIERS 一处即可。
 *
 * 分区只影响展示口径（额度怎么分桶），不影响任何抓取与签到行为。
 */

import type { NewapiSite, SiteTier } from "@/types";

/** 分组顺序：公益在前，付费在后（新增分区时同步改这里和 TIER_LABEL） */
export const SITE_TIERS: readonly SiteTier[] = ["public", "paid"] as const;

export const TIER_LABEL: Record<SiteTier, string> = {
  public: "公益",
  paid: "付费",
};

/** 站点卡片 / 分区标题用的完整名字 */
export const TIER_SITE_LABEL: Record<SiteTier, string> = {
  public: "公益站",
  paid: "付费站",
};

export const TIER_DESCRIPTION: Record<SiteTier, string> = {
  public: "免费发放额度的站点，额度归零不心疼，但签到断了就没了",
  paid: "自己充钱买的额度，按剩余天数盯紧一点",
};

/**
 * 非站点 provider 的默认分区。这两个是项目内置的账号类型（AnyRouter 走阿里云 WAF
 * + 代理，AgentRouter 只能账密登录），在站点注册表里没有条目，因此单独列一张表。
 */
export const BUILTIN_PROVIDER_TIERS: Record<string, SiteTier> = {
  anyrouter: "public",
  agentrouter: "public",
};

/** provider → 分区。默认公益：任何没被显式标注的来源都按"白来的额度"处理 */
export type TierOf = (provider: string) => SiteTier;

export function makeTierOf(sites: readonly NewapiSite[]): TierOf {
  const byId = new Map(sites.map((site) => [site.id, site.tier]));
  return (provider) => byId.get(provider) ?? BUILTIN_PROVIDER_TIERS[provider] ?? "public";
}

/** 兜底解析器：还没拿到站点清单时用它，全按公益算，避免图表闪成两段 */
export const defaultTierOf: TierOf = () => "public";

/**
 * Tailwind v4 的类名扫描是纯文本匹配，运行时拼字符串（`text-tier-${tier}`）不会生成 CSS。
 * 所以下面两张表必须写成字面量，调用方只许按下标查表——同 shared/lib/site-color.ts 的约束。
 */
const TIER_TEXT_CLASSES: Record<SiteTier, string> = {
  public: "text-tier-public",
  paid: "text-tier-paid",
};

const TIER_DOT_CLASSES: Record<SiteTier, string> = {
  public: "inline-block size-2 rounded-full bg-tier-public",
  paid: "inline-block size-2 rounded-full bg-tier-paid",
};

export function tierTextClass(tier: SiteTier): string {
  return TIER_TEXT_CLASSES[tier];
}

export function tierDotClass(tier: SiteTier): string {
  return TIER_DOT_CLASSES[tier];
}
