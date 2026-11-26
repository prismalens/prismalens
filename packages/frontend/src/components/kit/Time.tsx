// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Hint } from "@/components/shared/Hint";
import { formatDateTimeUtc } from "@/lib/format-time";
import { cn } from "@/lib/utils";
import { relTime } from "./rel-time";

/** A relative time on screen; its hint has the exact local time and UTC, its `dateTime` the instant. */
export function Time({
	at,
	now,
	prefix,
	past = false,
	ago = false,
	className,
	testId,
}: {
	at: string | number | Date;
	now: number | null;
	/** A word before the time that says what it is, e.g. "Resumes". */
	prefix?: string;
	/** It has happened: never reads as future when clocks disagree. */
	past?: boolean;
	/** After a prefix, an age reads "Checked 3m ago"; "now" stays "now". */
	ago?: boolean;
	className?: string;
	testId?: string;
}) {
	const when = new Date(at);
	if (Number.isNaN(when.getTime()) || now === null) return null;
	const exact = formatDateTimeUtc(when);
	const rel = relTime(when, now, { past });
	const word =
		ago && rel !== "now" && !rel.startsWith("in ") ? `${rel} ago` : rel;
	return (
		<Hint label={prefix ? `${prefix} ${exact}` : exact}>
			<time
				dateTime={when.toISOString()}
				className={cn("tabular-nums", className)}
				data-testid={testId}
			>
				{prefix ? `${prefix} ${word}` : word}
			</time>
		</Hint>
	);
}
