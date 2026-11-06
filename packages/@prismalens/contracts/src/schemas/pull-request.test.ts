// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import {
	NO_CHECKS,
	PR_TONE_TOKEN,
	PR_TONES,
	type PrChecks,
	type PrToneInput,
	PullRequestSchema,
	prTone,
} from "./pull-request.js";

const checks = (state: PrChecks["state"]): PrChecks => ({
	state,
	total: state === "none" ? 0 : 2,
	failed: state === "failing" ? 1 : 0,
	pending: state === "pending" ? 1 : 0,
});
const open = (over: Partial<PrToneInput> = {}): PrToneInput => ({
	state: "open",
	review: "approved",
	checks: checks("passing"),
	conflicts: false,
	...over,
});

describe("prTone (#1024 item 16)", () => {
	it.each([
		["merged", { state: "merged" }],
		["closed", { state: "closed" }],
		["draft", { state: "draft", checks: checks("failing") }],
		["unknown", { state: "unknown" }],
		["ready", {}],
		["ready", { review: "none", checks: NO_CHECKS }],
		["failing", { checks: checks("failing"), review: "changes_requested" }],
		["attention", { review: "changes_requested" }],
		["attention", { conflicts: true }],
		["attention", { checks: checks("pending") }],
		["open", { review: "review_required" }],
		["open", { review: "unknown" }],
		["open", { checks: checks("unknown") }],
		["open", { conflicts: null }],
	] as const)("is %s for %j", (tone, over) => {
		expect(prTone(open(over as Partial<PrToneInput>))).toBe(tone);
	});

	it("maps every tone to one design token", () => {
		for (const tone of PR_TONES) expect(PR_TONE_TOKEN[tone]).toBeTruthy();
		expect(new Set(Object.values(PR_TONE_TOKEN)).size).toBe(7);
	});

	it("parses a PR with the faces the host gave, and without them", () => {
		const base = {
			id: "p1",
			url: "https://github.com/acme/cart/pull/7",
			host: "github",
			repo: "acme/cart",
			number: 7,
			title: "Fix",
			...open(),
			tone: "ready",
			source: "agent",
			fetchedAt: null,
		};
		expect(PullRequestSchema.safeParse(base).success).toBe(true);
		expect(
			PullRequestSchema.safeParse({
				...base,
				author: { login: "ana", avatarUrl: "https://avatars.example/u/1" },
				reviewers: [{ login: "bo", state: "approved" }],
				checkRuns: [{ name: "ci", state: "passing", appName: "Actions" }],
			}).success,
		).toBe(true);
		expect(
			PullRequestSchema.safeParse({ ...base, author: { login: "x", avatarUrl: "nope" } })
				.success,
		).toBe(false);
		// A read serves the image proxy's signed path; no other relative path passes (#1024).
		const avatar = (avatarUrl: string) =>
			PullRequestSchema.safeParse({ ...base, author: { login: "x", avatarUrl } }).success;
		expect(avatar("/api/images/eyJ1Ijoi.c2ln-_x")).toBe(true);
		expect(avatar("/api/repositories/1/icon")).toBe(false);
		expect(avatar("/api/images/../secrets")).toBe(false);
	});
});
