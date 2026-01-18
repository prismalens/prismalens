/**
 * Severity Distribution Chart
 *
 * Pie chart showing incidents by severity level
 */

import { useMemo } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import type { Incident } from "@prismalens/contracts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { groupIncidentsBySeverity, type PieChartDataPoint } from "@/lib/analytics";

interface SeverityDistributionChartProps {
	incidents: Incident[];
	onSeverityClick?: (severity: string) => void;
	className?: string;
}

export function SeverityDistributionChart({
	incidents,
	onSeverityClick,
	className,
}: SeverityDistributionChartProps) {
	const data = useMemo(
		() => groupIncidentsBySeverity(incidents),
		[incidents]
	);

	const total = useMemo(
		() => data.reduce((sum, d) => sum + d.value, 0),
		[data]
	);

	const handleClick = (data: PieChartDataPoint) => {
		if (onSeverityClick) {
			onSeverityClick(data.name.toLowerCase());
		}
	};

	return (
		<Card className={className}>
			<CardHeader className="pb-2">
				<CardTitle className="text-base font-medium">By Severity</CardTitle>
			</CardHeader>
			<CardContent>
				{total === 0 ? (
					<div className="flex items-center justify-center h-[200px] text-muted-foreground">
						No incidents
					</div>
				) : (
					<div className="flex items-center gap-4">
						<ResponsiveContainer width={140} height={140}>
							<PieChart>
								<Pie
									data={data}
									dataKey="value"
									nameKey="name"
									cx="50%"
									cy="50%"
									innerRadius={35}
									outerRadius={60}
									paddingAngle={2}
									onClick={(_, index) => handleClick(data[index])}
									cursor={onSeverityClick ? "pointer" : "default"}
								>
									{data.map((entry, index) => (
										<Cell
											key={`cell-${index}`}
											fill={entry.color}
											className="hover:opacity-80 transition-opacity"
										/>
									))}
								</Pie>
								<Tooltip
									content={({ active, payload }) => {
										if (!active || !payload?.length) return null;
										const data = payload[0].payload as PieChartDataPoint;
										const percent = Math.round((data.value / total) * 100);
										return (
											<div className="rounded-lg border bg-background p-2 shadow-sm">
												<p className="text-sm font-medium">{data.name}</p>
												<p className="text-sm text-muted-foreground">
													{data.value} ({percent}%)
												</p>
											</div>
										);
									}}
								/>
							</PieChart>
						</ResponsiveContainer>
						<div className="flex flex-col gap-2">
							{data.map((entry) => (
								<button
									key={entry.name}
									onClick={() => handleClick(entry)}
									disabled={!onSeverityClick}
									className="flex items-center gap-2 text-sm hover:opacity-80 disabled:cursor-default"
								>
									<span
										className="w-3 h-3 rounded-full"
										style={{ backgroundColor: entry.color }}
									/>
									<span>{entry.name}</span>
									<span className="text-muted-foreground">({entry.value})</span>
								</button>
							))}
						</div>
					</div>
				)}
			</CardContent>
		</Card>
	);
}
