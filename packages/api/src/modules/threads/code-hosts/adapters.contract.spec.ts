// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * A new host adds a fixture file and a line in CONTRACT_FIXTURES,
 * and this suite runs it.
 */

import { describe, expect, it, vi } from "vitest";
import { sourceRequestFn } from "../../integrations/source-request.js";
import { fakeHost } from "../__fixtures__/fake-host.js";
import { type EtagCache, LOG_UNAVAILABLE } from "./common.js";
import { CODE_HOSTS } from "./registry.js";
import { CONTRACT_FIXTURES } from "./__fixtures__/contract.js";

const req = (impl: typeof fetch, base: string) =>
	sourceRequestFn(base, { ok: true, credential: { kind: "none" } }, {
		fetchImpl: impl,
		maxRedirects: 0,
		maxBytes: 1024 * 1024,
	});

describe.each(Object.values(CODE_HOSTS))("$kind code-host adapter contract", (adapter) => {
	const fixture = CONTRACT_FIXTURES[adapter.kind];

	it("registers a fixture with matching kind and terms", () => {
		expect(fixture.kind).toBe(adapter.kind);
		expect(adapter.terms).toEqual(fixture.terms);
	});

	it("maps host to expected apiBase origin", () => {
		expect(adapter.apiBase(fixture.host)).toBe(fixture.apiBase);
	});

	it("parses path segments into repo and number, rebuilds webUrl from webPath, and returns null for another host", () => {
		const segments = new URL(fixture.webUrl).pathname.split("/").filter(Boolean);
		expect(adapter.parsePath(segments)).toEqual(fixture.parsePath);
		const rebuilt = `https://${fixture.host}/${fixture.repo}/${adapter.webPath(fixture.number)}`;
		expect(rebuilt).toBe(fixture.webUrl);
		expect(adapter.parsePath(fixture.otherHostPathSegments)).toBeNull();
	});

	it("reads state, headSha, checks, and reuses cached read sending If-None-Match", async () => {
		const host = fakeHost(fixture.routes());
		const client = req(host.impl, fixture.apiBase);
		const cache: EtagCache = {};
		const first = await adapter.read(client, fixture.repo, fixture.number, cache);
		expect(first.state).toBe(fixture.read.state);
		expect(first.headSha).toBe(fixture.read.headSha);
		expect(first.checks).toEqual(fixture.read.checks);

		const second = await adapter.read(client, fixture.repo, fixture.number, cache);
		expect(second).toEqual(first);
		const secondCalls = host.calls.slice(fixture.secondReadEtags.length);
		expect(secondCalls.map((c) => c.headers["if-none-match"])).toEqual(fixture.secondReadEtags);
	});

	it("reads activity items in order", async () => {
		const host = fakeHost(fixture.routes());
		const client = req(host.impl, fixture.apiBase);
		const items = await adapter.readActivity(client, fixture.repo, fixture.number, {});
		const summary = items.map((i) => ({ source: i.source, id: i.id, login: i.login }));
		expect(summary).toEqual(fixture.activity);
	});

	it("reads review threads returning expected ids and resolved flags", async () => {
		const host = fakeHost(fixture.routes());
		const client = req(host.impl, fixture.apiBase);
		const threads = await adapter.readReviewThreads(
			client,
			fixture.repo,
			fixture.number,
			fixture.apiBase,
		);
		const summary = threads.map((t) => ({ id: t.id, resolved: t.resolved }));
		expect(summary).toEqual(fixture.reviewThreads);
	});

	it("reads check log returning expected step and last line", async () => {
		const host = fakeHost(fixture.routes());
		const client = req(host.impl, fixture.apiBase);
		const locate = vi.fn(async () => ({
			status: 302,
			location: "https://pipelines.actions.githubusercontent.com/log.txt",
		}));
		const download = vi.fn(async () =>
			new Response(
				"Compiling source files\n##[error]Process exited with code 1\npost error 1\npost error 2",
				{ status: 200 },
			),
		);
		const result = await adapter.readCheckLog(
			{ req: client, apiBase: fixture.apiBase, locate, download },
			fixture.repo,
			fixture.checkRun,
		);
		expect(result.step).toBe(fixture.checkLog.step);
		expect(result.unavailable).toBe(fixture.checkLog.unavailable);
		expect(result.lines.at(-1)).toBe(fixture.checkLog.lastLine);
	});

	it.skipIf(!fixture.statusRun)(
		"returns LOG_UNAVAILABLE.status for a run with no appId when host separates commit statuses",
		async () => {
			const host = fakeHost(fixture.routes());
			const client = req(host.impl, fixture.apiBase);
			const locate = vi.fn();
			const download = vi.fn();
			const result = await adapter.readCheckLog(
				{ req: client, apiBase: fixture.apiBase, locate, download },
				fixture.repo,
				fixture.statusRun!,
			);
			expect(result.step).toBeNull();
			expect(result.lines).toEqual([]);
			expect(result.unavailable).toBe(LOG_UNAVAILABLE.status);
		},
	);

	it("finds change request by branch returning expected URL and returns null on 404", async () => {
		const host = fakeHost(fixture.routes());
		const client = req(host.impl, fixture.apiBase);
		const url = await adapter.findByBranch(client, fixture.repo, fixture.branch);
		expect(url).toBe(fixture.findByBranchUrl);

		const notFoundHost = fakeHost({});
		const notFoundClient = req(notFoundHost.impl, fixture.apiBase);
		const notFound = await adapter.findByBranch(notFoundClient, fixture.repo, fixture.branch);
		expect(notFound).toBeNull();
	});
});
