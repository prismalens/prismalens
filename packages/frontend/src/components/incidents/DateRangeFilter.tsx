/**
 * Date Range Filter Component
 *
 * Quick date range buttons + custom date picker for filtering incidents.
 * All dates are handled in UTC for API calls, displayed in local timezone.
 */

import { format } from "date-fns";
import { Calendar as CalendarIcon } from "lucide-react";
import { useState } from "react";
import type { DateRange } from "react-day-picker";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export type QuickRange =
	| "today"
	| "this-week"
	| "this-month"
	| "last-30-days"
	| "all"
	| "custom";

export interface DateRangeValue {
	from: Date | undefined;
	to: Date | undefined;
}

export interface DateRangeFilterProps {
	value: DateRangeValue;
	onChange: (value: DateRangeValue) => void;
	className?: string;
}

// Helper to get start of day in local timezone
function startOfLocalDay(date: Date): Date {
	return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

// Helper to get end of day in local timezone
function endOfLocalDay(date: Date): Date {
	return new Date(
		date.getFullYear(),
		date.getMonth(),
		date.getDate(),
		23,
		59,
		59,
		999,
	);
}

// Helper to get start of week (Sunday) in local timezone
function startOfLocalWeek(date: Date): Date {
	const d = new Date(date);
	const day = d.getDay();
	d.setDate(d.getDate() - day);
	return startOfLocalDay(d);
}

// Helper to get start of month in local timezone
function startOfLocalMonth(date: Date): Date {
	return new Date(date.getFullYear(), date.getMonth(), 1);
}

// Get date range for quick buttons
function getQuickRange(range: QuickRange): DateRangeValue {
	const now = new Date();

	switch (range) {
		case "today":
			return {
				from: startOfLocalDay(now),
				to: endOfLocalDay(now),
			};
		case "this-week": {
			return {
				from: startOfLocalWeek(now),
				to: endOfLocalDay(now),
			};
		}
		case "this-month": {
			return {
				from: startOfLocalMonth(now),
				to: endOfLocalDay(now),
			};
		}
		case "last-30-days": {
			const thirtyDaysAgo = new Date(now);
			thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
			return {
				from: startOfLocalDay(thirtyDaysAgo),
				to: endOfLocalDay(now),
			};
		}
		case "all":
			return {
				from: undefined,
				to: undefined,
			};
		case "custom":
		default:
			return {
				from: undefined,
				to: undefined,
			};
	}
}

// Determine which quick button is active based on current value
function getActiveQuickRange(value: DateRangeValue): QuickRange | null {
	if (!value.from && !value.to) {
		return "all";
	}

	const now = new Date();
	const today = getQuickRange("today");
	const thisWeek = getQuickRange("this-week");
	const thisMonth = getQuickRange("this-month");
	const last30 = getQuickRange("last-30-days");

	if (
		value.from?.getTime() === today.from?.getTime() &&
		value.to &&
		today.to &&
		Math.abs(value.to.getTime() - today.to.getTime()) < 1000
	) {
		return "today";
	}

	if (
		value.from?.getTime() === thisWeek.from?.getTime() &&
		value.to &&
		thisWeek.to &&
		Math.abs(value.to.getTime() - thisWeek.to.getTime()) < 1000
	) {
		return "this-week";
	}

	if (
		value.from?.getTime() === thisMonth.from?.getTime() &&
		value.to &&
		thisMonth.to &&
		Math.abs(value.to.getTime() - thisMonth.to.getTime()) < 1000
	) {
		return "this-month";
	}

	if (
		value.from?.getTime() === last30.from?.getTime() &&
		value.to &&
		last30.to &&
		Math.abs(value.to.getTime() - last30.to.getTime()) < 1000
	) {
		return "last-30-days";
	}

	return "custom";
}

export function DateRangeFilter({
	value,
	onChange,
	className,
}: DateRangeFilterProps) {
	const [calendarOpen, setCalendarOpen] = useState(false);
	const activeRange = getActiveQuickRange(value);

	const handleQuickRangeClick = (range: QuickRange) => {
		onChange(getQuickRange(range));
	};

	const handleCalendarSelect = (range: DateRange | undefined) => {
		if (range) {
			onChange({
				from: range.from ? startOfLocalDay(range.from) : undefined,
				to: range.to ? endOfLocalDay(range.to) : undefined,
			});
		} else {
			onChange({ from: undefined, to: undefined });
		}
	};

	const formatDateRange = () => {
		if (!value.from && !value.to) {
			return "All time";
		}
		if (value.from && value.to) {
			return `${format(value.from, "MMM d, yyyy")} - ${format(value.to, "MMM d, yyyy")}`;
		}
		if (value.from) {
			return `From ${format(value.from, "MMM d, yyyy")}`;
		}
		if (value.to) {
			return `Until ${format(value.to, "MMM d, yyyy")}`;
		}
		return "Select dates";
	};

	return (
		<div className={cn("flex flex-wrap items-center gap-2", className)}>
			{/* Quick range buttons */}
			<div className="flex items-center gap-1">
				<Button
					variant={activeRange === "all" ? "secondary" : "ghost"}
					size="sm"
					onClick={() => handleQuickRangeClick("all")}
				>
					All
				</Button>
				<Button
					variant={activeRange === "today" ? "secondary" : "ghost"}
					size="sm"
					onClick={() => handleQuickRangeClick("today")}
				>
					Today
				</Button>
				<Button
					variant={activeRange === "this-week" ? "secondary" : "ghost"}
					size="sm"
					onClick={() => handleQuickRangeClick("this-week")}
				>
					This Week
				</Button>
				<Button
					variant={activeRange === "this-month" ? "secondary" : "ghost"}
					size="sm"
					onClick={() => handleQuickRangeClick("this-month")}
				>
					This Month
				</Button>
				<Button
					variant={activeRange === "last-30-days" ? "secondary" : "ghost"}
					size="sm"
					onClick={() => handleQuickRangeClick("last-30-days")}
				>
					Last 30 Days
				</Button>
			</div>

			{/* Custom date picker */}
			<Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
				<PopoverTrigger asChild>
					<Button
						variant={activeRange === "custom" ? "secondary" : "outline"}
						size="sm"
						className={cn(
							"justify-start text-left font-normal",
							activeRange === "custom" && "bg-secondary",
						)}
					>
						<CalendarIcon className="mr-2 h-4 w-4" />
						{activeRange === "custom" ? formatDateRange() : "Custom"}
					</Button>
				</PopoverTrigger>
				<PopoverContent className="w-auto p-0" align="start">
					<Calendar
						initialFocus
						mode="range"
						defaultMonth={value.from}
						selected={{
							from: value.from,
							to: value.to,
						}}
						onSelect={handleCalendarSelect}
						numberOfMonths={2}
					/>
					<div className="flex items-center justify-between border-t p-3">
						<div className="text-sm text-muted-foreground">
							{formatDateRange()}
						</div>
						<Button
							size="sm"
							variant="ghost"
							onClick={() => {
								onChange({ from: undefined, to: undefined });
								setCalendarOpen(false);
							}}
						>
							Clear
						</Button>
					</div>
				</PopoverContent>
			</Popover>
		</div>
	);
}
