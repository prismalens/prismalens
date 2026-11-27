// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	Calendar as SdkCalendar,
	CalendarDay as SdkCalendarDay,
	CalendarGrid as SdkCalendarGrid,
	CalendarHeading as SdkCalendarHeading,
	CalendarNext as SdkCalendarNext,
	CalendarPrevious as SdkCalendarPrevious,
	CalendarWeekday as SdkCalendarWeekday,
	CalendarWeekdays as SdkCalendarWeekdays,
	CalendarWeeks as SdkCalendarWeeks,
} from "@ui-sdk/react/calendar";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import type * as React from "react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function Calendar({
	className,
	...props
}: React.ComponentProps<typeof SdkCalendar>) {
	return (
		<SdkCalendar className={cn("p-3 [--cell-size:2rem]", className)} {...props}>
			<div className="flex items-center justify-between gap-1 pb-2">
				<SdkCalendarPrevious
					className={cn(
						buttonVariants({ variant: "ghost" }),
						"h-[--cell-size] w-[--cell-size] p-0",
					)}
				>
					<ChevronLeftIcon className="size-4" aria-hidden="true" />
				</SdkCalendarPrevious>
				<SdkCalendarHeading className="text-sm font-medium" />
				<SdkCalendarNext
					className={cn(
						buttonVariants({ variant: "ghost" }),
						"h-[--cell-size] w-[--cell-size] p-0",
					)}
				>
					<ChevronRightIcon className="size-4" aria-hidden="true" />
				</SdkCalendarNext>
			</div>
			<SdkCalendarGrid className="w-full">
				<SdkCalendarWeekdays className="flex">
					{(index) => (
						<SdkCalendarWeekday
							index={index}
							className="text-text-2 flex-1 rounded-md text-center text-[0.8rem] font-normal select-none"
						/>
					)}
				</SdkCalendarWeekdays>
				<SdkCalendarWeeks className="mt-2 flex w-full">
					{(cell) => (
						<SdkCalendarDay
							value={cell.date}
							className="inline-flex size-[--cell-size] items-center justify-center rounded-md text-sm font-normal hover:bg-surface-3 data-selected:bg-accent data-selected:text-accent-fg data-outside-month:text-text-3 data-disabled:opacity-50"
						/>
					)}
				</SdkCalendarWeeks>
			</SdkCalendarGrid>
		</SdkCalendar>
	);
}

export { Calendar };
