import { createContext, useContext, useState, ReactNode } from "react";
import { subDays, startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth, subWeeks, subMonths } from "date-fns";

export type DatePreset = "today" | "yesterday" | "last7" | "last14" | "last30" | "last90" | "thisWeek" | "lastWeek" | "thisMonth" | "lastMonth" | "custom";

export interface DateRange {
  from: Date;
  to: Date;
  preset: DatePreset;
}

interface DateRangeContextValue {
  dateRange: DateRange;
  setDateRange: (range: DateRange) => void;
  setPreset: (preset: DatePreset) => void;
}

const presetRanges: Record<Exclude<DatePreset, "custom">, () => { from: Date; to: Date }> = {
  today:     () => ({ from: startOfDay(new Date()), to: endOfDay(new Date()) }),
  yesterday: () => ({ from: startOfDay(subDays(new Date(), 1)), to: endOfDay(subDays(new Date(), 1)) }),
  last7:     () => ({ from: startOfDay(subDays(new Date(), 6)), to: endOfDay(new Date()) }),
  last14:    () => ({ from: startOfDay(subDays(new Date(), 13)), to: endOfDay(new Date()) }),
  last30:    () => ({ from: startOfDay(subDays(new Date(), 29)), to: endOfDay(new Date()) }),
  last90:    () => ({ from: startOfDay(subDays(new Date(), 89)), to: endOfDay(new Date()) }),
  thisWeek:  () => ({ from: startOfWeek(new Date(), { weekStartsOn: 1 }), to: endOfWeek(new Date(), { weekStartsOn: 1 }) }),
  lastWeek:  () => ({ from: startOfWeek(subWeeks(new Date(), 1), { weekStartsOn: 1 }), to: endOfWeek(subWeeks(new Date(), 1), { weekStartsOn: 1 }) }),
  thisMonth: () => ({ from: startOfMonth(new Date()), to: endOfMonth(new Date()) }),
  lastMonth: () => ({ from: startOfMonth(subMonths(new Date(), 1)), to: endOfMonth(subMonths(new Date(), 1)) }),
};

export function getPresetRange(preset: DatePreset): { from: Date; to: Date } {
  if (preset === "custom") return { from: subDays(new Date(), 29), to: new Date() };
  return presetRanges[preset]();
}

export const PRESET_LABELS: Record<DatePreset, string> = {
  today:     "Today",
  yesterday: "Yesterday",
  last7:     "Last 7 days",
  last14:    "Last 14 days",
  last30:    "Last 30 days",
  last90:    "Last 90 days",
  thisWeek:  "This week",
  lastWeek:  "Last week",
  thisMonth: "This month",
  lastMonth: "Last month",
  custom:    "Custom range",
};

const DateRangeContext = createContext<DateRangeContextValue | null>(null);

export function DateRangeProvider({ children }: { children: ReactNode }) {
  const defaultPreset: DatePreset = "last30";
  const defaultRange = getPresetRange(defaultPreset);

  const [dateRange, setDateRangeState] = useState<DateRange>({
    ...defaultRange,
    preset: defaultPreset,
  });

  const setDateRange = (range: DateRange) => setDateRangeState(range);

  const setPreset = (preset: DatePreset) => {
    const range = getPresetRange(preset);
    setDateRangeState({ ...range, preset });
  };

  return (
    <DateRangeContext.Provider value={{ dateRange, setDateRange, setPreset }}>
      {children}
    </DateRangeContext.Provider>
  );
}

export function useDateRange() {
  const ctx = useContext(DateRangeContext);
  if (!ctx) throw new Error("useDateRange must be used within DateRangeProvider");
  return ctx;
}
