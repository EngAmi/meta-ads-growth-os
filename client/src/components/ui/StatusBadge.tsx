import { cn } from "@/lib/utils";

type Status = "green" | "yellow" | "red" | "blue" | "gray";

interface StatusBadgeProps {
  status: Status;
  label: string;
  className?: string;
  size?: "sm" | "md";
}

const statusConfig: Record<Status, { dot: string; text: string; bg: string; border: string }> = {
  green: {
    dot: "bg-[oklch(0.72_0.16_162)]",
    text: "text-[oklch(0.72_0.16_162)]",
    bg: "bg-[oklch(0.72_0.16_162/0.12)]",
    border: "border-[oklch(0.72_0.16_162/0.25)]",
  },
  yellow: {
    dot: "bg-[oklch(0.82_0.17_85)]",
    text: "text-[oklch(0.82_0.17_85)]",
    bg: "bg-[oklch(0.82_0.17_85/0.12)]",
    border: "border-[oklch(0.82_0.17_85/0.25)]",
  },
  red: {
    dot: "bg-[oklch(0.65_0.22_25)]",
    text: "text-[oklch(0.65_0.22_25)]",
    bg: "bg-[oklch(0.65_0.22_25/0.12)]",
    border: "border-[oklch(0.65_0.22_25/0.25)]",
  },
  blue: {
    dot: "bg-[oklch(0.62_0.19_258)]",
    text: "text-[oklch(0.62_0.19_258)]",
    bg: "bg-[oklch(0.62_0.19_258/0.12)]",
    border: "border-[oklch(0.62_0.19_258/0.25)]",
  },
  gray: {
    dot: "bg-muted-foreground",
    text: "text-muted-foreground",
    bg: "bg-muted",
    border: "border-border",
  },
};

export function StatusBadge({ status, label, className, size = "sm" }: StatusBadgeProps) {
  const cfg = statusConfig[status];
  return (
    <span className={cn(
      "inline-flex items-center gap-1.5 rounded-full font-medium border",
      size === "sm" ? "px-2 py-0.5 text-xs" : "px-3 py-1 text-sm",
      cfg.bg, cfg.text, cfg.border,
      className
    )}>
      <span className={cn("rounded-full shrink-0", size === "sm" ? "h-1.5 w-1.5" : "h-2 w-2", cfg.dot)} />
      {label}
    </span>
  );
}

export function SeverityBadge({ severity }: { severity: string }) {
  const map: Record<string, Status> = {
    critical: "red",
    warning: "yellow",
    info: "blue",
    high: "red",
    medium: "yellow",
    low: "blue",
  };
  return <StatusBadge status={map[severity] || "gray"} label={severity} />;
}

export function PriorityBadge({ priority }: { priority: string }) {
  const map: Record<string, Status> = {
    critical: "red",
    high: "yellow",
    medium: "blue",
    low: "gray",
  };
  return <StatusBadge status={map[priority] || "gray"} label={priority} />;
}
