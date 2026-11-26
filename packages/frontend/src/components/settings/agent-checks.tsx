// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * How Settings shows an agent's health check (#1180 §1.4, §2 R1): when the kept check ran,
 * a newer failed try, Check all, and the note on a Check that runs un-isolated.
 */
import { HARNESS_REGISTRY, type HarnessId } from "@prismalens/config/harness";
import type { HarnessStatus } from "@prismalens/contracts/schemas";
import { runAction } from "@/components/kit/registry";
import { Surface } from "@/components/kit/Surface";
import { Time } from "@/components/kit/Time";
import { Button } from "@/components/ui/button";
import { useNow } from "@/hooks/use-now";
import { useCheckAllHarnesses } from "@/lib/api/hooks";
import type { AgentCtx } from "./agent.actions";

/** Its check runs isolated, so Check all and a background pass start it. */
export function safeCheck(id: HarnessId): boolean {
	return !!HARNESS_REGISTRY[id]?.probeIsolation;
}

export const UNSAFE_CHECK_HINT =
	"Opens a session. Its own hooks and MCP servers may run.";
export const NOT_CHECKED_NO_SAFE_CHECK = "Not checked: no safe check";

/** `Checked 3m ago` for the kept check, and `Last try failed 1m ago` when a newer try failed. */
export function CheckTimes({ agent }: { agent: HarnessStatus }) {
	const now = useNow();
	const checked = agent.checked;
	if (!checked) return null;
	const tried = checked.lastTry;
	return (
		<span className="inline-flex flex-wrap gap-x-2 text-meta text-text-3">
			<Time
				at={checked.at}
				now={now}
				prefix="Checked"
				past
				ago
				testId={`agent-checked-${agent.id}`}
			/>
			{tried && new Date(tried.at) > new Date(checked.at) && (
				<Time
					at={tried.at}
					now={now}
					prefix="Last try failed"
					past
					ago
					testId={`agent-tried-${agent.id}`}
				/>
			)}
		</span>
	);
}

/** Checks every installed agent that is on, one at a time; ones with no safe check are listed, not started. */
export function CheckAllButton({
	agents,
}: {
	agents: readonly HarnessStatus[];
}) {
	const checkAll = useCheckAllHarnesses();
	const installed = agents.filter((a) => a.installed && !a.off);
	const skipped = installed.filter((a) => !safeCheck(a.id as HarnessId));
	const ctx: AgentCtx = {
		checkAll: () => checkAll.mutate(undefined),
		facts: {
			is: {
				checking: checkAll.isPending,
				nothingToCheck: installed.length === skipped.length,
			},
		},
	};
	return (
		<span className="inline-flex flex-wrap items-center gap-2">
			<Surface id="agent.list" ctx={ctx}>
				<Button
					variant="secondary"
					size="sm"
					disabled={checkAll.isPending || installed.length === skipped.length}
					onClick={() => runAction("agent.checkAll", ctx)}
					data-testid="agent-check-all"
				>
					{checkAll.isPending ? "Checking" : "Check all"}
				</Button>
			</Surface>
			{checkAll.isSuccess && skipped.length > 0 && (
				<span
					className="text-meta text-text-3"
					data-testid="agent-check-all-skipped"
				>
					{NOT_CHECKED_NO_SAFE_CHECK}: {skipped.map((a) => a.label).join(", ")}
				</span>
			)}
		</span>
	);
}
