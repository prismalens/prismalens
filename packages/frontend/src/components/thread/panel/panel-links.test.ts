// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { LinkTarget, PullRequest } from "@prismalens/contracts";
import { describe, expect, it } from "vitest";
import { hrefOf, placeOf } from "./panel-links";

describe("placeOf for LinkTarget types (#1024)", () => {
	it("maps file with line to panel changes with repo prefix and line", () => {
		const target: LinkTarget = {
			type: "file",
			repo: "repo",
			sha: "abc1234",
			path: "src/a.ts",
			line: 12,
		};
		expect(placeOf(target, false)).toEqual({
			to: "panel",
			search: {
				panel: "changes",
				path: "repo:src/a.ts",
				line: 12,
			},
		});
	});

	it("maps diff to panel changes", () => {
		const target: LinkTarget = {
			type: "diff",
			path: "src/a.ts",
		};
		expect(placeOf(target, false)).toEqual({
			to: "panel",
			search: { panel: "changes" },
		});
	});

	it("maps pull_request to panel thread with section", () => {
		const target: LinkTarget = {
			type: "pull_request",
			pullRequest: { id: "pr-42" } as PullRequest,
		};
		expect(placeOf(target, false)).toEqual({
			to: "panel",
			search: {
				panel: "thread",
				section: "pull-requests:pr-42",
			},
		});
	});

	it("maps thread to thread target", () => {
		const target: LinkTarget = {
			type: "thread",
			id: "th-1",
			number: 1,
			title: "Thread 1",
			state: "completed",
		};
		expect(placeOf(target, false)).toEqual({
			to: "thread",
			id: "th-1",
		});
	});

	it("maps incident to incident target", () => {
		const target: LinkTarget = {
			type: "incident",
			id: "inc-1",
			number: 7,
		};
		expect(placeOf(target, false)).toEqual({
			to: "incident",
			id: "inc-1",
		});
	});

	it("maps subagent to subagent target", () => {
		const target: LinkTarget = {
			type: "subagent",
			sessionId: "sub-1",
			title: "Subagent 1",
		};
		expect(placeOf(target, false)).toEqual({
			to: "subagent",
			sessionId: "sub-1",
		});
	});

	it("maps artifact to artifact target", () => {
		const target: LinkTarget = {
			type: "artifact",
			id: "art-1",
			title: "Artifact 1",
		};
		expect(placeOf(target, false)).toEqual({
			to: "artifact",
			id: "art-1",
		});
	});

	it("maps localhost url to browser when desktop true and tab when desktop false", () => {
		const target: LinkTarget = {
			type: "url",
			href: "http://localhost:3000/api",
		};
		expect(placeOf(target, true)).toEqual({
			to: "browser",
			href: "http://localhost:3000/api",
		});
		expect(placeOf(target, false)).toEqual({
			to: "tab",
			href: "http://localhost:3000/api",
		});
	});

	it("maps external url example.com to tab regardless of desktop", () => {
		const target: LinkTarget = {
			type: "url",
			href: "https://example.com",
		};
		expect(placeOf(target, true)).toEqual({
			to: "tab",
			href: "https://example.com",
		});
		expect(placeOf(target, false)).toEqual({
			to: "tab",
			href: "https://example.com",
		});
	});
});

describe("hrefOf (#1024)", () => {
	it("formats href for a file target with query params", () => {
		const target: LinkTarget = {
			type: "file",
			repo: "repo",
			sha: "abc1234",
			path: "src/a.ts",
			line: 12,
		};
		expect(hrefOf(target, "/threads/t1")).toBe(
			"/threads/t1?panel=changes&path=repo%3Asrc%2Fa.ts&line=12",
		);
	});

	it("formats href for a thread target", () => {
		const target: LinkTarget = {
			type: "thread",
			id: "th-99",
			number: 99,
			title: "Thread 99",
			state: "completed",
		};
		expect(hrefOf(target, "/threads/t1")).toBe("/threads/th-99");
	});
});
