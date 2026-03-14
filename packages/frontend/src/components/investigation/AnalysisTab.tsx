import { Link } from "@tanstack/react-router";
import type { InvestigationWithRelations } from "@prismalens/contracts";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PriorityBadge } from "./investigation.utils";

interface AnalysisTabProps {
	investigation: InvestigationWithRelations;
}

export function AnalysisTab({ investigation }: AnalysisTabProps) {
	return (
		<div className="grid gap-6 md:grid-cols-2">
			{/* Root Cause */}
			<Card>
				<CardHeader>
					<CardTitle className="text-base">Root Cause Analysis</CardTitle>
				</CardHeader>
				<CardContent>
					{investigation.rootCause ? (
						<div className="p-4 bg-purple-50 dark:bg-purple-900/20 rounded-lg border border-purple-200 dark:border-purple-800">
							<p className="text-purple-900 dark:text-purple-100 font-medium">
								{investigation.rootCause}
							</p>
							<div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
								{investigation.confidence && (
									<span className="text-purple-700 dark:text-purple-300">
										Confidence:{" "}
										{(investigation.confidence * 100).toFixed(0)}%
									</span>
								)}
								{investigation.rootCauseCategory && (
									<Badge variant="outline">{investigation.rootCauseCategory}</Badge>
								)}
							</div>
						</div>
					) : (
						<p className="text-sm text-muted-foreground">
							Root cause analysis not available yet
						</p>
					)}
				</CardContent>
			</Card>

			{/* Data Sources */}
			<Card>
				<CardHeader>
					<CardTitle className="text-base">Data Sources Used</CardTitle>
				</CardHeader>
				<CardContent>
					{investigation.dataSourcesUsed &&
					investigation.dataSourcesUsed.length > 0 ? (
						<div className="flex flex-wrap gap-2">
							{investigation.dataSourcesUsed.map((source) => (
								<Badge key={source} variant="secondary">
									{source}
								</Badge>
							))}
						</div>
					) : (
						<p className="text-sm text-muted-foreground">
							No data sources recorded
						</p>
					)}
				</CardContent>
			</Card>

			{/* Recommendations */}
			<Card className="md:col-span-2">
				<CardHeader>
					<CardTitle className="text-base">
						Recommendations ({investigation.recommendations?.length ?? 0})
					</CardTitle>
				</CardHeader>
				<CardContent>
					{investigation.recommendations &&
					investigation.recommendations.length > 0 ? (
						<div className="space-y-3">
							{investigation.recommendations.map((rec) => (
								<div
									key={rec.id}
									className="p-3 bg-muted rounded-lg flex items-start justify-between"
								>
									<div>
										<p className="font-medium">{rec.title}</p>
										<div className="flex items-center gap-2 mt-1">
											<PriorityBadge priority={rec.priority} />
											<Badge variant="outline">{rec.status}</Badge>
										</div>
									</div>
									<Link
										to="/incidents/$id"
										params={{ id: investigation.incidentId }}
										className="text-sm text-primary hover:underline"
									>
										View in Incident
									</Link>
								</div>
							))}
						</div>
					) : (
						<p className="text-sm text-muted-foreground">
							No recommendations generated yet
						</p>
					)}
				</CardContent>
			</Card>

			{/* Metadata */}
			<Card className="md:col-span-2">
				<CardHeader>
					<CardTitle className="text-base">Investigation Metadata</CardTitle>
				</CardHeader>
				<CardContent>
					<div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
						<div>
							<span className="text-muted-foreground">Started</span>
							<p className="font-medium">
								{investigation.startedAt
									? new Date(investigation.startedAt).toLocaleString()
									: "-"}
							</p>
						</div>
						<div>
							<span className="text-muted-foreground">Completed</span>
							<p className="font-medium">
								{investigation.completedAt
									? new Date(investigation.completedAt).toLocaleString()
									: "-"}
							</p>
						</div>
						<div>
							<span className="text-muted-foreground">Created</span>
							<p className="font-medium">
								{new Date(investigation.createdAt).toLocaleString()}
							</p>
						</div>
						<div>
							<span className="text-muted-foreground">Last Updated</span>
							<p className="font-medium">
								{new Date(investigation.updatedAt).toLocaleString()}
							</p>
						</div>
					</div>

					{investigation.error && (
						<div className="mt-4 p-3 rounded bg-destructive/10 border border-destructive/20">
							<p className="text-sm text-destructive font-medium">Error</p>
							<p className="text-sm text-destructive/80">
								{investigation.error}
							</p>
						</div>
					)}
				</CardContent>
			</Card>
		</div>
	);
}
