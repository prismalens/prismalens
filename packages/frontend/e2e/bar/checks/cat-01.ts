// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { expect } from "@playwright/test";
import { defineChecks, verdict } from "../bar";

/** #1101 category 1, Thread list: the sidebar on the sim's threads.many list. */
export default defineChecks([
	{
		item: "1.4",
		async run({ page, open }) {
			await open("/new");
			const rows = page.getByTestId("thread-tree").getByTestId("thread-row");
			await expect(rows.first()).toBeVisible();
			const seen = await rows.evaluateAll((els) =>
				els.map((el) => {
					const wrap = el.closest('[data-testid="thread-row-wrap"]') ?? el;
					const text = (id: string) =>
						wrap.querySelector(`[data-testid="${id}"]`)?.textContent?.trim() ??
						"";
					return {
						title: text("row-title"),
						word: text("row-status"),
						age: text("row-age"),
						needs: !!el.closest('[data-testid="thread-section-needs"]'),
						detail: text("row-detail") || text("row-cause"),
					};
				}),
			);
			const fails = seen.flatMap((r, i) => {
				const name = r.title || `row ${i + 1}`;
				return [
					!r.title && `${name}: no title`,
					!r.word && `${name}: no status word`,
					!r.age && `${name}: no age`,
					r.needs &&
						!r.detail &&
						`${name}: a needs-you row with no detail line`,
				].filter((x): x is string => !!x);
			});
			return verdict(
				fails,
				`${seen.length} rows: each has a title, a status word and an age; ${seen.filter((r) => r.needs).length} needs-you rows each have a detail line`,
			);
		},
	},
]);
