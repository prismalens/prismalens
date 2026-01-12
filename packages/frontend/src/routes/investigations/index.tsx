import { createFileRoute, Link } from "@tanstack/react-router";
import { Activity, AlertCircle, CheckCircle, Clock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/investigations/")({
	component: InvestigationsPage,
});

function InvestigationsPage() {
	// Mock data - will be replaced with API calls
	const investigations = [
		{
			id: "case_abc123",
			alertName: "HTTP 500 Errors Spike",
			service: "auth-service",
			status: "completed",
			confidence: 0.87,
			startedAt: "2024-01-15T10:30:00Z",
			completedAt: "2024-01-15T10:35:00Z",
		},
		{
			id: "case_def456",
			alertName: "High Memory Usage",
			service: "todo-app-api",
			status: "running",
			confidence: null,
			startedAt: "2024-01-15T10:40:00Z",
			completedAt: null,
		},
		{
			id: "case_ghi789",
			alertName: "Database Connection Timeout",
			service: "payment-gateway",
			status: "completed",
			confidence: 0.92,
			startedAt: "2024-01-15T09:15:00Z",
			completedAt: "2024-01-15T09:22:00Z",
		},
	];

	return (
		<div className="px-4 py-6 sm:px-0">
			<div className="flex justify-between items-center mb-8">
				<h1 className="text-3xl font-bold text-foreground">Investigations</h1>
				<Button>New Investigation</Button>
			</div>

			{/* Investigations Table */}
			<Card>
				<CardContent className="p-0">
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Case ID</TableHead>
								<TableHead>Alert</TableHead>
								<TableHead>Service</TableHead>
								<TableHead>Status</TableHead>
								<TableHead>Confidence</TableHead>
								<TableHead>Duration</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{investigations.map((investigation) => (
								<TableRow key={investigation.id} className="cursor-pointer">
									<TableCell>
										<Link
											to="/investigations/$id"
											params={{ id: investigation.id }}
											className="text-primary hover:text-primary/80 font-mono text-sm"
										>
											{investigation.id}
										</Link>
									</TableCell>
									<TableCell>
										<span className="text-sm text-foreground">
											{investigation.alertName}
										</span>
									</TableCell>
									<TableCell>
										<Badge variant="secondary">{investigation.service}</Badge>
									</TableCell>
									<TableCell>
										<StatusBadge status={investigation.status} />
									</TableCell>
									<TableCell>
										{investigation.confidence ? (
											<div className="flex items-center">
												<div className="w-16 bg-muted rounded-full h-2 mr-2">
													<div
														className="bg-green-500 h-2 rounded-full"
														style={{
															width: `${investigation.confidence * 100}%`,
														}}
													/>
												</div>
												<span className="text-sm text-muted-foreground">
													{(investigation.confidence * 100).toFixed(0)}%
												</span>
											</div>
										) : (
											<span className="text-sm text-muted-foreground">-</span>
										)}
									</TableCell>
									<TableCell className="text-sm text-muted-foreground">
										{investigation.completedAt
											? calculateDuration(
													investigation.startedAt,
													investigation.completedAt,
												)
											: "In progress..."}
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				</CardContent>
			</Card>
		</div>
	);
}

function StatusBadge({ status }: { status: string }) {
	const statusConfig = {
		completed: {
			icon: CheckCircle,
			variant: "secondary" as const,
			className:
				"bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
		},
		running: {
			icon: Activity,
			variant: "secondary" as const,
			className:
				"bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
		},
		failed: {
			icon: AlertCircle,
			variant: "destructive" as const,
			className: "",
		},
		pending: {
			icon: Clock,
			variant: "secondary" as const,
			className:
				"bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
		},
	};

	const config =
		statusConfig[status as keyof typeof statusConfig] || statusConfig.pending;
	const Icon = config.icon;

	return (
		<Badge variant={config.variant} className={config.className}>
			<Icon className="w-3 h-3 mr-1" />
			{status}
		</Badge>
	);
}

function calculateDuration(start: string, end: string): string {
	const startDate = new Date(start);
	const endDate = new Date(end);
	const diffMs = endDate.getTime() - startDate.getTime();
	const diffMins = Math.floor(diffMs / 60000);
	const diffSecs = Math.floor((diffMs % 60000) / 1000);
	return `${diffMins}m ${diffSecs}s`;
}
