// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { defineClosed } from "@prismalens/registry";

interface Profile {
	title: string;
	/** Which conditions it applies: none, the active ones with a tagged case, or every active one. */
	select: "none" | "cased" | "active";
}

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
		all: { title: "Every active condition", select: "active" },
	} satisfies Record<string, Profile>,
);

export type ProfileId = (typeof profiles.members)[number];
