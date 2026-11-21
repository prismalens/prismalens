// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// Zod-free, and without the tools' long descriptions: the shell reads only what a tool
// shows as (its kind, labels and tally), so first paint stays small (#1130).
import { plToolName } from "./investigation-values.js";

export const TOOL_KINDS = [
	"lookup",
	"search",
	"file",
	"evidence",
	"hypothesis",
	"publish",
	"report",
	"thread",
	"ask",
	"watch",
	"schedule",
	"run",
	"browse",
] as const;
export type ToolKind = (typeof TOOL_KINDS)[number];

/** How a PrismaLens tool shows: its kind, its labels by state and its tally words. */
export interface ToolFace {
	kind: ToolKind;
	label: { step: string; ask?: string; running?: string; done?: string };
	tally?: readonly [one: string, many: string, verb: string];
}

/** Every PrismaLens tool's face by name; `tools.ts` adds each one's description and access. */
export const PL_TOOL_FACES = {
	pl_artifact_publish: {
		kind: "publish",
		label: {
			step: "Published a page",
			ask: "Publish a page",
			running: "Publishing",
			done: "Published",
		},
		tally: ["page", "pages", "published"],
	},
	pl_ask_user: {
		kind: "ask",
		label: {
			step: "Asked you a question",
			ask: "Ask you",
			running: "Asking you",
			done: "Asked you",
		},
		tally: ["question", "questions", "asked"],
	},
	pl_secret_request: {
		kind: "ask",
		label: {
			step: "Asked you for a secret",
			ask: "Ask for a secret",
			running: "Asking you for",
			done: "Asked you for",
		},
		tally: ["secret", "secrets", "asked for"],
	},
	pl_attachments_list: {
		kind: "file",
		label: { step: "Listed attached files" },
	},
	pl_attachment_read: {
		kind: "file",
		label: {
			step: "Read an attached file",
			ask: "Read an attachment",
			running: "Reading attachment",
			done: "Read attachment",
		},
	},
	pl_cron_create: {
		kind: "schedule",
		label: {
			step: "Scheduled a recurring prompt",
			ask: "Create a schedule",
			running: "Scheduling",
			done: "Scheduled",
		},
		tally: ["prompt", "prompts", "scheduled"],
	},
	pl_cron_list: {
		kind: "schedule",
		label: { step: "Listed scheduled prompts" },
	},
	pl_cron_delete: {
		kind: "schedule",
		label: { step: "Deleted a scheduled prompt" },
	},
	pl_incidents_similar: {
		kind: "lookup",
		label: { step: "Searched for similar incidents" },
	},
	pl_fixes_list: {
		kind: "lookup",
		label: { step: "Listed past fixes" },
	},
	pl_timeline_read: {
		kind: "lookup",
		label: { step: "Read the timeline" },
	},
	pl_changes_list: {
		kind: "lookup",
		label: { step: "Listed recent changes" },
	},
	pl_incident_get: {
		kind: "lookup",
		label: { step: "Read the incident" },
	},
	pl_investigations_search: {
		kind: "search",
		label: { step: "Searched past reports" },
	},
	pl_propose_action: {
		kind: "ask",
		label: { step: "Proposed a change" },
	},
	pl_evidence_record: {
		kind: "evidence",
		label: {
			step: "Recorded evidence",
			ask: "Record evidence",
			running: "Recording evidence",
			done: "Recorded evidence",
		},
		tally: ["evidence", "evidence", "recorded"],
	},
	pl_hypothesis_record: {
		kind: "hypothesis",
		label: {
			step: "Recorded a hypothesis",
			ask: "Record a likely cause",
			running: "Recording a hypothesis",
			done: "Recorded hypothesis",
		},
		tally: ["hypothesis", "hypotheses", "recorded"],
	},
	pl_report_validate: {
		kind: "report",
		label: { step: "Checked the report" },
	},
	pl_run_status: {
		kind: "lookup",
		label: { step: "Checked the run" },
	},
	pl_runbooks_list: {
		kind: "lookup",
		label: { step: "Listed runbooks" },
	},
	pl_runbooks_read: {
		kind: "lookup",
		label: {
			step: "Read a runbook",
			ask: "Read the runbooks",
			running: "Reading runbook",
			done: "Read runbook",
		},
	},
	pl_service_get: {
		kind: "lookup",
		label: {
			step: "Read a service",
			ask: "Read a service",
			running: "Reading service",
			done: "Read service",
		},
	},
	pl_thread_start: {
		kind: "thread",
		label: {
			step: "Started a thread",
			ask: "Start a thread",
			running: "Starting thread",
			done: "Started thread",
		},
		tally: ["thread", "threads", "started"],
	},
	pl_thread_send: {
		kind: "thread",
		label: {
			step: "Messaged a thread",
			ask: "Send a message to a thread",
			running: "Messaging",
			done: "Messaged",
		},
		tally: ["message", "messages", "sent"],
	},
	pl_thread_cancel: {
		kind: "thread",
		label: {
			step: "Stopped a thread",
			ask: "Stop a thread",
			running: "Stopping",
			done: "Stopped",
		},
	},
	pl_thread_rewind: {
		kind: "thread",
		label: {
			step: "Rewound a thread",
			ask: "Edit a thread's message and run it again",
			running: "Rewinding",
			done: "Rewound",
		},
	},
	pl_citation_read: {
		kind: "thread",
		label: {
			step: "Read a cited message",
			ask: "Read a cited message",
			running: "Reading cited message",
			done: "Read cited message",
		},
	},
	pl_thread_list: {
		kind: "thread",
		label: { step: "Listed threads" },
	},
	pl_thread_read: {
		kind: "thread",
		label: {
			step: "Read a thread",
			ask: "Read a thread",
			running: "Reading thread",
			done: "Read thread",
		},
	},
	pl_thread_title: {
		kind: "thread",
		label: {
			step: "Set the thread name",
			ask: "Name this thread",
			running: "Naming this thread",
			done: "Named this thread",
		},
	},
	pl_wakeup_schedule: {
		kind: "schedule",
		label: {
			step: "Scheduled a wake up",
			ask: "Schedule a wake-up",
			running: "Scheduling a wake",
			done: "Scheduled a wake",
		},
		tally: ["wake", "wakes", "scheduled"],
	},
	pl_pr_link: {
		kind: "watch",
		label: {
			step: "Linked a pull request",
			ask: "Link a change request",
			running: "Linking",
			done: "Linked",
		},
		tally: ["PR", "PRs", "linked"],
	},
	pl_pr_watch: {
		kind: "watch",
		label: {
			step: "Watched a pull request",
			ask: "Watch a change request",
			running: "Starting to watch",
			done: "Watching",
		},
		tally: ["PR", "PRs", "watched"],
	},
	pl_pr_unwatch: {
		kind: "watch",
		label: {
			step: "Stopped watching a pull request",
			ask: "Stop watching a change request",
			running: "Stopping the watch on",
			done: "Stopped watching",
		},
	},
	pl_browser_navigate: {
		kind: "browse",
		label: { step: "Went to a page", ask: "Open a page" },
	},
	pl_browser_snapshot: {
		kind: "browse",
		label: { step: "Read a page", ask: "Read the page" },
	},
	pl_browser_screenshot: {
		kind: "browse",
		label: { step: "Looked at a page" },
	},
	pl_browser_act: {
		kind: "browse",
		label: { step: "Acted on a page" },
	},
	pl_browser_tabs: {
		kind: "browse",
		label: { step: "Used browser tabs", ask: "Switch browser tabs" },
	},
	pl_browser_console: {
		kind: "browse",
		label: { step: "Read a page console" },
	},
	pl_browser_network: {
		kind: "browse",
		label: { step: "Read page requests" },
	},
	pl_browser_run_script: {
		kind: "browse",
		label: { step: "Ran a page script", ask: "Run a script on the page" },
	},
	pl_tools_search: {
		kind: "search",
		label: { step: "Searched PrismaLens tools" },
	},
	pl_tools_call: {
		kind: "run",
		label: { step: "Ran a PrismaLens tool" },
	},
} as const satisfies Record<string, ToolFace>;

export type PlToolName = keyof typeof PL_TOOL_FACES;

/** A PrismaLens tool's face by its current or legacy name; undefined for any other tool. */
export function plToolFace(name: string): ToolFace | undefined {
	const n = plToolName(name);
	return Object.hasOwn(PL_TOOL_FACES, n)
		? PL_TOOL_FACES[n as PlToolName]
		: undefined;
}

/** `browser_run_script` → "Browser run script": another server's tool, never its raw id. */
export function humanizeTool(id: string): string {
	const words = id
		.replace(/^pl_/, "")
		.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
		.replace(/[_\-.]+/g, " ")
		.trim()
		.toLowerCase();
	return words ? words.charAt(0).toUpperCase() + words.slice(1) : id;
}
