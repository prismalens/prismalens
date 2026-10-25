// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

"use client";

/**
 * Settings → Agent (#337/#609 narrowing of #501/ADR-0031).
 *
 * The tier-2 harness that does the investigative legwork. `GET
 * /settings/harnesses` (ADR 0003 §9) is the only source of truth for what is
 * detected on this machine and the gate's own selection verdict, rendered
 * verbatim rather than re-derived here. The picker itself reads and writes
 * `GET`/`PATCH /settings/harness`: the persisted choice and model. That
 * persisted choice loses to `PRISMALENS_HARNESS` when the env var is set
 * (`selection.pinned`), so the picker stays editable but the page says so.
 */

import { ACCESS_LEVELS, type HarnessId } from "@prismalens/config/harness";
import {
	ACCESS_LEVEL_LABEL,
	type HarnessProbeResult,
	type HarnessStatus,
} from "@prismalens/contracts";
import { Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { useState } from "react";
import { AgentMark } from "@/components/agent/AgentMark";
import {
	AgentModelPicker,
	defaultAccessOf,
	EffortChip,
	useAgentChoice,
} from "@/components/agent/AgentPicker";
import { AddAgentDialog } from "./AddAgentDialog";
import { agentState, testedHint, versionText } from "./AgentDetail";

export { testedHint, versionText };

import { Pool, Row } from "@/components/shared/Row";
import { SettingGroup, SettingRow } from "@/components/shared/SettingRow";
import { Loading, Problem } from "@/components/shared/State";
import { Button } from "@/components/ui/button";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { agentNote, permissionLine } from "@/lib/access-levels";
import {
	useCheckHarness,
	useHarnesses,
	useHarnessSettings,
	useUpdateHarnessSettings,
} from "@/lib/api/hooks";
import { failureLine, notSignedIn } from "@/lib/failure-words";
import { StatePill } from "./source-words";

export function HarnessSettings() {
	const { data, isLoading, isError, refetch } = useHarnesses();
	const { data: settings, isLoading: settingsLoading } = useHarnessSettings();
	const setting = settings?.harness ?? "auto";

	const harnesses = data?.harnesses ?? [];
	const selection = data?.selection;
	// Agents that can run, plus the saved or pinned one so the user's own choice never vanishes (#907).
	const chosen = selection?.harness ?? (setting === "auto" ? null : setting);
	const listed = harnesses.filter((h) => h.runnable || h.id === chosen);
	const [adding, setAdding] = useState(false);
	const addAgent = (
		<Button
			variant="secondary"
			size="sm"
			onClick={() => setAdding(true)}
			data-testid="harness-add-agent"
		>
			Add agent
		</Button>
	);

	if (isLoading || settingsLoading) {
		return (
			<div data-testid="harness-settings">
				<Loading rows={5} />
			</div>
		);
	}

	return (
		<div data-testid="harness-settings">
			{isError && (
				<div className="mb-4" data-testid="harness-status-error">
					<Problem
						text="PrismaLens could not read the agent status on this machine."
						onRetry={() => refetch()}
					/>
				</div>
			)}
			{selection?.pinned && selection.pinnedBy === "env" && (
				<p
					className="mb-4 text-body text-warn"
					data-testid="harness-pinned-notice"
				>
					PRISMALENS_HARNESS decides which agent runs on this machine; unset it
					to let the choice here take effect.
				</p>
			)}

			<SettingGroup title="Next run">
				<Pool>
					<SettingRow
						label="Agent and model"
						description={
							selection?.runnable === false
								? (selection.blockedReason ?? "Would not start right now.")
								: "Used by the next run"
						}
						testId="harness-run-row"
					>
						<AgentModelPicker />
					</SettingRow>
					<EffortRow />
					<AccessRows />
					<AutoRow />
				</Pool>
			</SettingGroup>

			<SettingGroup
				title="Agents"
				count={listed.length || undefined}
				testId="harness-registry"
				actions={addAgent}
			>
				{adding && <AddAgentDialog open onOpenChange={setAdding} />}
				{listed.length === 0 ? (
					<div className="flex flex-wrap items-center gap-3">
						<p
							className="text-body text-text-2"
							data-testid="harness-none-available"
						>
							No agent can run. Add one to start investigations.
						</p>
						{addAgent}
					</div>
				) : (
					<Pool>
						{listed.map((harness) => (
							<AgentRow
								key={harness.id}
								harness={harness}
								inUse={selection?.harness === harness.id}
							/>
						))}
					</Pool>
				)}
			</SettingGroup>
		</div>
	);
}

/** The effort and context window a run on the next agent starts with, saved per agent (#673 w52). */
function EffortRow() {
	const { effective, model, efforts } = useAgentChoice();
	const update = useUpdateHarnessSettings();
	if (!effective) return null;
	const id = effective.id as HarnessId;
	return (
		<SettingRow
			label="Effort"
			description={`For ${effective.label}; with the context window where it offers one`}
			testId="harness-effort"
		>
			<EffortChip
				harness={effective}
				model={model}
				effort={efforts[id] ?? null}
				side="bottom"
				onEffort={(effort) => update.mutate({ efforts: { [id]: effort } })}
				onModel={(m) => update.mutate({ models: { [id]: m || null } })}
			/>
		</SettingRow>
	);
}

/** Every option by its own name; the shown value is always a real level, never the word Default (#907). */
function AxisSelect<V extends string>({
	value,
	options,
	onChange,
	label,
	testId,
}: {
	value: V;
	options: readonly { value: V; label: string }[];
	onChange: (value: V) => void;
	label: string;
	testId: string;
}) {
	return (
		<Select value={value} onValueChange={(v) => onChange(v as V)}>
			<SelectTrigger
				className="w-44 bg-surface-2"
				aria-label={label}
				data-testid={`${testId}-select`}
			>
				<SelectValue />
			</SelectTrigger>
			<SelectContent>
				{options.map((o) => (
					<SelectItem key={o.value} value={o.value}>
						{o.label}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}

const LEVEL_OPTIONS = ACCESS_LEVELS.map((l) => ({
	value: l,
	label: ACCESS_LEVEL_LABEL[l],
}));

/** The next run's permission level on this agent, saved per agent; until one is saved it shows the level a run takes (#673 w21). */
function AccessRows() {
	const { effective, axes } = useAgentChoice();
	const update = useUpdateHarnessSettings();
	if (!effective) return null;
	const id = effective.id as HarnessId;
	const note = agentNote(effective);
	return (
		<SettingRow
			label="Permission"
			description={
				<>
					{permissionLine(effective, axes.accessLevels[id])}
					<span
						className="mt-1 block text-text-3"
						data-testid="harness-alert-runs"
					>
						Runs an alert starts don't use this: nobody is there to answer, so
						they run at Auto and refuse anything they would ask you.
					</span>
					{note && (
						<span
							className="mt-1 block text-text-3"
							data-testid="harness-agent-note"
						>
							{note}
						</span>
					)}
				</>
			}
			testId="harness-access"
		>
			<AxisSelect
				value={
					axes.accessLevels[id] ?? defaultAccessOf(effective, axes).level.level
				}
				options={LEVEL_OPTIONS}
				label={`Permission for ${effective.label}`}
				testId="harness-access"
				onChange={(v) => update.mutate({ accessLevels: { [id]: v } })}
			/>
		</SettingRow>
	);
}

/** Auto: the next run takes the first agent that can run instead of the one named above. */
function AutoRow() {
	const { setting, effective } = useAgentChoice();
	const update = useUpdateHarnessSettings();
	const auto = setting === "auto";
	return (
		<SettingRow
			label={<label htmlFor="harness-auto">Auto</label>}
			description="Auto picks the first agent that can run"
			testId="harness-auto-row"
		>
			<Switch
				id="harness-auto"
				checked={auto}
				disabled={update.isPending || (auto && !effective)}
				onCheckedChange={(on) =>
					update.mutate({
						harness: on ? "auto" : ((effective?.id as HarnessId) ?? "auto"),
					})
				}
				data-testid="harness-auto"
			/>
		</SettingRow>
	);
}

/**
 * One agent on this machine, with its own check: a check on one row never
 * shows as pending on another (#673 w17). One state word and at most one
 * note, like a source (#848); the whole row opens the agent's page.
 */
function AgentRow({
	harness,
	inUse,
}: {
	harness: HarnessStatus;
	inUse: boolean;
}) {
	const harnessId = harness.id as HarnessId;
	const checkHarness = useCheckHarness();
	// This row's own verdict, kept in memory; it goes stale once the agent's login changes.
	const [ownOutcome, setOwnOutcome] = useState<
		HarnessProbeResult["outcome"] | null
	>(null);
	const checking = checkHarness.isPending;
	const outcome = ownOutcome ?? harness.checked?.outcome ?? null;

	async function handleCheck() {
		try {
			setOwnOutcome(
				(await checkHarness.mutateAsync({ id: harnessId })).outcome,
			);
		} catch {
			setOwnOutcome("failed-to-start");
		}
	}

	const note = harness.windowsOnlyPath
		? `Windows install at ${harness.windowsOnlyPath}; can't run in WSL`
		: outcome === "sign-in-needed"
			? failureLine(notSignedIn(harness.label))
			: inUse
				? "Used by the next run"
				: null;

	return (
		<Row
			key={harness.id}
			className="relative"
			testId={`harness-row-${harness.id}`}
			lead={<AgentMark id={harness.id} className="size-5" />}
			label={
				<span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
					<Link
						to="/settings"
						search={{ tab: "agent", agent: harnessId }}
						className="after:absolute after:inset-0"
						data-testid={`harness-open-${harness.id}`}
					>
						{harness.label}
					</Link>
					<StatePill
						word={
							checking
								? { text: "Checking", tone: "neutral" }
								: agentState(harness, outcome)
						}
						testId={`harness-check-result-${harness.id}`}
					/>
				</span>
			}
			meta={
				note && (
					<span
						className="whitespace-normal"
						data-testid={`harness-note-${harness.id}`}
					>
						{note}
					</span>
				)
			}
			trailing={
				<span className="flex items-center gap-1">
					{harness.installed && (
						<Button
							variant="secondary"
							size="sm"
							className="relative z-10"
							onClick={handleCheck}
							disabled={checking}
							data-testid={`harness-check-${harness.id}`}
						>
							{checking ? "Checking" : "Check"}
						</Button>
					)}
					<ChevronRight className="size-4 text-text-3" aria-hidden />
				</span>
			}
		/>
	);
}
