import { useMemo, useState } from "react";
import { Area, Bar, CartesianGrid, ComposedChart, Line, XAxis, YAxis } from "recharts";

import { ChartContainer, ChartLegend, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Spinner } from "@/components/ui/spinner";
import { DashboardPanel } from "@/features/dashboard/dashboard-panel";
import type { DayPoint } from "@/features/usage/usage-stats";
import { EmptyState } from "@/shared/components/data-state";
import { cn } from "@/shared/lib/cn";

/**
 * 趋势图：余额（公益 / 付费两条 Area）+ 每日消耗（Bar）+ 签到收益（Line 虚线）。
 * 结构照搬 grok2api 的 dashboard-trend.tsx（图例可点击隐藏系列、双 Y 轴随可见系列
 * 自动重排、自定义 tooltip），只换了数据源与系列含义。
 *
 * 公益与付费是**两条独立曲线**，不是堆叠：堆叠后上面那条的读数会变成「公益+付费」，
 * 而这两条曲线存在的意义恰恰是各自读一条——"公益还剩多少"与"付费还剩多少"。
 * 两条共用左侧同一个余额轴，所以高度可以直接互相比较。
 */
type TrendSeries = "balancePublic" | "balancePaid" | "spend" | "gain";
type AxisId = "balance" | "spend" | "gain";
type AxisSide = "left" | "right";

const BALANCE_SERIES = ["balancePublic", "balancePaid"] as const satisfies readonly TrendSeries[];
const TREND_SERIES: readonly TrendSeries[] = [...BALANCE_SERIES, "spend", "gain"];

/** 每个系列画在哪个轴上：两条余额曲线共用一个轴，才能直接比高低 */
const AXIS_OF: Record<TrendSeries, AxisId> = {
  balancePublic: "balance",
  balancePaid: "balance",
  spend: "spend",
  gain: "gain",
};

const money = (v: number) => `$${v.toFixed(2)}`;

export function UsageTrend({ days, loading, title = "余额与消耗趋势" }: { days: DayPoint[]; loading: boolean; title?: string }) {
  const [hiddenSeries, setHiddenSeries] = useState<Set<TrendSeries>>(() => new Set());

  const chartData = useMemo(
    () => days.map((d) => ({ ...d, label: d.date.slice(5).replace("-", "/") })),
    [days],
  );

  // 颜色统一走 index.css 的 --tier-public / --tier-paid，两处不各写一份 oklch
  const chartConfig = useMemo<ChartConfig>(
    () => ({
      balancePublic: { label: "公益余额", color: "var(--tier-public)" },
      balancePaid: { label: "付费余额", color: "var(--tier-paid)" },
      spend: { label: "每日消耗", theme: { light: "oklch(0.7 0.11 160)", dark: "oklch(0.73 0.1 160)" } },
      gain: { label: "签到收益", theme: { light: "oklch(0.76 0.12 80)", dark: "oklch(0.8 0.13 80)" } },
    }),
    [],
  );

  const hasData = days.some((d) => d.balance > 0 || d.spend > 0 || d.gain > 0);
  const axisSides = resolveAxes(hiddenSeries);

  function toggleSeries(series: TrendSeries): void {
    setHiddenSeries((current) => {
      const next = new Set(current);
      if (next.has(series)) next.delete(series);
      else next.add(series);
      return next;
    });
  }

  return (
    <DashboardPanel id="usage-trend-title" title={title} className="h-full min-h-[360px]">
      {!loading && !hasData ? (
        <div className="flex h-[280px] items-center justify-center">
          <EmptyState message="暂无用量数据" />
        </div>
      ) : (
        <div className="relative" aria-busy={loading}>
          <ChartContainer config={chartConfig} className={cn("h-[280px] w-full aspect-auto", loading && "opacity-40")}>
            <ComposedChart accessibilityLayer data={chartData} margin={{ left: 0, right: 4, top: 10, bottom: 0 }}>
              <CartesianGrid vertical={false} strokeDasharray="3 3" />
              <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={10} minTickGap={20} />
              <YAxis
                yAxisId="balance"
                hide={!axisSides.balance}
                orientation={axisSides.balance ?? "left"}
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                width={axisSides.balance ? 52 : 0}
                allowDecimals={false}
                tickFormatter={(value) => money(Number(value))}
              />
              <YAxis
                yAxisId="spend"
                hide={!axisSides.spend}
                orientation={axisSides.spend ?? "right"}
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                width={axisSides.spend ? 48 : 0}
                allowDecimals
                tickFormatter={(value) => money(Number(value))}
              />
              <YAxis
                yAxisId="gain"
                hide={!axisSides.gain}
                orientation={axisSides.gain ?? "right"}
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                width={axisSides.gain ? 48 : 0}
                allowDecimals
                tickFormatter={(value) => money(Number(value))}
              />
              <ChartTooltip
                cursor={false}
                content={(
                  <ChartTooltipContent
                    className="w-56 max-w-[calc(100vw-2rem)]"
                    indicator="dot"
                    labelFormatter={(_label, payload) => payload?.[0]?.payload?.date ?? ""}
                    formatter={(value, name, item) => (
                      <div className="flex w-full items-center justify-between gap-4">
                        <span className="flex min-w-0 items-center gap-2 text-xs font-normal text-muted-foreground">
                          <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: item.color || `var(--color-${String(name)})` }} />
                          <span className="truncate">{chartConfig[String(name)]?.label ?? String(name)}</span>
                        </span>
                        <span className="font-data shrink-0 text-xs font-normal tabular-nums text-muted-foreground">
                          {money(Number(value))}
                        </span>
                      </div>
                    )}
                  />
                )}
              />
              <Bar
                yAxisId="spend"
                dataKey="spend"
                fill="var(--color-spend)"
                fillOpacity={0.42}
                hide={hiddenSeries.has("spend")}
                maxBarSize={32}
                radius={[3, 3, 0, 0]}
                animationDuration={400}
                animationEasing="ease-out"
              />
              <Area
                yAxisId="balance"
                dataKey="balancePublic"
                type="monotone"
                stroke="var(--color-balancePublic)"
                strokeWidth={1.75}
                fill="var(--color-balancePublic)"
                fillOpacity={0.12}
                hide={hiddenSeries.has("balancePublic")}
                dot={false}
                activeDot={{ r: 3, fill: "var(--color-balancePublic)", stroke: "var(--color-background)", strokeWidth: 2 }}
                animationDuration={400}
                animationEasing="ease-out"
              />
              <Area
                yAxisId="balance"
                dataKey="balancePaid"
                type="monotone"
                stroke="var(--color-balancePaid)"
                strokeWidth={1.75}
                fill="var(--color-balancePaid)"
                fillOpacity={0.12}
                hide={hiddenSeries.has("balancePaid")}
                dot={false}
                activeDot={{ r: 3, fill: "var(--color-balancePaid)", stroke: "var(--color-background)", strokeWidth: 2 }}
                animationDuration={400}
                animationEasing="ease-out"
              />
              <Line
                yAxisId="gain"
                dataKey="gain"
                type="monotone"
                stroke="var(--color-gain)"
                strokeWidth={1.25}
                strokeDasharray="5 4"
                hide={hiddenSeries.has("gain")}
                dot={false}
                activeDot={{ r: 3, fill: "var(--color-gain)", stroke: "var(--color-background)", strokeWidth: 2 }}
                animationDuration={400}
                animationEasing="ease-out"
              />
              <ChartLegend content={<TrendLegend config={chartConfig} hiddenSeries={hiddenSeries} onToggle={toggleSeries} />} />
            </ComposedChart>
          </ChartContainer>
          {loading ? <div className="absolute inset-0 flex items-center justify-center"><Spinner className="size-5" /></div> : null}
        </div>
      )}
    </DashboardPanel>
  );
}

function TrendLegend({ config, hiddenSeries, onToggle }: { config: ChartConfig; hiddenSeries: Set<TrendSeries>; onToggle: (series: TrendSeries) => void }) {
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 pt-3 text-xs text-muted-foreground">
      {TREND_SERIES.map((series) => {
        const hidden = hiddenSeries.has(series);
        const label = config[series]?.label ?? series;
        return (
          <button
            key={series}
            type="button"
            className={cn("flex items-center gap-1.5 rounded-md px-2 py-1 transition-[background-color,color,opacity] hover:bg-accent hover:opacity-100", hidden && "opacity-35")}
            onClick={() => onToggle(series)}
            aria-pressed={!hidden}
            aria-label={`${hidden ? "显示" : "隐藏"} ${String(label)}`}
          >
            {series === "spend" ? (
              <span className="size-2 shrink-0 rounded-[2px]" style={{ backgroundColor: "var(--color-spend)" }} />
            ) : (
              <span
                className={cn("w-3 shrink-0 border-t", series === "gain" && "border-dashed")}
                style={{ borderColor: `var(--color-${series})` }}
              />
            )}
            <span>{label}</span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * 哪几个轴要显示、放哪一侧。规则：余额轴永远在左，消耗/收益挤右侧；
 * 余额整个被隐藏时让剩下的那个补到左边，避免左侧空出一整条。
 */
function resolveAxes(hiddenSeries: ReadonlySet<TrendSeries>): Record<AxisId, AxisSide | null> {
  const visibleAxes = new Set(TREND_SERIES.filter((s) => !hiddenSeries.has(s)).map((s) => AXIS_OF[s]));
  const sides: Record<AxisId, AxisSide | null> = { balance: null, spend: null, gain: null };
  if (visibleAxes.has("balance")) {
    sides.balance = "left";
    if (visibleAxes.has("spend")) sides.spend = "right";
    if (visibleAxes.has("gain")) sides.gain = "right";
    return sides;
  }
  if (visibleAxes.has("spend") && visibleAxes.has("gain")) {
    sides.spend = "left";
    sides.gain = "right";
    return sides;
  }
  if (visibleAxes.has("spend")) sides.spend = "left";
  if (visibleAxes.has("gain")) sides.gain = "left";
  return sides;
}
