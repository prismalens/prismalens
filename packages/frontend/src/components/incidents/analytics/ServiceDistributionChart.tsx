/**
 * Service Distribution Chart
 *
 * Horizontal bar chart showing incidents by service
 */

import { useMemo } from "react";
import {
	Bar,
	BarChart,
	CartesianGrid,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from "recharts";
import type { IncidentWithRelations } from "@prismalens/contracts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { groupIncidentsByService, type BarChartDataPoint } from "@/lib/analytics";

interface ServiceDistributionChartProps {
	incidents: IncidentWithRelations[];
	onServiceClick?: (serviceId: string) => void;
	className?: string;
}

export function ServiceDistributionChart({
	incidents,
	onServiceClick,
	className,
}: ServiceDistributionChartProps) {
	const data = useMemo(
		() => groupIncidentsByService(incidents),
		[incidents]
	);

	const total = useMemo(
		() => data.reduce((sum, d) => sum + d.value, 0),
		[data]
	);

	const handleClick = (data: BarChartDataPoint) => {
		if (onServiceClick && data.id) {
			onServiceClick(data.id);
		}
	};

	return (
		<Card className={className}>
			<CardHeader className="pb-2">
				<CardTitle className="text-base font-medium">By Service</CardTitle>
			</CardHeader>
			<CardContent>
				{total === 0 ? (
					<div className="flex items-center justify-center h-[200px] text-muted-foreground">
						No incidents
					</div>
				) : (
					<ResponsiveContainer width="100%" height={200}>
						<BarChart data={data} layout="vertical" margin={{ left: 10 }}>
							<CartesianGrid
								strokeDasharray="3 3"
								className="stroke-muted"
								horizontal={true}
								vertical={false}
							/>
							<XAxis
								type="number"
								tick={{ fontSize: 12 }}
								tickLine={false}
								axisLine={false}
								allowDecimals={false}
							/>
							<YAxis
								type="category"
								dataKey="name"
								tick={{ fontSize: 12 }}
								tickLine={false}
								axisLine={false}
								width={100}
								tickFormatter={(value) =>
									value.length > 12 ? `${value.slice(0, 12)}...` : value
								}
							/>
							<Tooltip
								content={({ active, payload }) => {
									if (!active || !payload?.length) return null;
									const data = payload[0].payload as BarChartDataPoint;
									return (
										<div className="rounded-lg border bg-background p-2 shadow-sm">
											<p className="text-sm font-medium">{data.name}</p>
											<p className="text-sm text-muted-foreground">
												{data.value} incident{data.value !== 1 ? "s" : ""}
											</p>
										</div>
									);
								}}
							/>
							<Bar
								dataKey="value"
								fill="#8b5cf6"
								radius={[0, 4, 4, 0]}
								onClick={(_, index) => handleClick(data[index])}
								style={{ cursor: onServiceClick ? "pointer" : "default" }}
								className="hover:opacity-80"
							/>
						</BarChart>
					</ResponsiveContainer>
				)}
			</CardContent>
		</Card>
	);
}
