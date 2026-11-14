// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { defineClosed } from "@prismalens/registry";

/** Data `pnpm sim up` writes after the stages, for walks no condition owns. */
interface Seed {
	id: string;
	/** Run from the repo root against the server's workspace; may use {url}. */
	run: string;
	/** Where a person finds it. */
	live: string;
}

interface Profile {
	title: string;
	/** Which conditions it applies: none, the active ones with a tagged case, or every active one. */
	select: "none" | "cased" | "active";
	seeds?: readonly Seed[];
}

const LONG_THREAD: Seed = {
	id: "long-thread",
	run: "pnpm --filter @prismalens/api seed:long-thread",
	live: "the thread with 5,000 items (Ctrl+F, the rail, scrolling back), and a starter with 39 threads it started",
};

/**
 * The condition sets `pnpm sim` starts the app with. A single condition id is a
 * profile too; `pnpm registry profile <name>` resolves either.
 */
export const profiles = defineClosed(
	"profile",
	["bare", "ci", "all"] as const,
	{
		bare: { title: "The app with no condition applied", select: "none" },
		ci: { title: "The conditions that have a CI case", select: "cased" },
		all: {
			title: "Every active condition, and the 5,000-item thread",
			select: "active",
			seeds: [LONG_THREAD],
		},
	} satisfies Record<string, Profile>,
);

export type ProfileId = (typeof profiles.members)[number];
