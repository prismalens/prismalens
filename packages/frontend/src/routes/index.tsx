import { createFileRoute } from "@tanstack/react-router";
import { Activity, AlertCircle, CheckCircle, Clock } from "lucide-react";
import { ApiStatusCheck } from "@/components/ApiStatusCheck";
import { Badge } from "@/components/ui/badge";
import {
	Card,
	CardContent,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";

export const Route = createFileRoute("/")({
	component: Home,
});

function Home() {
	return (
		<div className="px-4 py-6 sm:px-0">
			<div className="flex justify-between items-center mb-8">
				<h1 className="text-3xl font-bold text-foreground">Dashboard</h1>
				<ApiStatusCheck />
			</div>

			{/* Stats Grid */}
			<div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4 mb-8">
				<StatCard
					title="Active Alerts"
					value="3"
					icon={<AlertCircle className="h-6 w-6 text-red-500" />}
					trend="+2 from yesterday"
				/>
				<StatCard
					title="Investigations"
					value="12"
					icon={<Activity className="h-6 w-6 text-blue-500" />}
					trend="5 in progress"
				/>
				<StatCard
					title="Resolved Today"
					value="8"
					icon={<CheckCircle className="h-6 w-6 text-green-500" />}
					trend="92% success rate"
				/>
				<StatCard
					title="Avg Resolution Time"
					value="4.2m"
					icon={<Clock className="h-6 w-6 text-amber-500" />}
					trend="-30% from last week"
				/>
			</div>

			{/* Recent Alerts */}
			<Card>
				<CardHeader>
					<CardTitle>Recent Alerts</CardTitle>
				</CardHeader>
				<CardContent className="p-0">
					<div className="divide-y divide-border">
						<AlertItem
							title="High Memory Usage"
							service="todo-app-api"
							severity="warning"
							time="5 minutes ago"
						/>
						<AlertItem
							title="HTTP 500 Errors Spike"
							service="auth-service"
							severity="critical"
							time="12 minutes ago"
						/>
						<AlertItem
							title="Slow Response Times"
							service="payment-gateway"
							severity="warning"
							time="1 hour ago"
						/>
					</div>
				</CardContent>
			</Card>
		</div>
	);
}

function StatCard({
	title,
	value,
	icon,
	trend,
}: {
	title: string;
	value: string;
	icon: React.ReactNode;
	trend: string;
}) {
	return (
		<Card>
			<CardContent className="pt-5">
				<div className="flex items-center">
					<div className="flex-shrink-0">{icon}</div>
					<div className="ml-5 w-0 flex-1">
						<p className="text-sm font-medium text-muted-foreground truncate">
							{title}
						</p>
						<p className="text-2xl font-semibold text-foreground">{value}</p>
					</div>
				</div>
			</CardContent>
			<CardFooter className="bg-muted/50 py-3">
				<p className="text-sm text-muted-foreground">{trend}</p>
			</CardFooter>
		</Card>
	);
}

function AlertItem({
	title,
	service,
	severity,
	time,
}: {
	title: string;
	service: string;
	severity: "critical" | "warning" | "info";
	time: string;
}) {
	const severityVariant = {
		critical: "destructive",
		warning: "secondary",
		info: "outline",
	} as const;

	return (
		<div className="px-4 py-4 sm:px-6 hover:bg-accent/10 cursor-pointer transition-colors">
			<div className="flex items-center justify-between">
				<div className="flex-1 min-w-0">
					<p className="text-sm font-medium text-foreground truncate">
						{title}
					</p>
					<p className="text-sm text-muted-foreground">{service}</p>
				</div>
				<div className="flex items-center space-x-4">
					<Badge variant={severityVariant[severity]}>{severity}</Badge>
					<span className="text-sm text-muted-foreground">{time}</span>
				</div>
			</div>
		</div>
	);
}
