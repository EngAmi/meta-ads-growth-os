import { cn } from "@/lib/utils";
import { LucideIcon, TrendingUp, TrendingDown, Minus } from "lucide-react";

interface MetricCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon?: LucideIcon;
  trend?: number;
  trendLabel?: string;
  status?: "green" | "yellow" | "red" | "blue" | "neutral";
  className?: string;
  compact?: boolean;
}

const statusColors = {
  green: "text-[oklch(0.72_0.16_162)]",
  yellow: "text-[oklch(0.82_0.17_85)]",
  red: "text-[oklch(0.65_0.22_25)]",
  blue: "text-[oklch(0.62_0.19_258)]",
  neutral: "text-foreground",
};

const statusIconBg = {
  green: "bg-[oklch(0.72_0.16_162/0.12)]",
  yellow: "bg-[oklch(0.82_0.17_85/0.12)]",
  red: "bg-[oklch(0.65_0.22_25/0.12)]",
  blue: "bg-[oklch(0.62_0.19_258/0.12)]",
  neutral: "bg-muted",
};

export function MetricCard({
  title,
  value,
  subtitle,
  icon: Icon,
  trend,
  trendLabel,
  status = "neutral",
  className,
  compact = false,
}: MetricCardProps) {
  const TrendIcon = trend === undefined ? null : trend > 0 ? TrendingUp : trend < 0 ? TrendingDown : Minus;
  const trendColor = trend === undefined ? "" : trend > 0 ? "text-[oklch(0.72_0.16_162)]" : trend < 0 ? "text-[oklch(0.65_0.22_25)]" : "text-muted-foreground";

  return (
    <div className={cn(
      "relative rounded-xl border border-border bg-card metric-card-glow overflow-hidden",
      compact ? "p-4" : "p-5",
      className
    )}>
      {/* Subtle top accent line */}
      {status !== "neutral" && (
        <div className={cn(
          "absolute top-0 left-0 right-0 h-0.5",
          status === "green" && "bg-[oklch(0.72_0.16_162)]",
          status === "yellow" && "bg-[oklch(0.82_0.17_85)]",
          status === "red" && "bg-[oklch(0.65_0.22_25)]",
          status === "blue" && "bg-[oklch(0.62_0.19_258)]",
        )} />
      )}

      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider truncate">{title}</p>
          <p className={cn(
            "font-bold tracking-tight mt-1.5 truncate",
            compact ? "text-2xl" : "text-3xl",
            statusColors[status]
          )}>
            {value}
          </p>
          {subtitle && (
            <p className="text-xs text-muted-foreground mt-1 truncate">{subtitle}</p>
          )}
          {(trend !== undefined || trendLabel) && (
            <div className={cn("flex items-center gap-1 mt-2", trendColor)}>
              {TrendIcon && <TrendIcon className="h-3 w-3 shrink-0" />}
              <span className="text-xs font-medium">
                {trend !== undefined && `${trend > 0 ? "+" : ""}${trend.toFixed(1)}%`}
                {trendLabel && ` ${trendLabel}`}
              </span>
            </div>
          )}
        </div>
        {Icon && (
          <div className={cn(
            "rounded-lg flex items-center justify-center shrink-0",
            compact ? "h-9 w-9" : "h-11 w-11",
            statusIconBg[status]
          )}>
            <Icon className={cn(
              compact ? "h-4 w-4" : "h-5 w-5",
              statusColors[status]
            )} />
          </div>
        )}
      </div>
    </div>
  );
}
