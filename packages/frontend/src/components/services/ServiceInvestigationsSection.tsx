// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	DEFAULT_TRIGGER_POLICY,
	type TriggerPolicy,
	TriggerPolicySchema,
} from "@prismalens/contracts";
import { MutationError } from "@/components/shared/MutationError";
import { RecordSection } from "@/components/shared/RecordSection";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { useUpdateService } from "@/lib/api/hooks";

const POLICY: Record<
	TriggerPolicy,
	{ label: string; line: string; short: string }
> = {
	always: {
		label: "Start one for every alert",
		line: "Every alert on this service starts a run",
		short: "Every alert",
	},
	critical_and_high: {
		label: "Start one for every critical and high alert",
		line: "Lower alerts wait for you",
		short: "Critical and high",
	},
	critical_only: {
		label: "Start one for every critical alert",
		line: "Every other alert waits for you",
		short: "Critical only",
	},
	never: {
		label: "Start none on their own",
		line: "Every alert waits for you to start a run",
		short: "None",
	},
};

/** Investigations (study-v3 §7): which alerts start a run on their own. */
export function ServiceInvestigationsSection({
	serviceId,
	metadata,
}: {
	serviceId: string;
	metadata: Record<string, unknown> | null;
}) {
	const update = useUpdateService();
	const investigation = (metadata?.investigation ?? {}) as {
		trigger?: unknown;
	};
	// Free-form metadata: an unknown value reads as the default, as the API does.
	const parsed = TriggerPolicySchema.safeParse(investigation.trigger);
	const trigger = parsed.success ? parsed.data : DEFAULT_TRIGGER_POLICY;
	return (
		<RecordSection id="investigations" title="Investigations">
			<div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
				<div className="min-w-0 flex-1">
					<p className="text-body">{POLICY[trigger].label}</p>
					<p className="text-meta text-text-3">{POLICY[trigger].line}</p>
				</div>
				<Select
					value={trigger}
					onValueChange={(v) =>
						update.mutate({
							id: serviceId,
							metadata: {
								...metadata,
								investigation: { ...investigation, trigger: v },
							},
						})
					}
				>
					<SelectTrigger
						className="sm:w-48"
						aria-label="Which alerts start a run"
					>
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{(Object.keys(POLICY) as TriggerPolicy[]).map((p) => (
							<SelectItem key={p} value={p}>
								{POLICY[p].short}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>
			<MutationError error={update.error} className="mt-2" />
		</RecordSection>
	);
}
