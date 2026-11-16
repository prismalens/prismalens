// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { PlToolName } from "@prismalens/contracts/schemas";
import {
	defineHarnessTool,
	type HarnessTool,
	registered,
	type ToolOutcome,
} from "@prismalens/integrations/harness";
import { z } from "zod";
import { ANYWHERE } from "./serves.js";

/** The browser module's BrowserHostService, reached at call time like the watches. */
export const BROWSER_HOST = Symbol("BROWSER_HOST");

export type BrowserAction =
	| { kind: "click"; double?: boolean }
	| { kind: "type"; text: string; submit?: boolean }
	| { kind: "press"; key: string }
	| { kind: "select"; values: string[] }
	| { kind: "hover" }
	| { kind: "scroll"; direction: "up" | "down" };

/** `tab` absent: the thread's current tab, the one the agent last opened or switched to. */
export type BrowserToolCall =
	| { tool: "pl_browser_navigate"; tab?: string; to: string }
	| { tool: "pl_browser_snapshot"; tab?: string }
	| { tool: "pl_browser_screenshot"; tab?: string; ref?: string }
	| {
			tool: "pl_browser_act";
			tab?: string;
			ref?: string;
			action: BrowserAction;
	  }
	| {
			tool: "pl_browser_tabs";
			action: "list" | "open" | "switch" | "close";
			tab?: string;
			url?: string;
	  }
	| {
			tool: "pl_browser_console";
			tab?: string;
			level: "all" | "error" | "warning";
			limit: number;
	  }
	| {
			tool: "pl_browser_network";
			tab?: string;
			filter?: string;
			failed: boolean;
			limit: number;
	  }
	| {
			tool: "pl_browser_run_script";
			tab?: string;
			script: string;
			ref?: string;
	  };

export interface BrowserData {
	/** Settings → Agent → "Agents can use the browser". */
	enabled(): Promise<boolean>;
	call(
		runId: string,
		call: BrowserToolCall,
		signal: AbortSignal,
	): Promise<ToolOutcome>;
}

/** Served only to a run someone answers, and only while the host switch is on (#1061). */
export const BROWSER_TOOLS: ReadonlySet<string> = new Set<PlToolName>([
	"pl_browser_navigate",
	"pl_browser_snapshot",
	"pl_browser_screenshot",
	"pl_browser_act",
	"pl_browser_tabs",
	"pl_browser_console",
	"pl_browser_network",
	"pl_browser_run_script",
]);

const TAB = z
	.string()
	.trim()
	.regex(/^t\d{1,6}$/)
	.optional()
	.describe("A tab id from pl_browser_tabs; absent, your current tab.");
const REF = z
	.string()
	.trim()
	.regex(/^(f\d+)?e\d+$/);

/**
 * The browser beside the thread (#1061): the agent works it as a person does, and the user
 * watches and can take control. Page tools run as any PrismaLens tool does at the thread's
 * level; running a script is running code, so the level answers it as a shell command.
 */
export function browserTools(data: BrowserData): HarnessTool[] {
	const base = {
		group: "core",
		serves: { ...ANYWHERE, attended: true, dock: true },
		world: "open",
	} as const;
	const call = (c: BrowserToolCall) => (runId: string, signal: AbortSignal) =>
		data.call(runId, c, signal);
	return [
		defineHarnessTool({
			...base,
			...registered("pl_browser_navigate"),
			input: z.object({ tab: TAB, to: z.string().trim().min(1).max(4_000) }),
			run: (i, ctx) =>
				call({ tool: "pl_browser_navigate", tab: i.tab, to: i.to })(
					ctx.runId,
					ctx.signal,
				),
		}),
		defineHarnessTool({
			...base,
			...registered("pl_browser_snapshot"),
			input: z.object({ tab: TAB }),
			run: (i, ctx) =>
				call({ tool: "pl_browser_snapshot", tab: i.tab })(
					ctx.runId,
					ctx.signal,
				),
		}),
		defineHarnessTool({
			...base,
			...registered("pl_browser_screenshot"),
			input: z.object({ tab: TAB, ref: REF.optional() }),
			run: (i, ctx) =>
				call({ tool: "pl_browser_screenshot", tab: i.tab, ref: i.ref })(
					ctx.runId,
					ctx.signal,
				),
		}),
		defineHarnessTool({
			...base,
			...registered("pl_browser_act"),
			input: z.object({
				tab: TAB,
				ref: REF.optional(),
				action: z.enum([
					"click",
					"double_click",
					"type",
					"select",
					"press",
					"hover",
					"scroll",
				]),
				text: z.string().max(4_000).optional(),
				submit: z.boolean().optional(),
				key: z.string().trim().min(1).max(40).optional(),
				values: z.array(z.string().max(500)).max(20).optional(),
				direction: z.enum(["up", "down"]).optional(),
			}),
			run: (input, ctx) => {
				const action: BrowserAction =
					input.action === "click" || input.action === "double_click"
						? { kind: "click", double: input.action === "double_click" }
						: input.action === "type"
							? { kind: "type", text: input.text ?? "", submit: input.submit }
							: input.action === "press"
								? { kind: "press", key: input.key ?? "Enter" }
								: input.action === "select"
									? { kind: "select", values: input.values ?? [] }
									: input.action === "scroll"
										? { kind: "scroll", direction: input.direction ?? "down" }
										: { kind: "hover" };
				return data.call(
					ctx.runId,
					{ tool: "pl_browser_act", tab: input.tab, ref: input.ref, action },
					ctx.signal,
				);
			},
		}),
		defineHarnessTool({
			...base,
			...registered("pl_browser_tabs"),
			input: z.object({
				action: z.enum(["list", "open", "switch", "close"]).default("list"),
				tab: TAB,
				url: z.string().trim().min(1).max(4_000).optional(),
			}),
			run: (i, ctx) =>
				call({
					tool: "pl_browser_tabs",
					action: i.action,
					tab: i.tab,
					url: i.url,
				})(ctx.runId, ctx.signal),
		}),
		defineHarnessTool({
			...base,
			...registered("pl_browser_console"),
			input: z.object({
				tab: TAB,
				level: z.enum(["all", "error", "warning"]).default("all"),
				limit: z.number().int().min(1).max(200).default(50),
			}),
			run: (i, ctx) =>
				call({
					tool: "pl_browser_console",
					tab: i.tab,
					level: i.level,
					limit: i.limit,
				})(ctx.runId, ctx.signal),
		}),
		defineHarnessTool({
			...base,
			...registered("pl_browser_network"),
			input: z.object({
				tab: TAB,
				filter: z.string().trim().min(1).max(200).optional(),
				failed: z.boolean().default(false),
				limit: z.number().int().min(1).max(200).default(50),
			}),
			run: (i, ctx) =>
				call({
					tool: "pl_browser_network",
					tab: i.tab,
					filter: i.filter,
					failed: i.failed,
					limit: i.limit,
				})(ctx.runId, ctx.signal),
		}),
		defineHarnessTool({
			...base,
			runsCode: true,
			...registered("pl_browser_run_script"),
			input: z.object({
				tab: TAB,
				script: z.string().trim().min(1).max(10_000),
				ref: REF.optional(),
			}),
			run: (i, ctx) =>
				call({
					tool: "pl_browser_run_script",
					tab: i.tab,
					script: i.script,
					ref: i.ref,
				})(ctx.runId, ctx.signal),
		}),
	];
}
