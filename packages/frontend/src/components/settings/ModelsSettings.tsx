// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { HarnessId } from "@prismalens/config/harness";
import type { ModelUse } from "@prismalens/contracts";
import { ModelChip, useAgentChoice } from "@/components/agent/AgentPicker";
import { AdvancedFold } from "@/components/shared/AdvancedFold";
import { Pool } from "@/components/shared/Row";
import { SettingGroup, SettingRow } from "@/components/shared/SettingRow";
import { useHarnessSettings, useUpdateHarnessSettings } from "@/lib/api/hooks";
import { AutoRow, EffortRow, NewThreadRow } from "./HarnessSettings";

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
				</Pool>
			</SettingGroup>
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
