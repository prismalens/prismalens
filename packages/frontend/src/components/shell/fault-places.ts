// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { defineClosed } from "@prismalens/registry";

/** Where a crash is caught: the whole app, a page, a thread, or one pane of it. */
export type FaultPlace = "app" | "page" | "thread" | "transcript" | "panel";

export interface FaultView {
	/** The plain sentence's head: what stopped, never the exception. */
	title: string;
	/** What still works and the one thing to do. */
	line: string;
	/** The retry button's words. */
	retry: string;
	/** Offer Go home beside the retry. */
	home: boolean;
	/** A pane draws a bar in its own space; a page centres the notice. */
	size: "page" | "pane";
}

const FAULT_PLACES: Record<FaultPlace, FaultView> = {
	app: {
		title: "PrismaLens hit a problem",
		line: "Your threads and drafts are kept, and running agents keep going. Reload to carry on.",
		retry: "Reload",
		home: true,
		size: "page",
	},
	page: {
		title: "This page stopped working",
		line: "Nothing you saved is lost. Reload the page, or go home.",
		retry: "Reload this page",
		home: true,
		size: "page",
	},
	thread: {
		title: "This thread stopped showing",
		line: "The thread is kept and its agent keeps running. Reload it, or go home.",
		retry: "Reload this thread",
		home: true,
		size: "page",
	},
	transcript: {
		title: "The transcript stopped showing",
		line: "The agent and the box below still work.",
		retry: "Reload the transcript",
		home: false,
		size: "pane",
	},
	panel: {
		title: "This panel stopped showing",
		line: "The rest of the thread still works.",
		retry: "Reload the panel",
		home: false,
		size: "pane",
	},
};

/** Every place a crash is caught and how it is worded (#1101 cat 23: no raw exception reaches a user). */
export const faultPlaces = defineClosed(
	"faultPlace",
	Object.keys(FAULT_PLACES) as FaultPlace[],
	FAULT_PLACES,
);

/** The route's place: a thread's own page reads "this thread", any other page "this page". */
export function faultPlaceOf(pathname: string): FaultPlace {
	return /^\/(threads|investigations)\/[^/]+/.test(pathname)
		? "thread"
		: "page";
}

/** The technical detail behind Details, as one block to copy into a report. */
export function faultDetail(error: unknown, at?: string): string {
	const e =
		error instanceof Error
			? error
			: new Error(
					typeof error === "string"
						? error
						: (JSON.stringify(error) ?? String(error)),
				);
	const stack = e.stack?.includes(e.message)
		? e.stack
		: `${e.name}: ${e.message}\n${e.stack ?? ""}`;
	return [at ? `At ${at}` : null, stack.trim()].filter(Boolean).join("\n");
}
