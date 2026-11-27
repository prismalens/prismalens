// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * How Settings shows an agent's health check (#1180 §1.4, §2 R1): when the kept check ran,
 * a newer failed try, Check all, and the note on a Check that runs un-isolated.
 */
import { HARNESS_REGISTRY, type HarnessId } from "@prismalens/config/harness";
import { RUNTIME_HOST_ONLY } from "@prismalens/contracts";
import type { HarnessStatus } from "@prismalens/contracts/schemas";
import { runAction, settingOf } from "@/components/kit/registry";
import { Surface } from "@/components/kit/Surface";
import { Time } from "@/components/kit/Time";
import { SettingRow } from "@/components/shared/SettingRow";
import { Button } from "@/components/ui/button";
import { useNow } from "@/hooks/use-now";
import {
	useCheckAllHarnesses,
	useHarnessSettings,
	useUpdateHarnessSettings,
} from "@/lib/api/hooks";
import type { AgentCtx } from "./agent.actions";
import { AxisSelect } from "./HarnessSettings";

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

/** Check all's half of the list context: the run, and whether it is busy or has nothing safe to check. */
export function useCheckAll(agents: readonly HarnessStatus[]) {
	const checkAll = useCheckAllHarnesses();
	const installed = agents.filter((a) => a.installed && !a.off);
	const skipped = installed.filter((a) => !safeCheck(a.id as HarnessId));
	const part = {
		checkAll: () => checkAll.mutate(undefined),
		facts: {
			is: {
				checking: checkAll.isPending,
				nothingToCheck: installed.length === skipped.length,
			},
		},
	};
	return { checkAll, installed, skipped, part };
}

/** Checks every installed agent that is on, one at a time; ones with no safe check are listed, not started. */
export function CheckAllButton({
	agents,
}: {
	agents: readonly HarnessStatus[];
}) {
	const { checkAll, installed, skipped, part } = useCheckAll(agents);
	const none = () => {};
	const ctx: AgentCtx = {
		update: none,
		signOut: none,
		changeAccount: none,
		updateAll: none,
		...part,
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

const CHECK_EVERY = [
	{ value: "0", label: "Off" },
	{ value: "5", label: "5 min" },
	{ value: "15", label: "15 min" },
	{ value: "30", label: "30 min" },
	{ value: "60", label: "60 min" },
] as const;
type CheckEvery = (typeof CHECK_EVERY)[number]["value"];

/** Settings → Agents → Check every: the background refresh; absent is 15 minutes. */
export function CheckEveryRow() {
	const { data } = useHarnessSettings();
	const update = useUpdateHarnessSettings();
	const s = settingOf("agent.checkEvery");
	const minutes = data?.refreshMinutes ?? 15;
	return (
		<SettingRow
			label={s.label}
			description={s.sentence}
			testId={s.anchor}
			changed={minutes !== 15 && !update.isPending}
			onReset={() => update.mutate({ refreshMinutes: 15 })}
			locked={data?.canEditRuntime === false ? RUNTIME_HOST_ONLY : undefined}
		>
			<AxisSelect<CheckEvery>
				value={String(minutes) as CheckEvery}
				options={CHECK_EVERY}
				label={s.label}
				testId="harness-check-every"
				disabled={update.isPending || data?.canEditRuntime === false}
				onChange={(v) =>
					update.mutate({
						refreshMinutes: Number(v) as 0 | 5 | 15 | 30 | 60,
					})
				}
			/>
		</SettingRow>
	);
}
