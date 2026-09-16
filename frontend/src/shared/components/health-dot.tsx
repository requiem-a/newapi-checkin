/**
 * 健康圆点：站点卡片与账号行共用的存活状态指示器。
 *
 * 与 site-color.ts 的站点标识色点、site-tier.ts 的分区点是三种不同的东西，
 * 并排出现时不要互相顶替：标识色点回答「哪个站」，分区点回答「额度从哪来」，
 * 这颗回答「现在通不通」。
 */

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/shared/lib/cn";
import { HEALTH_LABEL, syncedAgoLabel, type SiteHealth } from "@/shared/lib/site-health";

/**
 * 四态 → 填充色的字面量查表。Tailwind v4 只按源码字符匹配类名，运行时拼
 * `bg-checkin-${health}` 扫不到、样式会静默失效（同 site-color.ts 的约束）。
 *
 * unknown 不用 `bg-muted`：亮色下 --muted 是 oklch(0.965)、卡片是 0.975，几乎同色，
 * 一颗 8px 的灰点会彻底看不见，而「没查过」恰恰是最需要一眼认出来的状态。
 */
const DOT_FILL_CLASSES: Record<SiteHealth, string> = {
  healthy: "bg-checkin-done",
  warning: "bg-checkin-pending",
  error: "bg-checkin-failed",
  unknown: "bg-muted-foreground/40",
};

export interface HealthDotProps {
  health: SiteHealth;
  /** 无障碍标签的主体，站点卡片传站点名、账号行传账号名 */
  subject: string;
  /** 失败原因原文，原样展示给用户。绝不传 access_token 之类的凭据 */
  detail?: string | null;
  /** 上次同步时间戳（ms），没有就显示「尚未查询」 */
  syncedAt?: number | null;
  /** 正在重查：圆点脉冲，期间点击无效 */
  loading?: boolean;
  /** 只读展示：不可点击、不参与 Tab（账号行没有单行重查请求，用它） */
  readOnly?: boolean;
  onRefresh?: () => void;
}

export function HealthDot({ health, subject, detail, syncedAt, loading = false, readOnly = false, onRefresh }: HealthDotProps) {
  const actionable = !readOnly && typeof onRefresh === "function";
  // 只读时不用 disabled 属性：Radix 的 tooltip 依赖事件冒泡，disabled 按钮不派发事件，
  // 悬停提示会失效。改用 aria-disabled + tabIndex=-1，既保留提示又不会被 Tab 到。
  const label = actionable
    ? `刷新 ${subject} 健康状态（当前${HEALTH_LABEL[health]}）`
    : `${subject} 健康状态：${HEALTH_LABEL[health]}`;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={actionable && !loading ? onRefresh : undefined}
          aria-label={label}
          aria-disabled={!actionable || loading || undefined}
          tabIndex={actionable ? undefined : -1}
          className={cn(
            "inline-flex size-4 shrink-0 items-center justify-center rounded-full transition-colors",
            actionable && !loading && "cursor-pointer hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            actionable && loading && "cursor-progress",
            !actionable && "cursor-default",
          )}
        >
          <span
            className={cn("size-2 rounded-full transition-colors", DOT_FILL_CLASSES[health], loading && "animate-pulse")}
            aria-hidden="true"
          />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-72">
        <p className="font-medium">{HEALTH_LABEL[health]}</p>
        {detail ? <p className="mt-1 break-words opacity-85">{detail}</p> : null}
        <p className="mt-1 opacity-70">{syncedAt ? `上次同步：${syncedAgoLabel(syncedAt)}` : "尚未查询"}</p>
        {actionable ? <p className="mt-1 opacity-70">点击只重查这个站点</p> : null}
      </TooltipContent>
    </Tooltip>
  );
}
