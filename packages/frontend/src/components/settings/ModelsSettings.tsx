// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { HarnessId } from "@prismalens/config/harness";
import {
	type ModelUse,
	smallestModel,
	THREAD_TITLE_LENGTH,
	type ThreadTitleSettings,
} from "@prismalens/contracts";
import { ModelChip, useAgentChoice } from "@/components/agent/AgentPicker";
import { settingOf } from "@/components/kit/registry";
import { AdvancedFold } from "@/components/shared/AdvancedFold";
import { Pool } from "@/components/shared/Row";
import { SettingGroup, SettingRow } from "@/components/shared/SettingRow";
import { Switch } from "@/components/ui/switch";
import { useHarnessSettings, useUpdateHarnessSettings } from "@/lib/api/hooks";
import type { SettingDef } from "@/registry/kinds/setting";
import {
	AutoRow,
	AxisSelect,
	EffortRow,
	NewThreadRow,
} from "./HarnessSettings";

const HOST_ONLY = "Only the computer running PrismaLens can change this.";

/** Each use's registered words, and what it follows when unset. */
const USES: Record<ModelUse, { setting: () => SettingDef; fallback: string }> =
	{
		alert: {
			setting: () => settingOf("models.alertRun"),
			fallback: "Same as New thread",
		},
		delegate: {
			setting: () => settingOf("models.delegate"),
			fallback: "Same as the thread that starts it",
		},
	};

/** Settings → Models (#1101 cat 18): the agent and model for each use, in one place. */
export function ModelsSettings() {
	return (
		<div data-testid="models-settings">
			<SettingGroup title="Default per use" testId="models-uses">
				<Pool>
					<NewThreadRow />
					<UseDefaultRow use="alert" />
					<OrganizerRow />
					<UseDefaultRow use="delegate" />
				</Pool>
			</SettingGroup>
			<ThreadTitleOptions />
			<SettingGroup title="Effort" testId="models-effort">
				<Pool>
					<EffortRow />
				</Pool>
				<AdvancedFold testId="models-advanced">
					<Pool>
						<AutoRow />
					</Pool>
				</AdvancedFold>
			</SettingGroup>
		</div>
	);
}

/** One use's own agent and model; unset follows its fallback, and Reset goes back to it. */
export function UseDefaultRow({ use }: { use: ModelUse }) {
	const { harnesses, effective } = useAgentChoice();
	const { data: settings } = useHarnessSettings();
	const update = useUpdateHarnessSettings();
	const set = settings?.useDefaults?.[use];
	const hostOnly = settings?.canEditRuntime === false;
	const words = USES[use];
	const s = words.setting();
	const harness = set ? harnesses.find((h) => h.id === set.harness) : effective;
	return (
		<SettingRow
			label={s.label}
			description={set ? s.sentence : `${s.sentence} ${words.fallback}`}
			testId={s.anchor}
			changed={!!set}
			onReset={() => update.mutate({ useDefaults: { [use]: null } })}
			locked={hostOnly ? HOST_ONLY : undefined}
		>
			<ModelChip
				harness={harness}
				model={set?.model ?? ""}
				side="bottom"
				disabled={hostOnly || update.isPending}
				onPick={(h, model) =>
					update.mutate({
						useDefaults: {
							[use]: {
								harness: h.id as HarnessId,
								...(model ? { model } : {}),
							},
						},
					})
				}
			/>
		</SettingRow>
	);
}

/** The thread you start is the organizer of the threads its agent starts; it has no model of its own. */
function OrganizerRow() {
	const s = settingOf("models.organizer");
	return (
		<SettingRow label={s.label} description={s.sentence} testId={s.anchor}>
			<span className="text-meta text-text-3">Same as New thread</span>
		</SettingRow>
	);
}

const LENGTH_OPTIONS = [30, 40, 50, 60, 80].map((n) => ({
	value: String(n),
	label: `${n} characters`,
}));
const STYLE_OPTIONS = [
	{ value: "sentence", label: "Names the problem" },
	{ value: "verb-first", label: "Starts with a verb" },
] as const;

/** Reads and writes the whole Thread titles block; a write replaces it. */
function useThreadTitles() {
	const { data: settings } = useHarnessSettings();
	const update = useUpdateHarnessSettings();
	const current: ThreadTitleSettings = settings?.threadTitles ?? {};
	return {
		current,
		update,
		hostOnly: settings?.canEditRuntime === false,
		save: (patch: Partial<ThreadTitleSettings>) =>
			update.mutate({ threadTitles: { ...current, ...patch } }),
	};
}

/** Thread titles (#1101): one section, the model a new thread is named with and how the title reads. */
export function ThreadTitleOptions() {
	const { effective, harnesses } = useAgentChoice();
	const { current, update, hostOnly, save } = useThreadTitles();
	const on = current.enabled !== false;
	const busy = hostOnly || update.isPending;
	const picked = Object.keys(current.models ?? {})[0];
	const harness =
		harnesses.find((h) => h.id === picked && h.id !== effective?.id) ??
		effective;
	const chosen = harness
		? current.models?.[harness.id as HarnessId]
		: undefined;
	const small = harness ? smallestModel(harness.models.entries) : null;
	return (
		<SettingGroup
			title={settingOf("models.threadTitles").label}
			testId={settingOf("models.threadTitles").anchor}
		>
			<Pool>
				<SettingRow
					label={<label htmlFor="models-titles-on">Name new threads</label>}
					testId="models-titles-on-row"
					locked={hostOnly ? HOST_ONLY : undefined}
				>
					<Switch
						id="models-titles-on"
						checked={on}
						disabled={busy}
						onCheckedChange={(enabled) => save({ enabled })}
						data-testid="models-titles-on"
					/>
				</SettingRow>
				<SettingRow
					label="Model"
					testId="models-use-titles"
					changed={!!current.models}
					onReset={() => save({ models: undefined })}
				>
					<ModelChip
						harness={harness}
						model={chosen ?? ""}
						emptyName={small ? "Smallest" : "None listed"}
						side="bottom"
						disabled={busy || !on}
						onPick={(h, model) =>
							save({
								models: {
									...current.models,
									...(model ? { [h.id as HarnessId]: model } : {}),
								},
							})
						}
					/>
				</SettingRow>
				<SettingRow
					label="Length"
					testId="models-titles-length"
					changed={current.maxLength !== undefined}
					onReset={() => save({ maxLength: undefined })}
				>
					<AxisSelect
						value={String(current.maxLength ?? THREAD_TITLE_LENGTH.default)}
						options={LENGTH_OPTIONS}
						onChange={(v) => save({ maxLength: Number(v) })}
						disabled={busy || !on}
						label="Title length"
						testId="models-titles-length"
					/>
				</SettingRow>
				<SettingRow
					label="Style"
					testId="models-titles-style"
					changed={current.style !== undefined}
					onReset={() => save({ style: undefined })}
				>
					<AxisSelect
						value={current.style ?? "sentence"}
						options={STYLE_OPTIONS}
						onChange={(style) => save({ style })}
						disabled={busy || !on}
						label="Title style"
						testId="models-titles-style"
					/>
				</SettingRow>
			</Pool>
		</SettingGroup>
	);
}
