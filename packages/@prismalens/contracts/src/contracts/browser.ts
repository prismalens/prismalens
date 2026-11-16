// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/** The host browser beside a thread (#1061): its tabs, their live frames, and the user's input. */
import { eventIterator, oc } from "@orpc/contract";
import { z } from "zod";
import {
	BrowserControlInputSchema,
	BrowserInputRequestSchema,
	BrowserNavigateInputSchema,
	BrowserOpenInputSchema,
	BrowserSettingsSchema,
	BrowserStatusSchema,
	BrowserStreamEventSchema,
	BrowserTabRefSchema,
	BrowserTabSchema,
	BrowserThreadSchema,
} from "../schemas/browser.js";

const route = (
	method: "GET" | "POST" | "PUT" | "DELETE",
	path: `/${string}`,
	summary: string,
) => oc.route({ method, path, summary, tags: ["browser"] });

export const browserContract = {
	/** GET /threads/:id/browser — the engine's state and this thread's tabs. */
	status: route("GET", "/threads/{id}/browser", "Read a thread's browser tabs")
		.input(BrowserThreadSchema)
		.output(BrowserStatusSchema),

	/** GET /threads/:id/browser/:tab/stream — frames and state, while someone watches. */
	stream: route(
		"GET",
		"/threads/{id}/browser/{tab}/stream",
		"Watch a browser tab",
	)
		.input(BrowserTabRefSchema)
		.output(eventIterator(BrowserStreamEventSchema)),

	/** POST /threads/:id/browser — the user opens a tab. Owner only. */
	open: route("POST", "/threads/{id}/browser", "Open a browser tab")
		.input(BrowserOpenInputSchema)
		.output(BrowserTabSchema),

	/** POST /threads/:id/browser/:tab/navigate. Owner only. */
	navigate: route(
		"POST",
		"/threads/{id}/browser/{tab}/navigate",
		"Navigate a browser tab",
	)
		.input(BrowserNavigateInputSchema)
		.output(BrowserTabSchema),

	/** POST /threads/:id/browser/:tab/input — a click, wheel, key or text. Owner only. */
	input: route(
		"POST",
		"/threads/{id}/browser/{tab}/input",
		"Send input to a browser tab",
	)
		.input(BrowserInputRequestSchema)
		.output(z.object({ ok: z.boolean() })),

	/** POST /threads/:id/browser/:tab/control — take control, or hand it back. Owner only. */
	control: route(
		"POST",
		"/threads/{id}/browser/{tab}/control",
		"Take or hand back a browser tab",
	)
		.input(BrowserControlInputSchema)
		.output(BrowserTabSchema),

	/** DELETE /threads/:id/browser/:tab. Owner only. */
	close: route("DELETE", "/threads/{id}/browser/{tab}", "Close a browser tab")
		.input(BrowserTabRefSchema)
		.output(z.object({ closed: z.boolean() })),

	/** POST /browser/clear — sign out of everything: the profile is deleted. Owner only. */
	clear: route("POST", "/browser/clear", "Clear the browser's data")
		.input(z.object({}))
		.output(z.object({ cleared: z.boolean() })),

	/** GET /browser/settings */
	getSettings: route("GET", "/browser/settings", "Read the browser settings")
		.input(z.object({}))
		.output(BrowserSettingsSchema),

	/** PUT /browser/settings. Owner only. */
	setSettings: route("PUT", "/browser/settings", "Change the browser settings")
		.input(BrowserSettingsSchema)
		.output(BrowserSettingsSchema),
};
