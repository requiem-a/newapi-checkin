/**
 * provider → 分区的解析器。用量快照的 provider 有三类来源（站点 id / anyrouter /
 * agentrouter），站点那份要读 `/api/sites`，所以这里统一发一个请求给各页面复用。
 *
 * queryKey 与账号页 / 站点页一致，react-query 会命中同一份缓存，不会重复打接口。
 */

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { fetchSites } from "@/features/accounts/accounts-api";
import { defaultTierOf, makeTierOf, type TierOf } from "@/shared/lib/site-tier";

export function useTierOf(): TierOf {
  const sitesQ = useQuery({ queryKey: ["accounts", "sites"], queryFn: fetchSites });
  const sites = sitesQ.data;
  return useMemo(() => (sites ? makeTierOf(sites) : defaultTierOf), [sites]);
}
