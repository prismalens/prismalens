// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { shortcuts } from "@/lib/shortcuts";
import type { SettingsTab } from "./SettingsFrame";

/** One searchable setting: its page, the row's anchor, its name and one plain sentence. */
export interface IndexedSetting {
	tab: SettingsTab;
	/** The row's or group's test id, which is also its anchor; absent opens the page's top. */
	anchor?: string;
	name: string;
	sentence: string;
	/** Other words a person might type for it. */
	also?: string;
}

/**
 * Settings search's rows (#1101 cat 18). A row added to a page gets an entry
 * here, or search cannot find it; `settings-index.test.ts` checks each anchor's page.
 */
export const SETTINGS_INDEX: readonly IndexedSetting[] = [
	// Models
	{
		tab: "models",
		anchor: "harness-run-row",
		name: "New thread",
		sentence: "The agent and model a thread you start takes.",
		also: "model default agent next run",
	},
	{
		tab: "models",
		anchor: "models-use-alert",
		name: "Alert run",
		sentence: "The agent and model for runs an alert starts.",
		also: "model incident unattended",
	},
	{
		tab: "models",
		anchor: "models-use-titles",
		name: "Thread titles",
		sentence:
			"The small model that names each new thread, its length and style.",
		also: "title name rename untitled",
	},
	{
		tab: "models",
		anchor: "models-use-organizer",
		name: "Organizer",
		sentence: "The thread you start organizes the threads its agent starts.",
		also: "model",
	},
	{
		tab: "models",
		anchor: "models-use-delegate",
		name: "Delegate",
		sentence: "The agent and model for threads an agent starts.",
		also: "model child sub thread",
	},
	{
		tab: "models",
		anchor: "harness-effort",
		name: "Effort",
		sentence: "How hard the agent thinks, and its context window.",
		also: "reasoning thinking",
	},
	{
		tab: "models",
		anchor: "harness-auto-row",
		name: "Auto",
		sentence: "Picks the first agent that can run.",
	},
	// Permissions
	{
		tab: "permissions",
		anchor: "permissions-ladder",
		name: "Permission levels",
		sentence:
			"Ask always, Auto-accept edits, Auto and Full access, and what each agent enforced.",
		also: "permission sandbox access ladder approve",
	},
	{
		tab: "permissions",
		anchor: "permissions-agents",
		name: "Default permission per agent",
		sentence: "The level a thread you start takes on each agent.",
		also: "permission access full access",
	},
	{
		tab: "permissions",
		anchor: "harness-alert-asks-row",
		name: "When an alert run asks",
		sentence: "Refuse at once, or wait in the thread and notify you.",
		also: "permission ask policy approval",
	},
	{
		tab: "permissions",
		anchor: "harness-unattended-github-row",
		name: "Keep the GitHub token",
		sentence: "Whether alert and schedule runs can push and comment as you.",
		also: "permission git token",
	},
	// Agent-started threads
	{
		tab: "organizer",
		anchor: "agent-threads-start-row",
		name: "Agents may start threads",
		sentence: "Ask each time, allow within limits, or never.",
		also: "organizer delegate started",
	},
	{
		tab: "organizer",
		anchor: "agent-threads-children-row",
		name: "At once per starter",
		sentence: "How many threads one thread's agent may run at once.",
		also: "organizer limit started",
	},
	{
		tab: "organizer",
		anchor: "agent-threads-perTree-row",
		name: "At once in total",
		sentence: "How many agent-started threads may run at once.",
		also: "organizer limit",
	},
	{
		tab: "organizer",
		anchor: "agent-threads-turnsPerDay-row",
		name: "A day",
		sentence: "Thread starts and messages agents send in 24 hours.",
		also: "organizer limit daily cap turns",
	},
	{
		tab: "organizer",
		anchor: "agent-threads-pairPerDay-row",
		name: "Messages per pair",
		sentence:
			"Messages between two threads in 24 hours before they stay unread.",
		also: "organizer limit loop pair cap",
	},

	// Agents
	{
		tab: "agent",
		anchor: "harness-registry",
		name: "Agents",
		sentence: "The coding agents on this computer; add one or check it.",
		also: "claude code codex opencode gemini install sign in",
	},
	{
		tab: "agent",
		anchor: "harness-subagents",
		name: "Sub-agent depth and concurrency",
		sentence: "Limits on the sub-agents inside one agent's turn.",
		also: "subagent sub-agent",
	},
	{
		tab: "agent",
		anchor: "harness-subagents-stop-row",
		name: "When you stop a turn",
		sentence: "Whether a turn's running sub-agents stop with it or finish.",
		also: "subagent sub-agent cancel interrupt stop cascade",
	},
	{
		tab: "agent",
		anchor: "harness-resume-after-limit-row",
		name: "Resume after a usage limit",
		sentence: "The run carries on when the limit resets.",
		also: "limit quota",
	},
	{
		tab: "agent",
		anchor: "harness-resume-after-restart-row",
		name: "Resume after a restart",
		sentence: "Runs a restart cut off carry on when PrismaLens starts again.",
	},
	{
		tab: "agent",
		anchor: "harness-cold-resume-row",
		name: "When a conversation has gone cold",
		sentence: "What sending does once the agent's cache has expired.",
		also: "cache compact",
	},
	{
		tab: "agent",
		anchor: "harness-strict-env-row",
		name: "Only pass named variables",
		sentence: "Agents get named variables only, not your environment.",
		also: "environment env secrets",
	},
	// General and Appearance
	{
		tab: "general",
		anchor: "general-layout",
		name: "Sidebar",
		sentence: "How the sidebar shows.",
		also: "layout",
	},
	{
		tab: "general",
		anchor: "general-threads",
		name: "Settle quiet threads",
		sentence: "When a quiet thread settles by itself.",
	},
	{
		tab: "general",
		anchor: "general-files",
		name: "Open files in",
		sentence: "The editor a file link opens in.",
		also: "editor vscode",
	},
	{
		tab: "appearance",
		anchor: "appearance-scheme",
		name: "Color scheme",
		sentence: "Light, dark or the system's.",
		also: "theme dark mode",
	},
	{
		tab: "appearance",
		anchor: "appearance-typography",
		name: "Interface font",
		sentence: "The font the app's words use.",
		also: "typography",
	},
	// Other pages
	{
		tab: "notifications",
		name: "Notifications",
		sentence: "Where findings and asks reach you.",
		also: "slack push alerts",
	},
	{
		tab: "usage",
		name: "Usage",
		sentence: "Tokens, cost and each agent's limits.",
		also: "cost tokens limits quota spend",
	},
	{
		tab: "runs",
		name: "Run workspaces",
		sentence: "Where a run checks out the code, and what is kept.",
		also: "worktree checkout disk",
	},
	{
		tab: "alert-intake",
		anchor: "sources-webhook",
		name: "Alert webhook",
		sentence: "The URL and token an alert source posts to.",
		also: "alertmanager webhook",
	},
	{
		tab: "sources",
		name: "Sources",
		sentence: "What a run reads before it starts.",
		also: "integrations github prometheus",
	},
	{
		tab: "devices",
		anchor: "devices-list",
		name: "Devices",
		sentence: "Phones and computers paired with this instance.",
		also: "phone pair revoke",
	},
	{
		tab: "telemetry",
		anchor: "telemetry-row",
		name: "Usage data",
		sentence: "Counts of which features get used.",
		also: "telemetry analytics",
	},
	{
		tab: "about",
		anchor: "about-updates",
		name: "Updates",
		sentence: "Version, channel and upgrades.",
		also: "version upgrade release",
	},
	...shortcuts().map((s) => ({
		tab: "shortcuts" as const,
		anchor: `shortcut-${s.id}`,
		name: s.label,
		sentence: s.fixed
			? "Keyboard shortcut, fixed."
			: "Keyboard shortcut; remap it.",
		also: `shortcut key keyboard ${s.keys}`,
	})),
];

/**
 * Rows whose name, sentence or other words hold every word of the query. A row
 * on a page the query names comes first, then one whose name holds it.
 */
export function searchSettings(
	query: string,
	index: readonly IndexedSetting[] = SETTINGS_INDEX,
): IndexedSetting[] {
	const words = query.toLowerCase().split(/\s+/).filter(Boolean);
	if (!words.length) return [];
	const hay = (s: IndexedSetting) =>
		`${s.name} ${s.sentence} ${s.also ?? ""}`.toLowerCase();
	const first = words[0] as string;
	const score = (s: IndexedSetting) =>
		(PAGE_WORDS[s.tab].includes(first) ? 2 : 0) +
		(s.name.toLowerCase().includes(first) ? 1 : 0);
	return index
		.filter((s) => words.every((w) => hay(s).includes(w)))
		.map((s, i) => ({ s, i, score: score(s) }))
		.sort((a, b) => b.score - a.score || a.i - b.i)
		.map((r) => r.s);
}

/** Each page's own name, lowercased, so a query naming a page ranks its rows first. */
const PAGE_WORDS: Record<SettingsTab, string> = {
	general: "general",
	models: "models",
	permissions: "permissions",
	organizer: "organizer limits",
	agent: "agents",
	appearance: "appearance",
	notifications: "notifications",
	shortcuts: "keyboard shortcuts",
	usage: "usage",
	runs: "runs",
	"alert-intake": "alert intake",
	sources: "sources",
	devices: "devices",
	telemetry: "usage data",
	about: "about",
};
