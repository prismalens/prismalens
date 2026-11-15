// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { expect } from "@playwright/test";
import { defineChecks, verdict } from "../bar";

/** The sim's failing threads: every stop and error condition that owns one. */
const FAILURES = [
	"limit.mid-turn",
	"limit.out-of-credit",
	"limit.overloaded",
	"limit.rate-limited",
	"login.expired",
	"budget.cap",
	"git.worktree-disk",
	"net.provider-drop",
	"protocol.drift",
	"agent.runaway",
	"host.restart",
];

/** What a raw code looks like on screen: errno names, HTTP status lines, snake_case modes, JSON. */
const RAW =
	/\b(E[A-Z]{4,}|HTTP\/?\s?\d\.?\d? ?[45]\d\d|status(?: code)? [45]\d\d|[a-z]+_[a-z_]+_?(?:error|limit|credit|rejected|exceeded)\w*|ERR_[A-Z_]+|[A-Z][a-zA-Z]+Error\b|Exception\b)|\{"\w+":/;

/** #1101 category 23, Error notices. */
export default defineChecks([
	{
		item: "23.4",
		async run({ page, open, sim }) {
			const fails: string[] = [];
			for (const id of FAILURES) {
				await open(sim.thread(id));
				await expect(page.getByTestId("thread-page")).toBeVisible();
				// Visible text only: raw words behind a closed disclosure are allowed.
				const text = await page.locator("main").innerText();
				const hit = RAW.exec(text);
				if (hit) fails.push(`${id}: "${hit[0]}"`);
			}
			return verdict(
				fails,
				`${FAILURES.length} failing threads: no raw error code in the visible text`,
			);
		},
	},
]);
