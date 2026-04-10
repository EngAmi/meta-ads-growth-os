import { useState } from "react";
import { format } from "date-fns";
import { Calendar as CalendarIcon, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { useDateRange, PRESET_LABELS, getPresetRange, DatePreset } from "@/contexts/DateRangeContext";
import type { DateRange as DRType } from "react-day-picker";

const PRESETS: DatePreset[] = [
  "today", "yesterday", "last7", "last14", "last30", "last90",
  "thisWeek", "lastWeek", "thisMonth", "lastMonth",
];

export default function DateRangePicker() {
  const { dateRange, setDateRange, setPreset } = useDateRange();
  const [open, setOpen] = useState(false);
  const [calRange, setCalRange] = useState<DRType | undefined>({
    from: dateRange.from,
    to: dateRange.to,
  });

  const handlePreset = (preset: DatePreset) => {
    setPreset(preset);
    const r = getPresetRange(preset);
    setCalRange({ from: r.from, to: r.to });
    setOpen(false);
  };

  const handleCustomApply = () => {
    if (calRange?.from && calRange?.to) {
      setDateRange({ from: calRange.from, to: calRange.to, preset: "custom" });
      setOpen(false);
    }
  };

  const label = dateRange.preset !== "custom"
    ? PRESET_LABELS[dateRange.preset]
    : `${format(dateRange.from, "MMM d")} – ${format(dateRange.to, "MMM d, yyyy")}`;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline"
          className="h-9 gap-2 border-slate-700 bg-slate-800/60 text-slate-200 hover:bg-slate-700 hover:text-white text-sm font-medium">
          <CalendarIcon className="w-4 h-4 text-violet-400" />
          {label}
          <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-auto p-0 bg-slate-900 border-slate-700 shadow-2xl">
        <div className="flex">
          {/* Presets sidebar */}
          <div className="w-40 border-r border-slate-700 p-2 space-y-0.5">
            <p className="text-xs text-slate-500 font-medium uppercase tracking-wider px-2 py-1.5">Quick select</p>
            {PRESETS.map(preset => (
              <button
                key={preset}
                onClick={() => handlePreset(preset)}
                className={`w-full text-left text-sm px-3 py-1.5 rounded-lg transition-colors
                  ${dateRange.preset === preset
                    ? 'bg-violet-600 text-white font-medium'
                    : 'text-slate-300 hover:bg-slate-800 hover:text-white'}`}
              >
                {PRESET_LABELS[preset]}
              </button>
            ))}
          </div>

          {/* Calendar */}
          <div className="p-3">
            <p className="text-xs text-slate-500 font-medium uppercase tracking-wider mb-2">Custom range</p>
            <Calendar
              mode="range"
              selected={calRange}
              onSelect={setCalRange}
              numberOfMonths={2}
              className="text-slate-200"
              classNames={{
                months: "flex gap-4",
                month: "space-y-2",
                caption: "flex justify-center items-center gap-2 text-slate-200 font-medium",
                caption_label: "text-sm",
                nav: "flex items-center gap-1",
                nav_button: "h-7 w-7 bg-transparent text-slate-400 hover:text-white hover:bg-slate-700 rounded-md flex items-center justify-center",
                table: "w-full border-collapse",
                head_row: "flex",
                head_cell: "text-slate-500 rounded-md w-8 font-normal text-xs",
                row: "flex w-full mt-1",
                cell: "h-8 w-8 text-center text-sm p-0 relative [&:has([aria-selected].day-range-end)]:rounded-r-md [&:has([aria-selected].day-range-start)]:rounded-l-md [&:has([aria-selected])]:bg-violet-600/20 first:[&:has([aria-selected])]:rounded-l-md last:[&:has([aria-selected])]:rounded-r-md",
                day: "h-8 w-8 p-0 font-normal text-slate-300 hover:bg-slate-700 hover:text-white rounded-md aria-selected:opacity-100",
                day_range_start: "day-range-start bg-violet-600 text-white rounded-l-md hover:bg-violet-500",
                day_range_end: "day-range-end bg-violet-600 text-white rounded-r-md hover:bg-violet-500",
                day_selected: "bg-violet-600 text-white hover:bg-violet-500",
                day_today: "text-violet-400 font-semibold",
                day_outside: "text-slate-600 opacity-50",
                day_disabled: "text-slate-600 opacity-50",
                day_range_middle: "aria-selected:bg-violet-600/20 aria-selected:text-violet-200 rounded-none",
                day_hidden: "invisible",
              }}
            />
            <div className="flex justify-end mt-3 pt-3 border-t border-slate-700">
              <Button size="sm" onClick={handleCustomApply}
                disabled={!calRange?.from || !calRange?.to}
                className="bg-violet-600 hover:bg-violet-500 text-white h-8 text-xs">
                Apply Custom Range
              </Button>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
