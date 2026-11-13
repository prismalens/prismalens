// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	HARNESS_REGISTRY,
	type HarnessDescriptor,
} from "@prismalens/config/harness";
import { settingOf } from "@/components/kit/registry";
import { SettingRow } from "@/components/shared/SettingRow";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useHarnessSettings, useUpdateHarnessSettings } from "@/lib/api/hooks";

export type ColdResume = "ask" | "compact" | "send";

export const COLD_RESUME_WORD: Record<ColdResume, string> = {
	ask: "Ask",
	compact: "Compact, then send",
	send: "Send as is",
};

/** Idle compaction only does something once an agent states how long its cache lives (#1024). */
export function idleCompactionApplies(
	registry: Record<
		string,
		Pick<HarnessDescriptor, "cacheTtlMinutes" | "compactsWhenIdle">
	> = HARNESS_REGISTRY,
): boolean {
	return Object.values(registry).some(
		(h) => h.cacheTtlMinutes !== null && !h.compactsWhenIdle,
	);
}

function useRuntimeSettings() {
	const { data: settings } = useHarnessSettings();
	const update = useUpdateHarnessSettings();
	const hostOnly = settings?.canEditRuntime === false;
	return { settings, update, hostOnly, disabled: update.isPending || hostOnly };
}

const HOST_ONLY = "Only the computer running PrismaLens can change this.";

/** Agent → "When a conversation has gone cold": what sending does once the cache has expired. */
export function ColdResumeRow() {
	const { settings, update, hostOnly, disabled } = useRuntimeSettings();
	const s = settingOf("agent.whenAConversationHasGoneCold");
	return (
		<SettingRow
			label={<span id="harness-cold-resume-label">{s.label}</span>}
			description={hostOnly ? HOST_ONLY : s.sentence}
			testId={s.anchor}
		>
			<Select
				value={settings?.coldResume ?? "ask"}
				onValueChange={(v) => update.mutate({ coldResume: v as ColdResume })}
				disabled={disabled}
			>
				<SelectTrigger
					aria-labelledby="harness-cold-resume-label"
					data-testid="harness-cold-resume"
				>
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					{(Object.keys(COLD_RESUME_WORD) as ColdResume[]).map((k) => (
						<SelectItem key={k} value={k}>
							{COLD_RESUME_WORD[k]}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
		</SettingRow>
	);
}

/** Agent → "Resume after a usage limit"; absent is on. */
export function ResumeAfterLimitRow() {
	const { settings, update, hostOnly, disabled } = useRuntimeSettings();
	const s = settingOf("agent.resumeAfterAUsageLimit");
	return (
		<SettingRow
			label={<label htmlFor="harness-resume-after-limit">{s.label}</label>}
			description={hostOnly ? HOST_ONLY : s.sentence}
			testId={s.anchor}
		>
			<Switch
				id="harness-resume-after-limit"
				checked={settings?.resumeAfterLimit !== false}
				disabled={disabled}
				onCheckedChange={(resumeAfterLimit) =>
					update.mutate({ resumeAfterLimit })
				}
				data-testid="harness-resume-after-limit"
			/>
		</SettingRow>
	);
}

/** Agent → "Compact idle conversations": hidden while no agent states a cache lifetime. */
export function CompactIdleRow({
	applies = idleCompactionApplies(),
}: {
	applies?: boolean;
}) {
	const { settings, update, hostOnly, disabled } = useRuntimeSettings();
	if (!applies) return null;
	return (
		<SettingRow
			label={
				<label htmlFor="harness-compact-idle">Compact idle conversations</label>
			}
			description={hostOnly ? HOST_ONLY : "Before the agent's cache expires"}
			testId="harness-compact-idle-row"
		>
			<Switch
				id="harness-compact-idle"
				checked={settings?.compactIdle === true}
				disabled={disabled}
				onCheckedChange={(compactIdle) => update.mutate({ compactIdle })}
				data-testid="harness-compact-idle"
			/>
		</SettingRow>
	);
}
