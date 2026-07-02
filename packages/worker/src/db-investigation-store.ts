/**
 * DB-backed {@link InvestigationStore} adapter (ADR-0018) — folds the worker's
 * investigation lifecycle (status + timeline + result persistence) into the
 * conductor's create → append → finish|fail ordering. `append` is a no-op here:
 * canonical events reach the API/UI via the Redis sink, not the DB.
 */
import type { ContractRouterClient } from "@orpc/contract";
import type { Contract, InvestigationReport } from "@prismalens/contracts";
import type { InvestigationStore } from "@prismalens/engine";

export interface DbInvestigationStoreParams {
	investigationId: string;
	incidentId: string;
	runId: string;
}

export function createDbInvestigationStore(
	api: ContractRouterClient<Contract>,
	{ investigationId, incidentId, runId }: DbInvestigationStoreParams,
): InvestigationStore {
	return {
		async create() {
			await api.investigations.updateStatus({
				id: investigationId,
				status: "running",
				harnessThreadId: runId,
			});
			await api.timeline.create({
				incidentId,
				type: "investigation_started",
				title: "AI Investigation Started",
				description: "Starting the two-tier engine investigation",
				source: "ai_worker",
				metadata: { investigationId },
			});
		},

		async append() {
			// No-op: canonical events are relayed to the UI via the Redis sink, not
			// persisted to the DB.
		},

		async finish(report: InvestigationReport) {
			// writeResult ONLY on success — matches the pre-conductor worker, which wrote
			// no "completed" timeline entry on success (only the started + failed entries).
			await api.investigations.writeResult({
				id: investigationId,
				status: "completed",
				summary: report.summary,
				rootCause: report.rootCause ?? undefined,
				rootCauseCategory: report.rootCauseCategory ?? undefined,
				report,
				recommendations: report.nextSteps.map((step) => ({
					title: step.title,
					description: step.detail,
					priority: step.priority ?? undefined,
					category: "investigation",
					actionable: true,
				})),
			});
		},

		async fail(error: string) {
			await api.investigations.updateStatus({
				id: investigationId,
				status: "failed",
				error,
			});
			await api.timeline.create({
				incidentId,
				type: "investigation_completed",
				title: "AI Investigation Failed",
				description: error,
				source: "ai_worker",
				metadata: { investigationId, error },
			});
		},
	};
}
