// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Incidents Over Time Chart
 *
 * Line chart showing incident count by day or week
 */

import type { Incident } from "@prismalens/contracts";
import { chartColors } from "@prismalens/design-tokens/colors";
import { useMemo, useState } from "react";
import {
	Area,
	AreaChart,
	CartesianGrid,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from "recharts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
	groupIncidentsByDate,
	type TimeSeriesDataPoint,
} from "@/lib/analytics";

interface IncidentsOverTimeChartProps {
	incidents: Incident[];
	days?: number;
	className?: string;
}

export function IncidentsOverTimeChart({
	incidents,
	days = 30,
	className,
}: IncidentsOverTimeChartProps) {
	const [granularity, setGranularity] = useState<"day" | "week">("day");

	const data = useMemo(
		() => groupIncidentsByDate(incidents, granularity, days),
		[incidents, granularity, days],
	);

	const total = useMemo(
		() => data.reduce((sum, d) => sum + d.value, 0),
		[data],
	);

	return (
		<Card className={className}>
			<CardHeader className="flex flex-row items-center justify-between pb-2">
				<CardTitle className="text-base font-medium">
					Incidents Over Time
				</CardTitle>
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
				{data.length === 0 || total === 0 ? (
					<div className="flex items-center justify-center h-[200px] text-muted-foreground">
						No incidents in the selected period
					</div>
				) : (
					<ResponsiveContainer width="100%" height={200}>
						<AreaChart data={data}>
							<defs>
								<linearGradient
									id="incidentGradient"
									x1="0"
									y1="0"
									x2="0"
									y2="1"
								>
									<stop
										offset="5%"
										stopColor={chartColors.primary}
										stopOpacity={0.3}
									/>
									<stop
										offset="95%"
										stopColor={chartColors.primary}
										stopOpacity={0}
									/>
								</linearGradient>
							</defs>
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
								allowDecimals={false}
								width={30}
							/>
							<Tooltip
								content={({ active, payload }) => {
									if (!active || !payload?.length) return null;
									const data = payload[0].payload as TimeSeriesDataPoint;
									return (
										<div className="rounded-lg border bg-background p-2 shadow-sm">
											<p className="text-sm font-medium">{data.label}</p>
											<p className="text-sm text-muted-foreground">
												{data.value} incident{data.value !== 1 ? "s" : ""}
											</p>
										</div>
									);
								}}
							/>
							<Area
								type="monotone"
								dataKey="value"
								stroke={chartColors.primary}
								strokeWidth={2}
								fill="url(#incidentGradient)"
							/>
						</AreaChart>
					</ResponsiveContainer>
				)}
			</CardContent>
		</Card>
	);
}
