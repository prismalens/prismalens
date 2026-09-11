/**
 * One investigation, in place on the incident screen (#599, #337 rulings of
 * 2026-09-11). The live stream stays mounted and becomes the replay ledger when
 * the run ends; a failed run shows the error, the last events and where the
 * transcript is; the report renders beneath.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, RefreshCw, XCircle } from "lucide-react";
import { useEffect } from "react";
import { AnalysisTab } from "@/components/investigation/AnalysisTab";
import { InvestigationDetailSkeleton } from "@/components/investigation/InvestigationDetailSkeleton";
import { InvestigationStreamPanel } from "@/components/investigation/InvestigationStreamPanel";
import { InvestigationStatusBadge } from "@/components/investigation/investigation.utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useInvestigationEventsHistory } from "@/lib/api/hooks/use-investigation-events";
import { useInvestigationStream } from "@/lib/api/hooks/use-investigation-stream";
import {
	investigationKeys,
	useCancelInvestigation,
} from "@/lib/api/hooks/use-investigations-orpc";
import { orpc } from "@/lib/api/orpc-client";

interface InvestigationPanelProps {
	investigationId: string;
}

export function InvestigationPanel({
	investigationId,
}: InvestigationPanelProps) {
	const queryClient = useQueryClient();
	const {
		data: investigation,
		isLoading,
		error,
		refetch,
		isRefetching,
	} = useQuery(
		orpc.investigations.get.queryOptions({ input: { id: investigationId } }),
	);

	const isActive =
		investigation?.status === "running" || investigation?.status === "pending";
	const cancelInvestigation = useCancelInvestigation();
	const stream = useInvestigationStream(investigationId, { enabled: isActive });
	const history = useInvestigationEventsHistory(investigationId, {
		enabled: !!investigation && !isActive,
	});
	const events = isActive ? stream.events : (history.data ?? []);

	useEffect(() => {
		if (stream.status === "completed" || stream.status === "failed") {
			queryClient.invalidateQueries({
				queryKey: investigationKeys.detail(investigationId),
			});
			queryClient.invalidateQueries({ queryKey: investigationKeys.lists() });
			queryClient.invalidateQueries({ queryKey: ["incidents"] });
		}
	}, [stream.status, investigationId, queryClient]);

	if (isLoading) return <InvestigationDetailSkeleton />;
	if (error || !investigation) {
		return (
			<div
				className="flex flex-col items-center justify-center py-12"
				data-testid="investigation-load-error"
			>
				<AlertCircle className="h-12 w-12 mb-4 text-destructive" />
				<p className="text-lg font-medium text-destructive">
					Failed to load investigation
				</p>
				<p className="text-sm text-muted-foreground">
					{error?.message || "Investigation not found"}
				</p>
			</div>
		);
	}

	const failed =
		investigation.status === "failed" || investigation.status === "cancelled";
	const ledgerStatus = isActive
		? stream.status === "error"
			? "connecting"
			: stream.status
		: failed
			? "failed"
			: "completed";

	return (
		<div className="space-y-6" data-testid="investigation-panel">
			<div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
				<div className="space-y-1">
					<div className="flex items-center gap-3">
						<h2 className="text-lg font-semibold">Investigation</h2>
						<InvestigationStatusBadge status={investigation.status} />
					</div>
					<p className="text-xs font-mono text-muted-foreground">
						{investigation.id}
					</p>
					{investigation.summary && (
						<p className="text-sm text-muted-foreground max-w-2xl">
							{investigation.summary}
						</p>
					)}
				</div>
				<div className="flex items-center gap-2">
					<Button
						variant="outline"
						size="sm"
						onClick={() => refetch()}
						disabled={isRefetching}
					>
						<RefreshCw
							className={`h-4 w-4 mr-2 ${isRefetching ? "animate-spin" : ""}`}
						/>
						Refresh
					</Button>
					{isActive && (
						<Button
							variant="destructive"
							size="sm"
							onClick={() =>
								cancelInvestigation.mutate({ id: investigationId })
							}
							disabled={cancelInvestigation.isPending}
						>
							<XCircle className="h-4 w-4 mr-2" />
							{cancelInvestigation.isPending ? "Cancelling..." : "Cancel"}
						</Button>
					)}
				</div>
			</div>

			{failed && (
				<Card
					className="border-destructive/40"
					data-testid="investigation-failed-state"
				>
					<CardHeader className="pb-2">
						<CardTitle className="text-base text-destructive">
							{investigation.status === "cancelled"
								? "Investigation cancelled"
								: "Investigation failed"}
						</CardTitle>
					</CardHeader>
					<CardContent className="space-y-2 text-sm">
						<p className="font-mono whitespace-pre-wrap">
							{investigation.error ?? "No error was recorded."}
						</p>
						<p className="text-muted-foreground">
							The last events the harness sent are in the ledger below. The raw
							wire transcript is at{" "}
							<code className="font-mono">
								~/.prismalens/runs/{investigation.id}/transcript.jsonl
							</code>{" "}
							on the machine running prismalens.
						</p>
					</CardContent>
				</Card>
			)}

			<InvestigationStreamPanel
				key={investigationId}
				events={events}
				latestText={isActive ? stream.latestText : null}
				status={ledgerStatus}
			/>

			{isActive && stream.status === "error" && (
				<p
					className="text-xs text-muted-foreground"
					data-testid="stream-fallback-message"
				>
					Live stream unavailable; the ledger refreshes when the run ends.
				</p>
			)}

			{!isActive && !failed && <AnalysisTab investigation={investigation} />}
		</div>
	);
}
