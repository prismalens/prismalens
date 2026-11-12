// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	type AgentsStartThreads,
	THREAD_TREE_DEFAULTS,
	type ThreadTreeSettings,
} from "@prismalens/contracts";
import { AdvancedFold } from "@/components/shared/AdvancedFold";
import { Pool } from "@/components/shared/Row";
import { SettingGroup, SettingRow } from "@/components/shared/SettingRow";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { useOperator } from "@/hooks/use-operator";
import {
	useTreeSettings,
	useUpdateTreeSettings,
} from "@/lib/api/hooks/use-app-settings-orpc";
import { SubagentLimitRow } from "./HarnessSettings";

export const AGENTS_START_WORD: Record<AgentsStartThreads, string> = {
	ask: "Ask each time",
	allow: "Allowed within limits",
	never: "Never",
};

type Cap = "depth" | "children" | "perTree" | "turnsPerDay";

/** Each cap's bounds come from `ThreadTreeSettingsSchema`. */
const CAPS: {
	field: Cap;
	label: string;
	description: string;
	options: number[];
}[] = [
	{
		field: "depth",
		label: "Thread depth",
		description: "Levels below the thread you start",
		options: range([1, 5]),
	},
	{
		field: "children",
		label: "Threads per thread",
		description: "Running at once under one thread",
		options: range([1, 20]),
	},
	{
		field: "perTree",
		label: "Threads per tree",
		description: "Running at once, the first one included",
		options: range([2, 50]),
	},
	{
		field: "turnsPerDay",
		label: "Turns a day",
		description:
			"Thread starts and messages agents send each other in 24 hours, across every tree",
		options: [10, 25, 50, 100, 200, 500, 1000],
	},
];

const HOST_ONLY = "Only the computer running PrismaLens can change this.";

function useTree() {
	const { data } = useTreeSettings();
	const update = useUpdateTreeSettings();
	const { managesPairing: host } = useOperator();
	const settings: ThreadTreeSettings = { ...THREAD_TREE_DEFAULTS, ...data };
	return {
		settings,
		update,
		host,
		disabled: !data || update.isPending || !host,
	};
}

/** Settings → Organizer limits (#1101 cat 18): whether agents start threads, and every cap, in one group. */
export function OrganizerSettings() {
	return (
		<div data-testid="organizer-settings">
			<AgentThreadsGroup />
			<AdvancedFold
				testId="organizer-advanced"
				description="Sub-agents run inside one agent's session. Claude Code, Codex and OpenCode use these; OpenCode takes depth only."
			>
				<Pool>
					<SubagentLimitRow
						field="subagentDepth"
						label="Sub-agent depth"
						description="How deep sub-agents may nest"
					/>
					<SubagentLimitRow
						field="subagentConcurrency"
						label="Concurrent sub-agents"
						description="How many run at once"
					/>
				</Pool>
			</AdvancedFold>
		</div>
	);
}

/** "Agents may start threads" and its caps, one group. */
export function AgentThreadsGroup() {
	const { settings, update, host, disabled } = useTree();
	return (
		<SettingGroup title="Threads agents start" testId="agent-threads">
			<Pool>
				<SettingRow
					label={
						<span id="agent-threads-start-label">Agents may start threads</span>
					}
					description="Each new thread runs on its own and costs its own turns"
					testId="agent-threads-start-row"
					changed={
						settings.agentsStartThreads !==
						THREAD_TREE_DEFAULTS.agentsStartThreads
					}
					onReset={() =>
						update.mutate({
							agentsStartThreads: THREAD_TREE_DEFAULTS.agentsStartThreads,
						})
					}
					locked={host ? undefined : HOST_ONLY}
				>
					<Select
						value={settings.agentsStartThreads}
						onValueChange={(v) =>
							update.mutate({ agentsStartThreads: v as AgentsStartThreads })
						}
						disabled={disabled}
					>
						<SelectTrigger
							aria-labelledby="agent-threads-start-label"
							data-testid="agent-threads-start"
						>
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{(Object.keys(AGENTS_START_WORD) as AgentsStartThreads[]).map(
								(k) => (
									<SelectItem key={k} value={k}>
										{AGENTS_START_WORD[k]}
									</SelectItem>
								),
							)}
						</SelectContent>
					</Select>
				</SettingRow>
			</Pool>
			<ThreadCapRows />
		</SettingGroup>
	);
}

/** The caps on threads agents start. */
export function ThreadCapRows() {
	const { settings, update, host, disabled } = useTree();
	return (
		<Pool className="mt-2">
			{CAPS.map((cap) => (
				<SettingRow
					key={cap.field}
					label={
						<span id={`agent-threads-${cap.field}-label`}>{cap.label}</span>
					}
					description={cap.description}
					testId={`agent-threads-${cap.field}-row`}
					changed={settings[cap.field] !== THREAD_TREE_DEFAULTS[cap.field]}
					onReset={() =>
						update.mutate({ [cap.field]: THREAD_TREE_DEFAULTS[cap.field] })
					}
					locked={host ? undefined : HOST_ONLY}
				>
					<Select
						value={String(settings[cap.field])}
						onValueChange={(v) => update.mutate({ [cap.field]: Number(v) })}
						disabled={disabled}
					>
						<SelectTrigger
							aria-labelledby={`agent-threads-${cap.field}-label`}
							className="w-24"
							data-testid={`agent-threads-${cap.field}`}
						>
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{withValue(cap.options, settings[cap.field]).map((n) => (
								<SelectItem key={n} value={String(n)}>
									{n}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</SettingRow>
			))}
		</Pool>
	);
}

function range([lo, hi]: [number, number]): number[] {
	return Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
}

/** A stored value the option list skips still shows as itself. */
const withValue = (options: number[], value: number) =>
	options.includes(value) ? options : [...options, value].sort((a, b) => a - b);
