// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { define } from "@/registry/define";

/** How many threads one thread's agent may run at once (#1101 cat 10). */
export const perStarter = define.setting({
	id: "organizer.perStarter",
	page: "organizer",
	anchor: "agent-threads-children-row",
	label: "At once per starter",
	sentence: "How many threads one thread's agent may run at once.",
	also: "organizer limit started",
	key: "threads.tree.children",
});

/** How many agent-started threads may run at once, checked in one lane across start chains. */
export const atOnce = define.setting({
	id: "organizer.atOnce",
	page: "organizer",
	anchor: "agent-threads-perTree-row",
	label: "At once in total",
	sentence: "How many agent-started threads may run at once.",
	also: "organizer limit",
	key: "threads.tree.perTree",
});

export const perDay = define.setting({
	id: "organizer.perDay",
	page: "organizer",
	anchor: "agent-threads-turnsPerDay-row",
	label: "A day",
	sentence: "Thread starts and messages agents send in 24 hours.",
	also: "organizer limit daily cap turns",
	key: "threads.tree.turnsPerDay",
});

/** Past it, messages between two threads are held unread and wake neither. */
export const pairPerDay = define.setting({
	id: "organizer.pairPerDay",
	page: "organizer",
	anchor: "agent-threads-pairPerDay-row",
	label: "Messages per pair",
	sentence: "Messages between two threads in 24 hours before they stay unread.",
	also: "organizer limit loop pair cap",
	key: "threads.tree.pairPerDay",
});

/** What each agent can honour comes from its registry fact `subagentsOnStop`, never from here. */
export const subagentsOnStop = define.setting({
	id: "agent.subagentsOnStop",
	page: "agent",
	anchor: "harness-subagents-stop-row",
	label: "When you stop a turn",
	sentence: "Whether a turn's running sub-agents stop with it or finish.",
	also: "subagent sub-agent cancel interrupt stop cascade",
	key: "HARNESS.subagentsOnStop",
});
