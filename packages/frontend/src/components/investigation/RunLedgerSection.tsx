// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { IncidentWithRelations } from "@prismalens/contracts";
import { AlertCircle } from "lucide-react";
import { InvestigationDetailSkeleton } from "@/components/investigation/InvestigationDetailSkeleton";
import { InvestigationStreamPanel } from "@/components/investigation/InvestigationStreamPanel";
import { Mono } from "@/components/shared/Mono";
import { RecordSection } from "@/components/shared/RecordSection";
import { StateChip } from "@/components/shared/StateChip";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import type { InvestigationRun } from "./useInvestigationRun";

interface RunLedgerSectionProps {
	run: InvestigationRun;
	/** Every run on the incident, newest first, for the picker. */
	runs: NonNullable<IncidentWithRelations["investigations"]>;
	selectedId: string;
	onSelect: (id: string) => void;
}

/**
 * The run ledger: the harness's canonical event stream, one row per event,
 * grouped by branch when the run fanned out. Live while it runs; the same rows
 * replayed from history afterwards. A failed run shows its error, its last
 * events and where the transcript is (ADR-0008 §3).
 */
export function RunLedgerSection({
	run,
	runs,
	selectedId,
	onSelect,
}: RunLedgerSectionProps) {
	const { investigation } = run;

	return (
		<RecordSection
			id="ledger"
			title="Run ledger"
			count={run.events.length || undefined}
			actions={
				runs.length > 1 ? (
					<div
						className="flex flex-wrap items-center gap-1"
						data-testid="investigation-history"
					>
						{runs.map((inv, i) => (
							<Button
								key={inv.id}
								variant={inv.id === selectedId ? "secondary" : "ghost"}
								size="sm"
								className="h-6 px-2 font-mono text-meta"
								onClick={() => onSelect(inv.id)}
							>
								#{runs.length - i} · {inv.status}
							</Button>
						))}
					</div>
				) : undefined
			}
		>
			<div data-testid="investigation-panel">
				{run.isLoading && <InvestigationDetailSkeleton />}

				{!run.isLoading && (run.error || !investigation) && (
					<div
						className="flex flex-col items-center justify-center py-8"
						data-testid="investigation-load-error"
					>
						<AlertCircle className="mb-3 h-8 w-8 text-run-failed" />
						<p className="text-record font-medium text-run-failed">
							Failed to load the run
						</p>
						<p className="text-meta text-muted-foreground">
							{run.error?.message || "Investigation not found"}
						</p>
					</div>
				)}

				{investigation && (
					<div className="space-y-3">
						{run.failed && (
							<div
								className="rounded-md border border-run-failed/40 bg-run-failed/8 p-3"
								data-testid="investigation-failed-state"
							>
								<div className="flex items-center gap-2">
									<StateChip tone="failed">
										{investigation.status === "cancelled"
											? "cancelled"
											: "failed"}
									</StateChip>
									<span className="text-record font-medium">
										{investigation.status === "cancelled"
											? "Investigation cancelled"
											: "Investigation failed"}
									</span>
								</div>
								<p className="mt-2 whitespace-pre-wrap font-mono text-meta">
									{investigation.error ?? "No error was recorded."}
								</p>
								<p className="mt-2 text-meta text-muted-foreground">
									The last events the harness sent are in the ledger below. The
									raw wire transcript is at{" "}
									<Mono>runs/{investigation.id}/transcript.jsonl</Mono> under
									the workspace directory that pl up printed at start.
								</p>
							</div>
						)}

						{run.streamFailed ? (
							<div
								className="rounded-md border p-3"
								data-testid="investigation-fallback-panel"
							>
								<div className="flex items-center justify-between">
									<div className="flex items-center gap-2 text-record font-medium">
										Investigation progress
										<StateChip tone="stale" data-testid="stream-fallback-badge">
											polling
										</StateChip>
									</div>
									<Mono className="text-meta text-muted-foreground">
										{run.jobProgress}%
									</Mono>
								</div>
								<Progress value={run.jobProgress} className="mt-2 h-1.5" />
								<div className="mt-2 flex items-center justify-between text-meta text-muted-foreground">
									<p data-testid="stream-fallback-message">
										Live stream unavailable — polling for progress
									</p>
									{run.jobState && <Mono>job {run.jobState}</Mono>}
								</div>
							</div>
						) : (
							<InvestigationStreamPanel
								key={investigation.id}
								events={run.events}
								latestText={run.latestText}
								status={run.ledgerStatus}
								collapsible={!run.isActive && !run.failed}
							/>
						)}
					</div>
				)}
			</div>
		</RecordSection>
	);
}
