// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	type AgentsStartThreads,
	THREAD_TREE_DEFAULTS,
	type ThreadTreeSettings,
} from "@prismalens/contracts";
import { settingOf } from "@/components/kit/registry";
import { Pool } from "@/components/shared/Row";
import { SettingGroup, SettingRow } from "@/components/shared/SettingRow";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useOperator } from "@/hooks/use-operator";
import {
	useTreeSettings,
	useUpdateTreeSettings,
} from "@/lib/api/hooks/use-app-settings-orpc";
import {
	useBrowserSettings,
	useUpdateBrowserSettings,
} from "@/lib/api/hooks/use-browser-orpc";
import type { SettingDef } from "@/registry/kinds/setting";

export const AGENTS_START_WORD: Record<AgentsStartThreads, string> = {
	ask: "Ask each time",
	allow: "Allowed within limits",
	never: "Never",
};

type Cap = "children" | "perTree" | "turnsPerDay" | "pairPerDay";

/** Each cap's bounds come from `ThreadTreeSettingsSchema`; the stored keys are kept from v0.5. */
const CAPS: {
	field: Cap;
	/** Its registered words and anchor (agent-threads.settings.ts). */
	setting: () => SettingDef;
	options: number[];
}[] = [
	{
		field: "children",
		setting: () => settingOf("organizer.perStarter"),
		options: range([1, 20]),
	},
	{
		field: "perTree",
		setting: () => settingOf("organizer.atOnce"),
		options: range([2, 50]),
	},
	{
		field: "turnsPerDay",
		setting: () => settingOf("organizer.perDay"),
		options: [10, 25, 50, 100, 200, 500, 1000],
	},
	{
		field: "pairPerDay",
		setting: () => settingOf("organizer.pairPerDay"),
		options: [5, 10, 20, 50, 100, 200],
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

/** Settings → Agent-started threads (#1101 cat 18): whether agents start threads, and every cap, in one group. */
export function OrganizerSettings() {
	return (
		<div data-testid="organizer-settings">
			<AgentThreadsGroup />
		</div>
	);
}

/** "Agents may start threads" and its caps, one group. */
export function AgentThreadsGroup() {
	const { settings, update, host, disabled } = useTree();
	return (
		<SettingGroup title="Agent-started threads" testId="agent-threads">
			<Pool>
				<SettingRow
					label={
						<span id="agent-threads-start-label">
							{settingOf("organizer.agentsMayStartThreads").label}
						</span>
					}
					description={settingOf("organizer.agentsMayStartThreads").sentence}
					testId={settingOf("organizer.agentsMayStartThreads").anchor}
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
				<AgentBrowserRow host={host} />
			</Pool>
			<ThreadCapRows />
		</SettingGroup>
	);
}

/** Agent → "Agents can use the browser" (#1061): on by default; asks follow each thread's level. */
function AgentBrowserRow({ host }: { host: boolean }) {
	const { data } = useBrowserSettings();
	const update = useUpdateBrowserSettings();
	return (
		<SettingRow
			label={<label htmlFor="agent-browser">Agents can use the browser</label>}
			description={host ? "Its own profile; take control any time" : HOST_ONLY}
			testId="agent-browser-row"
		>
			<Switch
				id="agent-browser"
				checked={data?.agentBrowser !== false}
				disabled={!data || update.isPending || !host}
				onCheckedChange={(on) => update.mutate(on)}
				data-testid="agent-browser"
			/>
		</SettingRow>
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
						<span id={`agent-threads-${cap.field}-label`}>
							{cap.setting().label}
						</span>
					}
					description={cap.setting().sentence}
					testId={cap.setting().anchor}
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
