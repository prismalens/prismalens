// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { defineClosed } from "@prismalens/registry";

/**
 * Where on a screen a fact can show. `match` is the CSS an element's nearest region answers
 * to, tried in this order; `facts` is what the region declares it shows. `pnpm sim
 * judge-evidence` reads both from the manifest (#1101, one fact one place).
 */
export type FactPlace =
	| "sidebar.row"
	| "home.card"
	| "thread.header"
	| "thread.box"
	| "thread.panel"
	| "incident.card"
	| "strip"
	| "composer"
	| "transcript"
	| "page";

export type FactId =
	| "title"
	| "status"
	| "agent"
	| "model"
	| "effort"
	| "access"
	| "host"
	| "folder"
	| "project"
	| "branch"
	| "changes"
	| "pr"
	| "cause"
	| "next"
	| "firing"
	| "severity"
	| "alert"
	| "context"
	| "cost"
	| "usage"
	| "startedBy"
	| "schedule"
	| "activity";

interface Place {
	title: string;
	match: string;
	facts: readonly FactId[];
}

export const factPlaces = defineClosed(
	"factPlace",
	[
		"sidebar.row",
		"home.card",
		"thread.header",
		"thread.box",
		"thread.panel",
		"incident.card",
		"strip",
		"composer",
		"transcript",
		"page",
	] as const,
	{
		"sidebar.row": {
			title: "A thread's row in the sidebar",
			match: '[data-testid="thread-row-wrap"]',
			facts: ["title", "status", "agent", "cause", "startedBy", "activity"],
		},
		"home.card": {
			title: "A card or row on Home and Needs you",
			match:
				'[data-testid="home-needs-band"], [data-testid="needs-you"], [data-testid="away-view"]',
			facts: ["title", "status", "agent", "cause", "activity", "project"],
		},
		"thread.header": {
			title: "The thread page's top bar",
			match: '[data-testid="thread-header"], [data-surface="incident.header"]',
			facts: ["title", "status", "severity", "firing", "pr", "project"],
		},
		"thread.box": {
			title: "The thread page's top-right box",
			match: '[data-testid="details-card"]',
			facts: [
				"agent",
				"model",
				"host",
				"folder",
				"branch",
				"changes",
				"pr",
				"cause",
				"next",
				"severity",
				"alert",
				"startedBy",
				"schedule",
				"context",
			],
		},
		"thread.panel": {
			title: "The thread page's right panel",
			match: '[data-testid="thread-side-panel"]',
			facts: ["pr", "branch", "changes", "agent", "model", "host", "folder"],
		},
		"incident.card": {
			title: "An alert thread's summary card above the transcript",
			match: '[data-testid="situation-card"], [data-testid="incident-card"]',
			facts: ["project", "cause", "next", "firing", "status", "alert"],
		},
		strip: {
			title: "A status strip over the box (limit, blocked, failed)",
			match: '[data-testid$="-strip"], [data-strip]',
			facts: ["status", "cause", "usage", "next"],
		},
		composer: {
			title: "The message box and its pickers",
			match: '[data-testid="composer"], [data-testid="docked-composer"]',
			facts: ["agent", "model", "effort", "access", "context"],
		},
		transcript: {
			title: "The transcript",
			match: '[data-testid="transcript"], [data-testid="windowed-transcript"]',
			facts: ["startedBy", "cause", "next", "status"],
		},
		page: {
			title: "Anywhere else on the page",
			match: "body",
			facts: [],
		},
	} satisfies Record<FactPlace, Place>,
);

interface Fact {
	label: string;
	/** The region it lives in best when two show it; a fix moves it there, never out of the transcript's own words. */
	home: FactPlace;
	/** Repeats kept on purpose: the pair of places, and why both show it. */
	repeats?: readonly { places: readonly [FactPlace, FactPlace]; why: string }[];
}

const ROW_MIRRORS_PAGE =
	"The active row reads like its siblings while you move between threads; the page names what is open.";

/** The facts a screen shows; each element that renders one carries `data-fact` through the kit. */
export const facts = defineClosed(
	"fact",
	[
		"title",
		"status",
		"agent",
		"model",
		"effort",
		"access",
		"host",
		"folder",
		"project",
		"branch",
		"changes",
		"pr",
		"cause",
		"next",
		"firing",
		"severity",
		"alert",
		"context",
		"cost",
		"usage",
		"startedBy",
		"schedule",
		"activity",
	] as const,
	{
		title: {
			label: "Thread title",
			home: "thread.header",
			repeats: [
				{ places: ["sidebar.row", "thread.header"], why: ROW_MIRRORS_PAGE },
			],
		},
		status: {
			label: "Status",
			home: "thread.header",
			repeats: [
				{ places: ["sidebar.row", "thread.header"], why: ROW_MIRRORS_PAGE },
				{
					places: ["sidebar.row", "strip"],
					why: "A strip is the status's action; the row keeps the list scannable.",
				},
			],
		},
		agent: {
			label: "Agent",
			home: "composer",
			repeats: [{ places: ["sidebar.row", "composer"], why: ROW_MIRRORS_PAGE }],
		},
		model: { label: "Model", home: "composer" },
		effort: { label: "Effort", home: "composer" },
		access: { label: "Permission mode", home: "composer" },
		host: { label: "Host", home: "thread.box" },
		folder: { label: "Folder or worktree", home: "thread.box" },
		project: { label: "Project or service", home: "thread.header" },
		branch: { label: "Branch", home: "thread.box" },
		changes: { label: "Changes", home: "thread.box" },
		pr: { label: "PR or MR", home: "thread.box" },
		cause: {
			label: "Cause",
			home: "incident.card",
			repeats: [
				{ places: ["sidebar.row", "incident.card"], why: ROW_MIRRORS_PAGE },
				{ places: ["sidebar.row", "strip"], why: ROW_MIRRORS_PAGE },
			],
		},
		next: { label: "Next step", home: "incident.card" },
		firing: { label: "Alert firing time", home: "thread.header" },
		severity: { label: "Severity", home: "thread.header" },
		alert: { label: "Alert", home: "incident.card" },
		context: { label: "Context window", home: "composer" },
		cost: { label: "Cost", home: "page" },
		usage: { label: "Usage limit", home: "strip" },
		startedBy: { label: "Started by", home: "sidebar.row" },
		schedule: { label: "Schedule", home: "thread.box" },
		activity: { label: "Last activity", home: "sidebar.row" },
	} satisfies Record<FactId, Fact>,
);
