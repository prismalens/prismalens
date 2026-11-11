// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { WorkItem } from "@prismalens/contracts";
import { ReferencesService } from "./references.service.js";
import { WorkItemsProvider, type WorkItemsSource } from "./work-items.provider.js";

const PR: WorkItem = {
	kind: "pull_request",
	number: 42,
	title: "Fix the pool size",
	state: "open",
	tone: "open",
	url: "https://github.com/acme/shop/pull/42",
};

function setup() {
	const findWorkItems = vi.fn(async (_repositoryId: string, n: number) => (n === 42 ? [PR] : []));
	const source: WorkItemsSource = {
		remotes: async () => [{ repositoryId: "r1", host: "github.com", repo: "acme/shop" }],
		findWorkItems,
		searchWorkItems: async () => [],
	};
	const svc = new ReferencesService({} as never, [new WorkItemsProvider(() => source)]);
	return { svc, findWorkItems };
}

describe("POST /references/resolve (#1024)", () => {
	it("maps a GitHub PR URL on a configured repository to its hit, read from that repository", async () => {
		const { svc, findWorkItems } = setup();
		const { results } = await svc.resolveUrls(["https://github.com/acme/shop/pull/42"]);
		expect(results).toEqual([
			{
				url: "https://github.com/acme/shop/pull/42",
				ref: { kind: "pull_request", id: "r1:pull_request:42", label: "#42 Fix the pool size" },
				detail: "open",
				tone: "open",
				group: "GitHub · acme/shop",
				why: "match",
				score: 1,
			},
		]);
		expect(findWorkItems).toHaveBeenCalledWith("r1", 42);
	});

	it("an unknown host yields a reason", async () => {
		const { svc } = setup();
		const { results } = await svc.resolveUrls(["https://gitlab.example.com/acme/shop/-/merge_requests/3"]);
		expect(results).toEqual([
			{
				url: "https://gitlab.example.com/acme/shop/-/merge_requests/3",
				reason: "No connected source recognises this link.",
			},
		]);
	});

	it("the same repo path on another host never reaches the configured repository's API", async () => {
		const { svc, findWorkItems } = setup();
		const { results } = await svc.resolveUrls(["https://github.com.evil.example/acme/shop/pull/42"]);
		expect(results).toEqual([
			{
				url: "https://github.com.evil.example/acme/shop/pull/42",
				reason: "No connected source recognises this link.",
			},
		]);
		expect(findWorkItems).not.toHaveBeenCalled();
	});

	it("a configured repository's item the host does not return yields the host's reason", async () => {
		const { svc } = setup();
		const { results } = await svc.resolveUrls(["https://github.com/acme/shop/issues/7"]);
		expect(results).toEqual([
			{
				url: "https://github.com/acme/shop/issues/7",
				reason: 'GitHub · acme/shop: could not read #7; is "Show pull request status" on?',
			},
		]);
	});
});
