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
import { X } from "lucide-react";
import { type FormEvent, useState } from "react";
import { AgentMark } from "@/components/agent/AgentMark";
import {
	AgentModelPicker,
	defaultAccessOf,
	EffortChip,
	useAgentChoice,
} from "@/components/agent/AgentPicker";
import { DestructiveConfirm } from "@/components/shared/DestructiveConfirm";
import { Hint } from "@/components/shared/Hint";
import { InlineCode } from "@/components/shared/InlineCode";
import { Mono } from "@/components/shared/Mono";
import { Pool, Row } from "@/components/shared/Row";
import { SettingGroup, SettingRow } from "@/components/shared/SettingRow";
import { Loading, Problem } from "@/components/shared/State";
import { type StateTone, StateWord } from "@/components/shared/StateWord";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

/** One harness's last on-demand ACP handshake verdict, kept only in memory; it goes stale the moment the harness's login state changes. */
interface ProbeState {
	/** Only "answers ACP" is a pass; it still does not mean signed in. */
	outcome: HarnessProbeResult["outcome"];
	detail: string;
}

export function HarnessSettings() {
	const { data, isLoading, isError, refetch } = useHarnesses();
	const { isLoading: settingsLoading } = useHarnessSettings();

	const harnesses = data?.harnesses ?? [];
	const selection = data?.selection;

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

			<AutoStartedRuns />

			<CustomModels harnesses={harnesses} />

			<SettingGroup
				title="Agents on this machine"
				count={harnesses.filter((h) => h.installed).length || undefined}
				testId="harness-registry"
				description={
					harnesses.length > 0 && harnesses.every((h) => !h.installed) ? (
						<span data-testid="harness-none-available">
							None found on PATH. Runs start once one of these is installed.
						</span>
					) : undefined
				}
			>
				<Pool>
					{harnesses.map((harness) => (
						<AgentRow
							key={harness.id}
							harness={harness}
							inUse={selection?.harness === harness.id}
						/>
					))}
				</Pool>
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

/** The value a Select stores for "no value here": Default, or Same as next run. */
const UNSET = "unset";

function AxisSelect<V extends string>({
	value,
	options,
	unsetLabel,
	onChange,
	label,
	testId,
}: {
	value: V | undefined;
	options: readonly { value: V; label: string }[];
	unsetLabel: string;
	onChange: (value: V | null) => void;
	label: string;
	testId: string;
}) {
	return (
		<Select
			value={value ?? UNSET}
			onValueChange={(v) => onChange(v === UNSET ? null : (v as V))}
		>
			<SelectTrigger
				className="w-44 bg-surface-2"
				aria-label={label}
				data-testid={`${testId}-select`}
			>
				<SelectValue />
			</SelectTrigger>
			<SelectContent>
				<SelectItem value={UNSET}>{unsetLabel}</SelectItem>
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

/** The next run's permission level on this agent, saved per agent; unset follows the agent's own default (#673 w21). */
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
				value={axes.accessLevels[id]}
				options={LEVEL_OPTIONS}
				unsetLabel="Default"
				label={`Permission for ${effective.label}`}
				testId="harness-access"
				onChange={(v) => update.mutate({ accessLevels: { [id]: v } })}
			/>
		</SettingRow>
	);
}

/** Runs PrismaLens starts from an alert: their own level, else the next run's (#673 w21). */
function AutoStartedRuns() {
	const { effective, axes } = useAgentChoice();
	const update = useUpdateHarnessSettings();
	if (!effective) return null;
	const id = effective.id as HarnessId;
	const next = defaultAccessOf(effective, axes);
	const autoLevel = axes.autoAccessLevels[id];
	return (
		<SettingGroup
			title="Auto-started runs"
			description="Runs PrismaLens starts from an alert. Unset, it follows the next-run row above. At Ask always an unattended run waits for your approval of its first command; Auto or Auto-accept edits let it run on."
			testId="harness-auto-start"
		>
			<Pool>
				<SettingRow
					label="Permission"
					description={
						autoLevel
							? `${ACCESS_LEVEL_LABEL[autoLevel]}, set here.`
							: `Same as next run: ${ACCESS_LEVEL_LABEL[next.level.level]}.`
					}
					testId="harness-auto-access"
				>
					<AxisSelect
						value={autoLevel}
						options={LEVEL_OPTIONS}
						unsetLabel="Same as next run"
						label={`Permission for auto-started runs on ${effective.label}`}
						testId="harness-auto-access"
						onChange={(v) => update.mutate({ autoAccessLevels: { [id]: v } })}
					/>
				</SettingRow>
			</Pool>
		</SettingGroup>
	);
}

/**
 * Model ids the operator adds per agent, for a gateway or an endpoint whose
 * models the agent does not list itself; the picker shows them (#673 w57).
 */
function CustomModels({ harnesses }: { harnesses: HarnessStatus[] }) {
	const agents = harnesses.filter((h) => h.installed && h.modelVia === "acp");
	if (agents.length === 0) return null;
	return (
		<SettingGroup
			title="Custom models"
			description="Models your endpoint serves that the agent does not list itself. PrismaLens never checks them; a run on one that the endpoint does not serve fails."
			testId="harness-custom-models"
		>
			<Pool>
				{agents.map((h) => (
					<CustomModelRow key={h.id} harness={h} />
				))}
			</Pool>
		</SettingGroup>
	);
}

function CustomModelRow({ harness }: { harness: HarnessStatus }) {
	const id = harness.id as HarnessId;
	const { customModels } = useAgentChoice();
	const update = useUpdateHarnessSettings();
	const list = customModels[id] ?? [];
	const [draft, setDraft] = useState("");
	const [removing, setRemoving] = useState<string | null>(null);
	const add = (e: FormEvent) => {
		e.preventDefault();
		const model = draft.trim();
		if (!model || list.includes(model)) return setDraft("");
		update.mutate(
			{ customModels: { [id]: [...list, model] } },
			{ onSuccess: () => setDraft("") },
		);
	};
	return (
		<Row
			testId={`custom-models-${harness.id}`}
			lead={<AgentMark id={harness.id} className="size-5" />}
			label={harness.label}
			stackOnPhone
			meta={
				list.length === 0 ? (
					"None added"
				) : (
					<span className="flex min-w-0 flex-wrap gap-1.5">
						{list.map((model) => (
							<span
								key={model}
								className="inline-flex h-6 max-w-56 items-center gap-1 rounded-control bg-surface-3 pr-0.5 pl-2 text-meta text-text-1"
								data-testid="custom-model"
							>
								<Mono className="truncate">{model}</Mono>
								<button
									type="button"
									aria-label={`Remove ${model}`}
									onClick={() => setRemoving(model)}
									className="inline-flex size-5 items-center justify-center rounded-[4px] text-text-3 hover:bg-surface-4 hover:text-text-1"
									data-testid="custom-model-remove"
								>
									<X className="size-3" />
								</button>
							</span>
						))}
					</span>
				)
			}
			trailing={
				<form onSubmit={add} className="flex items-center gap-2">
					<Input
						value={draft}
						onChange={(e) => setDraft(e.target.value)}
						placeholder="Model id"
						aria-label={`Model id for ${harness.label}`}
						maxLength={200}
						className="h-7 w-44"
						data-testid="custom-model-input"
					/>
					<Button
						type="submit"
						variant="secondary"
						size="sm"
						disabled={!draft.trim() || update.isPending}
						data-testid="custom-model-add"
					>
						Add custom model
					</Button>
				</form>
			}
			below={
				<DestructiveConfirm
					open={removing !== null}
					onOpenChange={(open) => !open && setRemoving(null)}
					title="Remove this custom model?"
					description={`${removing ?? ""} leaves the ${harness.label} picker. A run already set to it keeps it until you pick another.`}
					confirmLabel="Remove"
					isPending={update.isPending}
					error={update.error}
					onConfirm={() =>
						update.mutateAsync({
							customModels: {
								[id]: list.filter((m) => m !== removing),
							},
						})
					}
				/>
			}
		/>
	);
}

/** Auto: the next run takes the first agent on PATH instead of the one named above. */
function AutoRow() {
	const { setting, effective } = useAgentChoice();
	const update = useUpdateHarnessSettings();
	const auto = setting === "auto";
	return (
		<SettingRow
			label={<label htmlFor="harness-auto">Auto</label>}
			description="Auto picks the first agent on PATH"
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
 * shows as pending on another (#673 w17). Shows the server's last check
 * (boot sweep or a run's readiness check) until this row runs its own.
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
	const [ownProbe, setOwnProbe] = useState<ProbeState | null>(null);
	const checking = checkHarness.isPending;
	const probe: ProbeState | null =
		ownProbe ??
		(harness.checked
			? { outcome: harness.checked.outcome, detail: harness.checked.detail }
			: null);

	async function handleCheck() {
		try {
			const result = await checkHarness.mutateAsync({ id: harnessId });
			setOwnProbe({ outcome: result.outcome, detail: result.detail });
		} catch {
			setOwnProbe({
				outcome: "failed-to-start",
				detail: "The check did not run. Try it again.",
			});
		}
	}

	return (
		<Row
			key={harness.id}
			testId={`harness-row-${harness.id}`}
			lead={<AgentMark id={harness.id} className="size-5" />}
			label={
				<span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
					{harness.label}
					{harness.installed && harness.tested ? (
						<Hint
							label={`Tested with ${harness.tested.version}`}
							meta={harness.tested.date}
						>
							<span
								className="font-mono text-meta font-normal text-text-3"
								data-testid={`harness-tested-${harness.id}`}
							>
								tested {harness.tested.version}
							</span>
						</Hint>
					) : (
						!harness.installed &&
						!harness.windowsOnlyPath && (
							<span className="text-meta font-normal text-text-3">
								not installed
							</span>
						)
					)}
					{inUse && (
						<span className="text-meta font-medium text-ok">in use</span>
					)}
				</span>
			}
			meta={
				harness.windowsOnlyPath ? (
					<span data-testid={`harness-windows-only-${harness.id}`}>
						Windows install at {harness.windowsOnlyPath}; can't run in WSL
					</span>
				) : probe && !checking ? (
					<StateWord
						tone={PROBE_TONE[probe.outcome]}
						className="whitespace-normal"
						data-testid={`harness-check-result-${harness.id}`}
					>
						{probe.detail}
					</StateWord>
				) : harness.installed ? (
					// app.css's `code` chip is unlayered, so it outranks a plain utility.
					<span className="[&_code]:bg-transparent! [&_code]:p-0!">
						{capabilities(harness)} <InlineCode text={harness.loginHint} />
					</span>
				) : (
					<Mono>{harness.install}</Mono>
				)
			}
			below={
				harness.id === "opencode" ? (
					// opencode.ai/docs/permissions: object rules merge, so the user's own patterns stay (#673 w21).
					<p
						className="text-meta text-text-3 [&_code]:bg-transparent! [&_code]:p-0!"
						data-testid="harness-opencode-asks"
					>
						A run sets each tool's <code>"*"</code> rule for its permission
						level; the other patterns in your opencode.json stay.
					</p>
				) : undefined
			}
			trailing={
				harness.installed && (
					<Button
						variant="secondary"
						size="sm"
						onClick={handleCheck}
						disabled={checking}
						data-testid={`harness-check-${harness.id}`}
					>
						{checking ? "Checking" : "Check"}
					</Button>
				)
			}
		/>
	);
}

/** A check's verdict as a word (look ruling §1.3, agent row). */
const PROBE_TONE: Record<HarnessProbeResult["outcome"], StateTone> = {
	"answers-acp": "ok",
	"sign-in-needed": "warn",
	"no-answer": "danger",
	"failed-to-start": "danger",
};

/** What the agent takes from PrismaLens, as the last check read it (r4 R4.1 rev, R4.2, R4.3). */
function capabilities(h: HarnessStatus): string {
	const model =
		h.modelVia === "acp"
			? "Takes a model over ACP."
			: h.id === "deepagents"
				? "Uses its own model."
				: "Model: pending a check.";
	const answered = h.checked?.outcome === "answers-acp" ? h.checked : null;
	const effort = answered?.effort
		? ` Effort over ACP: ${answered.effort.values.join(", ")}.`
		: "";
	const images = answered
		? ` Images: ${answered.images ? "yes" : "no"}.`
		: " Images: not checked yet.";
	return `${model}${effort}${images}`;
}
