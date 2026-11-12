// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import {
	attentionKindOf,
	mayNotify,
	staleKinds,
} from "./attention-rules.js";

describe("attention-rules (#1101 categories 3 and 4)", () => {
	describe("attentionKindOf", () => {
		it("prev undefined & not fresh -> null", () => {
			expect(
				attentionKindOf({
					prev: undefined,
					next: "working",
					triggered: false,
					fresh: false,
				}),
			).toBe(null);
		});

		it("prev undefined, fresh, triggered, next working -> started", () => {
			expect(
				attentionKindOf({
					prev: undefined,
					next: "working",
					triggered: true,
					fresh: true,
				}),
			).toBe("started");
		});

		it("prev undefined, fresh, not triggered, next working -> null", () => {
			expect(
				attentionKindOf({
					prev: undefined,
					next: "working",
					triggered: false,
					fresh: true,
				}),
			).toBe(null);
		});

		it("prev undefined, fresh, next done -> finished (fresh thread seen already stopped)", () => {
			expect(
				attentionKindOf({
					prev: undefined,
					next: "done",
					triggered: false,
					fresh: true,
				}),
			).toBe("finished");
		});

		it("working->approval needs_you", () => {
			expect(
				attentionKindOf({
					prev: "working",
					next: "approval",
					triggered: false,
					fresh: false,
				}),
			).toBe("needs_you");
		});

		it("approval->question null", () => {
			expect(
				attentionKindOf({
					prev: "approval",
					next: "question",
					triggered: false,
					fresh: false,
				}),
			).toBe(null);
		});

		it("waiting->limited limited", () => {
			expect(
				attentionKindOf({
					prev: "waiting",
					next: "limited",
					triggered: false,
					fresh: false,
				}),
			).toBe("limited");
		});

		it("working->blocked blocked", () => {
			expect(
				attentionKindOf({
					prev: "working",
					next: "blocked",
					triggered: false,
					fresh: false,
				}),
			).toBe("blocked");
		});

		it("working->failed failed", () => {
			expect(
				attentionKindOf({
					prev: "working",
					next: "failed",
					triggered: false,
					fresh: false,
				}),
			).toBe("failed");
		});

		it("waiting->done finished", () => {
			expect(
				attentionKindOf({
					prev: "waiting",
					next: "done",
					triggered: false,
					fresh: false,
				}),
			).toBe("finished");
		});

		it("null->done null", () => {
			expect(
				attentionKindOf({
					prev: null,
					next: "done",
					triggered: false,
					fresh: false,
				}),
			).toBe(null);
		});

		it("done->done null", () => {
			expect(
				attentionKindOf({
					prev: "done",
					next: "done",
					triggered: false,
					fresh: false,
				}),
			).toBe(null);
		});
	});

	describe("mayNotify", () => {
		it("mute -> false for every kind", () => {
			expect(
				mayNotify({
					kind: "needs_you",
					follow: "mute",
					child: false,
					triggered: false,
				}),
			).toBe(false);
			expect(
				mayNotify({
					kind: "finished",
					follow: "mute",
					child: false,
					triggered: false,
				}),
			).toBe(false);
			expect(
				mayNotify({
					kind: "failed",
					follow: "mute",
					child: false,
					triggered: false,
				}),
			).toBe(false);
			expect(
				mayNotify({
					kind: "limited",
					follow: "mute",
					child: false,
					triggered: false,
				}),
			).toBe(false);
			expect(
				mayNotify({
					kind: "blocked",
					follow: "mute",
					child: false,
					triggered: false,
				}),
			).toBe(false);
			expect(
				mayNotify({
					kind: "started",
					follow: "mute",
					child: false,
					triggered: false,
				}),
			).toBe(false);
		});

		it("started -> false", () => {
			expect(
				mayNotify({
					kind: "started",
					follow: null,
					child: false,
					triggered: false,
				}),
			).toBe(false);
		});

		it("finished on a root the operator started -> true", () => {
			expect(
				mayNotify({
					kind: "finished",
					follow: null,
					child: false,
					triggered: false,
				}),
			).toBe(true);
		});

		it("finished on a triggered root -> false", () => {
			expect(
				mayNotify({
					kind: "finished",
					follow: null,
					child: false,
					triggered: true,
				}),
			).toBe(false);
		});

		it("finished on a child -> false", () => {
			expect(
				mayNotify({
					kind: "finished",
					follow: null,
					child: true,
					triggered: false,
				}),
			).toBe(false);
		});

		it("finished on a watched child -> true", () => {
			expect(
				mayNotify({
					kind: "finished",
					follow: "watch",
					child: true,
					triggered: false,
				}),
			).toBe(true);
		});

		it("failed on a child -> false", () => {
			expect(
				mayNotify({
					kind: "failed",
					follow: null,
					child: true,
					triggered: false,
				}),
			).toBe(false);
		});

		it("failed on a watched child -> true", () => {
			expect(
				mayNotify({
					kind: "failed",
					follow: "watch",
					child: true,
					triggered: false,
				}),
			).toBe(true);
		});

		it("needs_you on a child -> true", () => {
			expect(
				mayNotify({
					kind: "needs_you",
					follow: null,
					child: true,
					triggered: false,
				}),
			).toBe(true);
		});
	});

	describe("staleKinds", () => {
		it("for done exactly [needs_you, limited, blocked]", () => {
			expect(staleKinds("done")).toEqual([
				"needs_you",
				"limited",
				"blocked",
			]);
		});

		it("for approval exactly [limited, blocked]", () => {
			expect(staleKinds("approval")).toEqual(["limited", "blocked"]);
		});

		it("for limited exactly [needs_you, blocked]", () => {
			expect(staleKinds("limited")).toEqual(["needs_you", "blocked"]);
		});
	});
});
