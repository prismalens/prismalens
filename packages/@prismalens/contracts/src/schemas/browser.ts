// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The host browser (#1061): one persistent profile per host, tabs owned by a
 * thread, driven by the agent through `pl_browser_*` and watched in the pane.
 */
import { z } from "zod";
import { lazySchema } from "../lazy-schema.js";

export const BROWSER_TABS_PER_THREAD = 8;
export const BROWSER_TABS_PER_HOST = 32;

/** Who acts on a tab now; a takeover bumps `generation`, so the agent's stale refs fail. */
export const BrowserOwnerSchema = /* @__PURE__ */ lazySchema(() =>
	z.enum(["agent", "human"]),
);
export type BrowserOwner = z.infer<typeof BrowserOwnerSchema>;

export const BrowserTabSchema = /* @__PURE__ */ lazySchema(() =>
	z.object({
		id: z.string(),
		threadId: z.string(),
		url: z.string(),
		title: z.string(),
		loading: z.boolean(),
		owner: BrowserOwnerSchema,
		generation: z.number().int().nonnegative(),
		/** The agent's last action on this tab, e.g. `Clicked "Save"`; null before its first. */
		lastAction: z.string().nullable(),
		/** An agent action runs now. */
		busy: z.boolean(),
	}),
);
export type BrowserTab = z.infer<typeof BrowserTabSchema>;

/** `missing`: no Chromium, Chrome or Edge on the host; `off`: the host switch is off. */
export const BrowserEngineStateSchema = /* @__PURE__ */ lazySchema(() =>
	z.enum(["ready", "running", "missing", "off"]),
);
export type BrowserEngineState = z.infer<typeof BrowserEngineStateSchema>;

export const BrowserStatusSchema = /* @__PURE__ */ lazySchema(() =>
	z.object({
		engine: BrowserEngineStateSchema,
		/** The engine in use or found, e.g. "Microsoft Edge". */
		engineName: z.string().nullable(),
		/** Only the owner's device clicks, types or takes control; others watch. */
		canDrive: z.boolean(),
		tabs: z.array(BrowserTabSchema),
		/** The tab the agent works in; its tools act here unless they name another. */
		agentTab: z.string().nullable(),
	}),
);
export type BrowserStatus = z.infer<typeof BrowserStatusSchema>;

export const BrowserSettingsSchema = /* @__PURE__ */ lazySchema(() =>
	z.object({
		/** Settings → Agent → "Agents can use the browser"; on by default. */
		agentBrowser: z.boolean(),
	}),
);
export type BrowserSettings = z.infer<typeof BrowserSettingsSchema>;
export const BROWSER_SETTINGS_DEFAULTS: BrowserSettings = {
	agentBrowser: true,
};

const BoxSchema = /* @__PURE__ */ lazySchema(() =>
	z.object({
		x: z.number(),
		y: z.number(),
		width: z.number(),
		height: z.number(),
	}),
);

/** One message on a tab's stream: a JPEG frame, the tab's new state, or an element the agent acts on. */
export const BrowserStreamEventSchema = /* @__PURE__ */ lazySchema(() =>
	z.discriminatedUnion("kind", [
		z.object({
			kind: z.literal("frame"),
			/** Base64 JPEG, in CSS pixels of `width` x `height`. */
			data: z.string(),
			width: z.number(),
			height: z.number(),
		}),
		z.object({ kind: z.literal("tab"), tab: BrowserTabSchema }),
		z.object({ kind: z.literal("closed") }),
		z.object({ kind: z.literal("flash"), box: BoxSchema }),
	]),
);
export type BrowserStreamEvent = z.infer<typeof BrowserStreamEventSchema>;

/** The user's own input on the frame, in the frame's CSS pixels. Owner only. */
export const BrowserInputSchema = /* @__PURE__ */ lazySchema(() =>
	z.discriminatedUnion("kind", [
		z.object({
			kind: z.literal("click"),
			x: z.number().min(0).max(10_000),
			y: z.number().min(0).max(10_000),
			clicks: z.number().int().min(1).max(3).default(1),
		}),
		z.object({
			kind: z.literal("wheel"),
			x: z.number().min(0).max(10_000),
			y: z.number().min(0).max(10_000),
			dx: z.number().min(-10_000).max(10_000),
			dy: z.number().min(-10_000).max(10_000),
		}),
		z.object({ kind: z.literal("key"), key: z.string().min(1).max(40) }),
		z.object({ kind: z.literal("text"), text: z.string().min(1).max(2_000) }),
	]),
);
export type BrowserInput = z.infer<typeof BrowserInputSchema>;

export const BrowserThreadSchema = /* @__PURE__ */ lazySchema(() =>
	z.object({ id: z.string().min(1) }),
);
export const BrowserTabRefSchema = /* @__PURE__ */ lazySchema(() =>
	z.object({
		id: z.string().min(1),
		tab: z.string().min(1),
	}),
);

export const BrowserOpenInputSchema = /* @__PURE__ */ lazySchema(() =>
	BrowserThreadSchema.extend({
		url: z.string().trim().min(1).max(4_000),
	}),
);
export const BrowserNavigateInputSchema = /* @__PURE__ */ lazySchema(() =>
	BrowserTabRefSchema.extend({
		to: z.union([
			z.enum(["back", "forward", "reload"]),
			z.string().trim().min(1).max(4_000),
		]),
	}),
);
export const BrowserInputRequestSchema = /* @__PURE__ */ lazySchema(() =>
	BrowserTabRefSchema.extend({
		input: BrowserInputSchema,
	}),
);
export const BrowserControlInputSchema = /* @__PURE__ */ lazySchema(() =>
	BrowserTabRefSchema.extend({
		to: BrowserOwnerSchema,
	}),
);
