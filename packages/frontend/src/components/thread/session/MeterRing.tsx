// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { cn } from "@/lib/utils";
import { type MeterTone, meterTone } from "./session-words";

/** Only the mark is tinted (sheet §0.6): warn as the compaction point nears, danger past it. */
export const METER_TONE: Record<MeterTone, string> = {
	neutral: "text-text-3",
	warn: "text-warn",
	danger: "text-danger",
};

const R = 6;
const C = 2 * Math.PI * R;

/** A ring filled to the share of the context window in use, with a tick where it compacts. */
export function MeterRing({
	percent,
	autoAt,
	className,
}: {
	percent: number;
	/** The percent where the agent compacts by itself; the tone warns before it. */
	autoAt?: number | null;
	className?: string;
}) {
	const tone = meterTone(percent, autoAt);
	const angle = autoAt ? (autoAt / 100) * 2 * Math.PI : null;
	return (
		<svg
			viewBox="0 0 16 16"
			aria-hidden
			className={cn("size-4 -rotate-90", METER_TONE[tone], className)}
			data-tone={tone}
			data-testid="context-meter-ring"
		>
			<circle
				cx="8"
				cy="8"
				r={R}
				fill="none"
				strokeWidth="2"
				className="stroke-track"
			/>
			<circle
				cx="8"
				cy="8"
				r={R}
				fill="none"
				stroke="currentColor"
				strokeWidth="2"
				strokeLinecap="round"
				strokeDasharray={`${(percent / 100) * C} ${C}`}
			/>
			{angle !== null && (
				<line
					x1={8 + (R - 2) * Math.cos(angle)}
					y1={8 + (R - 2) * Math.sin(angle)}
					x2={8 + (R + 2) * Math.cos(angle)}
					y2={8 + (R + 2) * Math.sin(angle)}
					strokeWidth="1.25"
					className="stroke-text-1"
					data-testid="context-meter-auto"
				/>
			)}
		</svg>
	);
}
