// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import type { PrCheckRun } from "@prismalens/contracts";
import { cutAtWord, hostPlain, retained } from "./common.js";

describe("code-hosts common", () => {
	describe("hostPlain", () => {
		it("is idempotent over various markup constructs", () => {
			const samples = [
				"plain text without markup",
				"<!-- closed comment -->Visible text<!-- another comment -->",
				"<!-- unterminated comment at the end",
				"<details><summary>Summary line</summary>Body content inside details</details>",
				'<picture><source srcset="img.webp"><img src="img.png" alt="alt text"></picture>Following text',
				'<img src="https://example.com/pic.png" alt="image"> Standalone image',
				"Other tags <span>span text</span> and <b>bold text</b>",
				"Encoded entities &amp; &lt; &gt; &quot; &#39; left encoded",
				"Inline code `foo.bar(Array<string>)` preserved",
				"```ts\nfunction generic<T>(): Array<string> { return []; }\n```",
				"Generics like Array<string> or Map<string, number> outside code",
			];

			for (const sample of samples) {
				const once = hostPlain(sample);
				const twice = hostPlain(once);
				expect(twice).toBe(once);
			}
		});

		it("keeps summary and body for details tag and separates summary", () => {
			const input = "<details><summary>My Summary</summary>My Body</details>";
			const result = hostPlain(input);
			expect(result).toBe("My Summary\nMy Body");
		});

		it("removes closed and unterminated comments", () => {
			expect(hostPlain("hello<!-- comment -->world")).toBe("helloworld");
			expect(hostPlain("hello<!-- unterminated comment")).toBe("hello");
		});

		it("removes picture and img tags", () => {
			expect(hostPlain("before<picture><img src=\"a.png\"></picture>after")).toBe("beforeafter");
			expect(hostPlain("before<img src=\"a.png\" />after")).toBe("beforeafter");
		});

		it("leaves encoded entities encoded", () => {
			expect(hostPlain("&amp; &lt; &gt;")).toBe("&amp; &lt; &gt;");
		});

		it("leaves inline code and code blocks untouched", () => {
			const code = "Check `Array<string>` and ```\n<details>test</details>\n```";
			const res = hostPlain(code);
			expect(res).toContain("`Array<string>`");
			expect(res).toContain("```\n<details>test</details>\n```");
		});

		it("preserves plain text unchanged", () => {
			expect(hostPlain("Just simple text.")).toBe("Just simple text.");
		});

		it("lands cut on a word boundary with an ellipsis", () => {
			const text = "one two three four five six seven eight nine ten";
			const cut = cutAtWord(text, 15);
			expect(cut).toBe("one two three…");
			expect(cut.endsWith("…")).toBe(true);
			expect(cut.length).toBeLessThanOrEqual(15);

			// hostPlain cutAtWord boundary
			const plainCut = hostPlain(text, 15);
			expect(plainCut).toBe("one two three…");
		});
	});

	describe("retention", () => {
		const makeRun = (id: string, state: PrCheckRun["state"], group?: string): PrCheckRun => ({
			id,
			name: `run-${id}`,
			state,
			...(group ? { group } : {}),
		});

		it("keeps all 3 failing runs out of 144 total runs", () => {
			// 3 failing, 141 passing
			const runs: PrCheckRun[] = [
				...Array.from({ length: 50 }, (_, i) => makeRun(`pass-${i}`, "passing")),
				makeRun("fail-1", "failing"),
				...Array.from({ length: 50 }, (_, i) => makeRun(`pass-${i + 50}`, "passing")),
				makeRun("fail-2", "failing"),
				...Array.from({ length: 41 }, (_, i) => makeRun(`pass-${i + 100}`, "passing")),
				makeRun("fail-3", "failing"),
			];
			expect(runs.length).toBe(144);

			const kept = retained(runs);
			const failingKept = kept.filter((r) => r.state === "failing");
			expect(failingKept.length).toBe(3);
			expect(failingKept.map((r) => r.id)).toEqual(["fail-1", "fail-2", "fail-3"]);
			// Non-failing runs are filled up to PR_CHECK_RUNS_MAX (50)
			expect(kept.length).toBe(3 + 50);
		});

		it("keeps 200 failing runs when there are 250 failing runs, with correct remainder count", () => {
			const runs: PrCheckRun[] = Array.from({ length: 250 }, (_, i) =>
				makeRun(`fail-${i}`, "failing"),
			);
			const kept = retained(runs);
			expect(kept.length).toBe(200);
			const remainder = runs.length - kept.length;
			expect(remainder).toBe(50);
		});
	});
});
