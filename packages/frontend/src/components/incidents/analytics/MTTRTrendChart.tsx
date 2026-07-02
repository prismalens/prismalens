/**
 * MTTR Trend Chart
 *
 * Line chart showing Mean Time to Resolve trend over time
 */

import type { Incident } from "@prismalens/contracts";
import { chartColors } from "@prismalens/design-tokens/colors";
import { useMemo, useState } from "react";
import {
	CartesianGrid,
	Line,
	LineChart,
	ReferenceLine,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from "recharts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
	calculateMTTR,
	formatDuration,
	groupMTTRByDate,
	type MTTRDataPoint,
} from "@/lib/analytics";

interface MTTRTrendChartProps {
	incidents: Incident[];
	days?: number;
	className?: string;
}

export function MTTRTrendChart({
	incidents,
	days = 30,
	className,
}: MTTRTrendChartProps) {
	const [granularity, setGranularity] = useState<"day" | "week">("day");

	const data = useMemo(
		() => groupMTTRByDate(incidents, granularity, days),
		[incidents, granularity, days],
	);

	// Filter to only show days with data
	const filteredData = useMemo(() => data.filter((d) => d.count > 0), [data]);

	const avgMTTR = useMemo(() => calculateMTTR(incidents), [incidents]);

	const hasData = filteredData.length > 0;

	return (
		<Card className={className}>
			<CardHeader className="flex flex-row items-center justify-between pb-2">
				<div>
					<CardTitle className="text-base font-medium">MTTR Trend</CardTitle>
					{avgMTTR != null && (
						<p className="text-sm text-muted-foreground">
							Average: {formatDuration(avgMTTR)}
						</p>
					)}
				</div>
				<div className="flex gap-1">
					<Button
						variant={granularity === "day" ? "secondary" : "ghost"}
						size="sm"
						onClick={() => setGranularity("day")}
					>
						Daily
					</Button>
					<Button
						variant={granularity === "week" ? "secondary" : "ghost"}
						size="sm"
						onClick={() => setGranularity("week")}
					>
						Weekly
					</Button>
				</div>
			</CardHeader>
			<CardContent>
				{!hasData ? (
					<div className="flex items-center justify-center h-[200px] text-muted-foreground">
						No resolved incidents in the selected period
					</div>
				) : (
					<ResponsiveContainer width="100%" height={200}>
						<LineChart data={filteredData}>
							<CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
							<XAxis
								dataKey="label"
								tick={{ fontSize: 12 }}
								tickLine={false}
								axisLine={false}
								interval="preserveStartEnd"
							/>
							<YAxis
								tick={{ fontSize: 12 }}
								tickLine={false}
								axisLine={false}
								width={40}
								tickFormatter={(value) => formatDuration(value)}
							/>
							<Tooltip
								content={({ active, payload }) => {
									if (!active || !payload?.length) return null;
									const data = payload[0].payload as MTTRDataPoint;
									return (
										<div className="rounded-lg border bg-background p-2 shadow-sm">
											<p className="text-sm font-medium">{data.label}</p>
											<p className="text-sm text-muted-foreground">
												MTTR: {formatDuration(data.mttr)}
											</p>
											<p className="text-xs text-muted-foreground">
												{data.count} incident{data.count !== 1 ? "s" : ""}{" "}
												resolved
											</p>
										</div>
									);
								}}
							/>
							{avgMTTR != null && (
								<ReferenceLine
									y={avgMTTR}
									stroke={chartColors.muted}
									strokeDasharray="5 5"
									label={{
										value: "Avg",
										position: "right",
										fontSize: 10,
										fill: chartColors.muted,
									}}
								/>
							)}
							<Line
								type="monotone"
								dataKey="mttr"
								stroke={chartColors.success}
								strokeWidth={2}
								dot={{ r: 3, fill: chartColors.success }}
								activeDot={{ r: 5 }}
							/>
						</LineChart>
					</ResponsiveContainer>
				)}
			</CardContent>
		</Card>
	);
}
