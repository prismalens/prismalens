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
import { AdvancedFold } from "@/components/shared/AdvancedFold";
import { Pool } from "@/components/shared/Row";
import { SettingGroup, SettingRow } from "@/components/shared/SettingRow";
import { Switch } from "@/components/ui/switch";
import { useHarnessSettings, useUpdateHarnessSettings } from "@/lib/api/hooks";
import {
	AutoRow,
	AxisSelect,
	EffortRow,
	NewThreadRow,
} from "./HarnessSettings";

const HOST_ONLY = "Only the computer running PrismaLens can change this.";

const USES: Record<
	ModelUse,
	{ label: string; description: string; fallback: string }
> = {
	alert: {
		label: "Alert run",
		description: "Runs an alert starts, with nobody watching",
		fallback: "Same as New thread",
	},
	delegate: {
		label: "Delegate",
		description: "Threads an agent starts; an agent may still name its own",
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
					<ThreadTitlesRow />
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
	const harness = set ? harnesses.find((h) => h.id === set.harness) : effective;
	return (
		<SettingRow
			label={words.label}
			description={
				set ? words.description : `${words.description}. ${words.fallback}`
			}
			testId={`models-use-${use}`}
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
	return (
		<SettingRow
			label="Organizer"
			description="The thread you start organizes the threads its agent starts, so it runs on New thread"
			testId="models-use-organizer"
		>
			<span className="text-meta text-text-3">Same as New thread</span>
		</SettingRow>
	);
}

const LENGTH_OPTIONS = [30, 40, 50, 60, 80].map((n) => ({
	value: String(n),
	label: `${n} characters`,
}));
const STYLE_OPTIONS = [
	{ value: "sentence", label: "Sentence case" },
	{ value: "verb-first", label: "Verb first" },
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

/** Thread titles (#1101): the small model that names a new thread, on the thread's own agent. */
export function ThreadTitlesRow() {
	const { effective, harnesses } = useAgentChoice();
	const { current, update, hostOnly, save } = useThreadTitles();
	const off = current.enabled === false;
	const picked = Object.keys(current.models ?? {})[0];
	const harness =
		harnesses.find((h) => h.id === picked && h.id !== effective?.id) ??
		effective;
	const chosen = harness
		? current.models?.[harness.id as HarnessId]
		: undefined;
	const small = harness ? smallestModel(harness.models.entries) : null;
	const description = off
		? "Off: a thread keeps the first line of its message"
		: chosen
			? "A small model names each new thread on its own agent"
			: small
				? "A small model names each new thread on its own agent. Its smallest model by default"
				: "This agent lists no small model, so a thread keeps the first line of its message";
	return (
		<SettingRow
			label="Thread titles"
			description={description}
			testId="models-use-titles"
			changed={!!current.models}
			onReset={() => save({ models: undefined })}
			locked={hostOnly ? HOST_ONLY : undefined}
		>
			<ModelChip
				harness={harness}
				model={chosen ?? small ?? ""}
				side="bottom"
				disabled={hostOnly || off || update.isPending}
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
	);
}

/** On or off, length and style of the generated title. */
export function ThreadTitleOptions() {
	const { current, update, hostOnly, save } = useThreadTitles();
	const on = current.enabled !== false;
	const busy = hostOnly || update.isPending;
	return (
		<SettingGroup title="Thread titles" testId="models-titles">
			<Pool>
				<SettingRow
					label={<label htmlFor="models-titles-on">Name new threads</label>}
					description="A rename of yours always stays. Name it again from the thread menu"
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
					label="Length"
					description="The most characters a title may have"
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
					description="Verb first reads like a task: “Find why checkout p99 rose”"
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
