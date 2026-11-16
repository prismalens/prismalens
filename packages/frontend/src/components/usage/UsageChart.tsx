// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { UsageDay } from "@prismalens/contracts";
import {
	Bar,
	BarChart,
	CartesianGrid,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from "recharts";
import { bucketLabel, formatCost, formatTokens } from "./usage-math";

export type UsageMeasure = "tokens" | "cost";

interface Point {
	key: string;
	label: string;
	value: number;
	text: string;
}

const TICK = { fill: "var(--text-3)", fontSize: 12 };

/** One series of bars over the range's days (hours for 24h); an unpriced bucket plots 0 and says Unpriced. */
export function UsageChart({
	days,
	step,
	measure,
	height = 160,
	label,
}: {
	days: UsageDay[];
	step: "hour" | "day";
	measure: UsageMeasure;
	height?: number;
	label: string;
}) {
	const points: Point[] = days.map((d) => ({
		key: d.day,
		label: bucketLabel(d.day, step),
		value: measure === "tokens" ? d.tokens.total : (d.cost.amount ?? 0),
		text:
			measure === "tokens"
				? `${formatTokens(d.tokens.total)} tokens`
				: d.turns === 0
					? "Nothing reported"
					: formatCost(d.cost.amount, d.cost.currency),
	}));
	const currency = days[0]?.cost.currency ?? "USD";
	return (
		<figure aria-label={label} className="min-w-0" style={{ height }}>
			<ResponsiveContainer width="100%" height="100%">
				<BarChart
					data={points}
					margin={{ top: 4, right: 0, bottom: 0, left: 0 }}
					barCategoryGap={2}
				>
					<CartesianGrid vertical={false} stroke="var(--hairline)" />
					<XAxis
						dataKey="label"
						tick={TICK}
						tickLine={false}
						axisLine={false}
						interval="preserveStartEnd"
						minTickGap={16}
					/>
					<YAxis
						tick={TICK}
						tickLine={false}
						axisLine={false}
						width={48}
						allowDecimals={measure === "cost"}
						tickFormatter={(v: number) =>
							measure === "tokens" ? formatTokens(v) : formatCost(v, currency)
						}
					/>
					<Tooltip
						cursor={{ fill: "var(--surface-3)" }}
						isAnimationActive={false}
						content={({ active, payload }) => {
							const p = payload?.[0]?.payload as Point | undefined;
							if (!active || !p) return null;
							return (
								<div className="floating rounded-control px-2.5 py-1.5 text-meta">
									<div className="text-text-2">{p.label}</div>
									<div className="font-medium text-text-1 tabular-nums">
										{p.text}
									</div>
								</div>
							);
						}}
					/>
					<Bar
						dataKey="value"
						fill="var(--accent)"
						radius={[4, 4, 0, 0]}
						maxBarSize={24}
						isAnimationActive={false}
					/>
				</BarChart>
			</ResponsiveContainer>
		</figure>
	);
}
