// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { WorktreeChanges } from "@prismalens/contracts";
import { readWorktreeChanges } from "../investigations/worktree-changes.js";
import { fakeDb } from "./__fixtures__/fake-db.js";
import { incidentNumber, LinksService, parsePathRef } from "./links.service.js";

vi.mock("../investigations/worktree-changes.js", () => ({
	readWorktreeChanges: vi.fn(async () => ({ repos: [] })),
}));

const RUN = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const FOLDER = "55555555-5555-4555-8555-555555555555";
const root = mkdtempSync(join(tmpdir(), "pl-links-"));
const repo = join(root, "repo");
const outside = join(root, "outside");
mkdirSync(join(repo, "src"), { recursive: true });
mkdirSync(outside);
writeFileSync(join(repo, "src", "cart.ts"), "export {};\n");
writeFileSync(join(outside, "secret.txt"), "x");
// A junction needs no privilege on Windows, so a failure here is a broken fixture, never a skip.
symlinkSync(outside, join(repo, "escape"), "junction");
afterAll(() => rmSync(root, { recursive: true, force: true }));

const workspace = {
	layout: "single",
	cwd: repo,
	repos: [
		{
			name: "repo",
			dir: repo,
			sourceKind: "folder",
			url: repo,
			subPath: null,
			connectionId: null,
			head: "abc123",
			branch: "main",
			services: [],
		},
	],
};

const artifactEvent = {
	investigationId: RUN,
	event: JSON.stringify({
		kind: "artifact_published",
		runId: RUN,
		branchId: "root",
		path: [],
		seq: 4,
		label: null,
		ts: "2026-11-06T00:00:00.000Z",
		artifact: { id: "art-1", title: "Latency chart", html: "<p>x</p>", at: "2026-11-06T00:00:00.000Z" },
	}),
};

function service(extra: { id: string; workspace: string; title: string; status: string }[] = []) {
	const db = fakeDb({
		investigations: [
			{ id: RUN, workspace: JSON.stringify(workspace), title: "Cart", status: "completed" },
			{ id: OTHER, workspace: null, title: "Earlier", status: "running" },
			{
				id: FOLDER,
				workspace: JSON.stringify({ layout: "folder", cwd: repo, repos: [] }),
				title: "Folder",
				status: "completed",
			},
			...extra,
		],
		incidents: [{ id: "inc-7", number: 7 }],
		events: [artifactEvent, { investigationId: RUN, event: "not json" }],
	});
	return { db, svc: new LinksService(db as never) };
}

describe("parsePathRef", () => {
	it.each([
		["src/a.ts", { path: "src/a.ts" }],
		["`src/a.ts:12`", { path: "src/a.ts", line: 12 }],
		["src/a.ts:12-20", { path: "src/a.ts", line: 12, end: 20 }],
		["src/a.ts:12:5", { path: "src/a.ts", line: 12 }],
		["src/a.ts#L3-L9", { path: "src/a.ts", line: 3, end: 9 }],
		["src/a.ts:20-12", { path: "src/a.ts", line: 20 }],
		["src\\win\\a.ts:4", { path: "src/win/a.ts", line: 4 }],
	])("reads %s", (text, want) => {
		expect(parsePathRef(text)).toEqual(want);
	});

	it("refuses text that is not a path", () => {
		expect(parsePathRef("two words")).toBeNull();
	});

	it("reads incident numbers", () => {
		expect(incidentNumber("#42")).toBe(42);
		expect(incidentNumber("incident #7")).toBe(7);
		expect(incidentNumber("thread #7")).toBeNull();
	});
});

describe("LinksService.resolve (#1024 decision 4)", () => {
	it("links a file inside the workspace and nothing outside it", async () => {
		const { svc } = service();
		const out = await svc.resolve(RUN, [
			{ kind: "path", text: "src/cart.ts:3-5" },
			{ kind: "path", text: join(repo, "src", "cart.ts") },
			{ kind: "path", text: "../outside/secret.txt" },
			{ kind: "path", text: join(outside, "secret.txt") },
			{ kind: "path", text: "src/missing.ts" },
			{ kind: "path", text: "src" },
		]);
		expect(out[0]).toEqual({
			type: "file",
			repo: "repo",
			sha: "abc123",
			path: "src/cart.ts",
			line: 3,
			end: 5,
		});
		expect(out[1]).toMatchObject({ type: "file", path: "src/cart.ts" });
		expect(out.slice(2)).toEqual([null, null, null, null]);
	});

	it("never follows a link that leaves the workspace", async () => {
		const { svc } = service();
		expect(await svc.resolve(RUN, [{ kind: "path", text: "escape/secret.txt" }])).toEqual([
			null,
		]);
	});

	it("resolves URLs, threads, incidents and artifacts that exist, and only those", async () => {
		const { svc, db } = service();
		await db.pullRequest.create({
			data: {
				investigationId: RUN,
				host: "github",
				repo: "acme/cart",
				url: "https://github.com/acme/cart/pull/7",
				number: 7,
				source: "agent",
			},
		});
		const out = await svc.resolve(RUN, [
			{ kind: "url", text: "https://example.com/docs" },
			{ kind: "url", text: "https://github.com/acme/cart/pull/7" },
			{ kind: "url", text: "javascript:alert(1)" },
			{ kind: "url", text: "nope" },
			{ kind: "thread", text: `thread ${OTHER}` },
			{ kind: "thread", text: "33333333-3333-4333-8333-333333333333" },
			{ kind: "thread", text: "#4" },
			{ kind: "incident", text: "incident #7" },
			{ kind: "incident", text: "#8" },
			{ kind: "incident", text: "seven" },
			{ kind: "artifact", text: "latency chart" },
			{ kind: "artifact", text: "Nothing" },
			{ kind: "subagent", text: "helper" },
		]);
		expect(out[0]).toEqual({ type: "url", href: "https://example.com/docs" });
		expect(out[1]).toMatchObject({
			type: "pull_request",
			pullRequest: { number: 7, tone: "unknown" },
		});
		expect(out[2]).toBeNull();
		expect(out[3]).toBeNull();
		expect(out[4]).toEqual({
			type: "thread",
			id: OTHER,
			number: null,
			title: "Earlier",
			state: "running",
		});
		expect(out.slice(5, 7)).toEqual([null, null]);
		expect(out[7]).toEqual({ type: "incident", id: "inc-7", number: 7 });
		expect(out.slice(8, 10)).toEqual([null, null]);
		expect(out[10]).toEqual({ type: "artifact", id: "art-1", title: "Latency chart" });
		expect(out.slice(11)).toEqual([null, null]);
	});

	it("links a file in a folder workspace, which records no repos, inside its cwd only", async () => {
		const { svc } = service();
		const out = await svc.resolve(FOLDER, [
			{ kind: "path", text: "src/cart.ts:2" },
			{ kind: "path", text: "../outside/secret.txt" },
			{ kind: "path", text: "escape/secret.txt" },
		]);
		expect(out[0]).toEqual({
			type: "file",
			repo: "repo",
			sha: "",
			path: "src/cart.ts",
			line: 2,
		});
		expect(out.slice(1)).toEqual([null, null]);
	});

	it("resolves no path on a thread with no workspace, and 404s a missing thread", async () => {
		const { svc } = service();
		expect(await svc.resolve(OTHER, [{ kind: "path", text: "src/cart.ts" }])).toEqual([
			null,
		]);
		await expect(svc.resolve("44444444-4444-4444-8444-444444444444", [])).rejects.toThrow(
			/Thread not found/,
		);
	});
});

describe("LinksService.resolve of a bare file name (#1193)", () => {
	const SHA = "a".repeat(40);
	const TWO = "66666666-6666-4666-8666-666666666666";
	const repoDir = (name: string) => join(root, name);
	const record = (name: string) => ({
		name,
		dir: repoDir(name),
		sourceKind: "folder",
		url: repoDir(name),
		subPath: null,
		connectionId: null,
		head: SHA,
		branch: "main",
		services: [],
	});
	mkdirSync(join(repoDir("first"), "src"), { recursive: true });
	mkdirSync(join(repoDir("second"), "src"), { recursive: true });
	writeFileSync(join(repoDir("first"), "src", "a.ts"), "export {};\n");
	writeFileSync(join(repoDir("second"), "src", "a.ts"), "export {};\n");
	const changes = (
		repo: string,
		files: { path: string; status: "added" | "modified" | "deleted" }[],
	): WorktreeChanges["repos"][number] => ({
		state: "ok",
		repo,
		base: SHA,
		branch: "main",
		files: files.map((f) => ({ ...f, additions: 0, deletions: 0 })),
		additions: 0,
		deletions: 0,
		patch: null,
		omitted: "per-file",
		truncated: false,
	});
	const resolve = async (repos: WorktreeChanges["repos"], text: string) => {
		vi.mocked(readWorktreeChanges).mockResolvedValueOnce({ repos });
		const { svc } = service([
			{
				id: TWO,
				workspace: JSON.stringify({
					layout: "single",
					cwd: repoDir("first"),
					repos: [record("first"), record("second")],
				}),
				title: "Two repos",
				status: "completed",
			},
		]);
		const [out] = await svc.resolve(TWO, [{ kind: "path", text }]);
		return out;
	};

	it("opens the file in the repo that changed it, not the cwd's repo that holds an unchanged one", async () => {
		expect(
			await resolve([changes("second", [{ path: "src/a.ts", status: "modified" }])], "a.ts:12"),
		).toEqual({ type: "file", repo: "second", sha: SHA, path: "src/a.ts", line: 12 });
	});

	it("links the diff at the matched full path when the one changed file of that name was deleted", async () => {
		expect(
			await resolve([changes("second", [{ path: "src/gone.tsx", status: "deleted" }])], "gone.tsx:802"),
		).toEqual({ type: "diff", path: "src/gone.tsx" });
	});

	it("links nothing when two changed files share the name", async () => {
		expect(
			await resolve(
				[
					changes("first", [{ path: "src/b.ts", status: "added" }]),
					changes("second", [{ path: "src/b.ts", status: "added" }]),
				],
				"b.ts:1",
			),
		).toBeNull();
	});
});
