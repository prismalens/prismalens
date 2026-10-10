// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type {
	CanonicalEvent,
	InvestigationReport,
} from "@prismalens/contracts";
import { describe, expect, it } from "vitest";
import { answerWord } from "./answer-word";
import { refusalReason, refusalSentence } from "./refusal-sentence";
import { formatClock } from "./format-time";
import {
	commandText,
	evidenceLabel,
	fixBrief,
	gapsOf,
	groundedIn,
	harnessWords,
	inReportOrder,
	nowLine,
	reportAlert,
	shortPath,
	workDone,
} from "./report-view";

const report = (over: Partial<InvestigationReport> = {}): InvestigationReport => ({
	summary: "s",
	rootCause: "Checkout calls the provider with no `timeout`",
	rootCauseCategory: "code",
	culprit: { service: "payments-api", changeRef: "7f3c2a1", mechanism: null },
	hypotheses: [
		{
			statement: "No timeout",
			status: "supported",
			evidence: [
				{ observation: "no timeout", source: "/w/runs/1/repo/api/p.py:48", direction: "supports", status: "verified", toolCallId: "t1" },
				{ observation: "errors at 14:03", source: "rate(http_errors[5m])", direction: "supports", status: "verified" },
				{ observation: "pool held", source: "reasoning", direction: "supports", status: "inferred" },
			],
		},
	],
	ruledOut: [],
	coverage: { queried: ["git log"], notQueried: ["prometheus"] },
	nextSteps: [],
	...over,
});

const refused = (seq: number, source: string, error: string): CanonicalEvent =>
	({
		kind: "tool_result",
		branchId: "run",
		seq,
		ts: "2026-10-03T14:00:00Z",
		result: { name: "bash", toolCategory: null, toolCallId: `c${seq}`, source, ok: false, error, preview: error },
	}) as CanonicalEvent;

describe("answerWord", () => {
	it("reads Likely with what it rests on for a supported cause", () => {
		expect(answerWord(report())).toEqual({
			word: "Likely",
			tone: "accent",
			basis: "3 pieces of evidence for it, none against",
		});
	});
	it("reads Confirmed, Unconfirmed and No cause found from the hypothesis", () => {
		const h = report().hypotheses[0];
		if (!h) throw new Error("fixture");
		expect(answerWord(report({ hypotheses: [{ ...h, status: "confirmed" }] })).word).toBe("Confirmed");
		expect(answerWord(report({ hypotheses: [{ ...h, status: "speculative" }] })).word).toBe("Unconfirmed");
		const none = answerWord(report({ rootCause: null }));
		expect(none.word).toBe("No cause found");
		expect(none.basis).toBe("one finding is supported, but not as a cause");
	});
});

describe("refusals", () => {
	it("keeps a stored legacy refusal's reason and drops its detail (#673 w21)", () => {
		const why = refusalReason(
			"Refused by PrismaLens's read-only policy: reaches a host outside the brief: https://example.com.",
		);
		expect(why).toBe("reaches a host outside the brief");
		expect(refusalSentence(why ?? "")).toBe("Not run: it reaches a host outside the brief.");
	});
	it("reads a plain tool result, the agent's own refusal included, as no PrismaLens refusal", () => {
		expect(refusalReason("ls: no such file")).toBeNull();
		expect(refusalReason("User refused permission to run tool")).toBeNull();
	});
	it("reads a call's source as the command or path that ran", () => {
		expect(
			commandText('bash({"command":"git show e87ad72","cwd":"/w/r/repo"})', "/w/r/repo"),
		).toBe("git show e87ad72");
		expect(commandText('read({"path":"/w/r/repo/api/b.py"})', "/w/r/repo")).toBe(
			"read repo/api/b.py",
		);
		expect(commandText('`curl -s https://x.example`({"command":"curl -s https://x.example"})')).toBe(
			"curl -s https://x.example",
		);
		expect(commandText("git log")).toBe("git log");
	});

	it("formats file operations and terminal calls into plain commands (#673)", () => {
		expect(
			commandText('Write /tmp/x({"file_path":"/tmp/x","content":"hi"})'),
		).toBe("write /tmp/x");
		expect(
			commandText(
				'Edit({"file_path":"/a.ts","old_string":"a","new_string":"b"})',
			),
		).toBe("edit /a.ts");
		expect(commandText('Read({"path":"/b.ts"})')).toBe("read /b.ts");
		expect(commandText('terminal({"command":"cat x"})')).toBe("cat x");
	});


	it("lists refusals before what the run did not query", () => {
		const gaps = gapsOf(report(), [
			refused(1, "curl https://example.com", "Refused by PrismaLens's read-only policy: sends a request body."),
			refused(2, "ls", "exit 2"),
		]);
		expect(gaps).toEqual([
			{ kind: "refused", source: "curl https://example.com", reason: "sends a request body", toolCallId: "c1" },
			{ kind: "not-queried", source: "prometheus" },
		]);
	});
});

describe("report facts", () => {
	it("says whether it is still firing, and since when", () => {
		const firing = nowLine(
			[{ status: "triggered", triggeredAt: "2026-10-03T14:03:00", resolvedAt: null }],
			"Payments API",
		);
		expect(firing).toEqual({ text: "1 alert still firing since 14:03 on Payments API", firing: true });
		const cleared = nowLine(
			[{ status: "resolved", triggeredAt: "2026-10-03T17:02:00", resolvedAt: "2026-10-03T17:06:00" }],
			"Booklogr API",
		);
		expect(cleared?.text).toBe("Alert cleared at 17:06; nothing firing on Booklogr API now");
		expect(nowLine([], null)).toBeNull();
	});
	it("keeps the agent's own error verbatim", () => {
		expect(
			harnessWords(
				"harness exited early (code=1 signal=null): Not logged in. Run claude /login",
			),
		).toBe("Not logged in. Run claude /login");
		expect(harnessWords("API Error: 529")).toBe("API Error: 529");
	});

	it("labels evidence For or Against, seen or inferred", () => {
		expect(evidenceLabel({ direction: "supports", status: "verified" })).toBe("For, seen");
		expect(evidenceLabel({ direction: "contradicts", status: "inferred" })).toBe("Against, inferred");
	});
	it("lists each source once with the run's copy as repo/", () => {
		expect(shortPath("/w/runs/1/repo/api/p.py", "/w/runs/1/repo")).toBe("repo/api/p.py");
		expect(groundedIn(report(), "/w/runs/1/repo")).toEqual([
			"git log",
			"repo/api/p.py:48",
			"rate(http_errors[5m])",
			"reasoning",
		]);
	});
	it("counts what a run got through", () => {
		const ok = (seq: number, cat: string | null) =>
			({ ...refused(seq, "x", ""), result: { name: "x", toolCategory: cat, toolCallId: `c${seq}`, source: "x", ok: true, error: null, preview: "" } }) as CanonicalEvent;
		expect(workDone([ok(1, "file"), ok(2, null), ok(3, null)])).toEqual({ commands: 2, files: 1 });
	});
	it("writes a fix brief with the cause, commit, evidence and open steps", () => {
		const text = fixBrief({
			incident: { number: 1, title: "PaymentsCheckoutErrorRate" },
			report: report(),
			cwd: "/w/runs/1/repo",
			steps: [
				{ title: "Roll back 7f3c2a1", detail: null, done: true },
				{ title: "Confirm the error rate falls", detail: "under 1% for 10 minutes", done: false },
			],
		});
		expect(text).toContain("Cause (Likely): Checkout calls the provider with no `timeout`");
		expect(text).toContain("Commit: 7f3c2a1");
		expect(text).toContain("- no timeout (For, seen; repo/api/p.py:48)");
		expect(text).toContain("1. Confirm the error rate falls: under 1% for 10 minutes");
		expect(text).not.toContain("Roll back");
	});
});

describe("inReportOrder", () => {
	const steps = [{ title: "Roll back" }, { title: "Page the owner" }];

	it("follows the report's order and puts an unlisted title last", () => {
		const recs = [
			{ title: "Unlisted" },
			{ title: "Page the owner" },
			{ title: "Roll back" },
		];
		expect(inReportOrder(recs, steps).map((r) => r.title)).toEqual([
			"Roll back",
			"Page the owner",
			"Unlisted",
		]);
	});
});

describe("reportAlert", () => {
	it("returns null when there are no alerts", () => {
		expect(reportAlert([], "2026-10-03T14:30:00Z")).toBeNull();
	});

	it("returns firing true and 'still firing' when firing with no resolvedAt", () => {
		const alert = {
			alertName: "HighLatency",
			status: "triggered",
			triggeredAt: "2026-10-03T14:00:00Z",
			resolvedAt: null,
		};
		expect(reportAlert([alert], "2026-10-03T14:30:00Z")).toEqual({
			name: "HighLatency",
			firing: true,
			line: "still firing",
		});
	});

	it("returns firing false and line 'cleared at <clock>' when resolvedAt is before writtenAt", () => {
		const resolvedAt = "2026-10-03T14:20:00Z";
		const writtenAt = "2026-10-03T14:30:00Z";
		const alert = {
			alertName: "HighLatency",
			status: "resolved",
			triggeredAt: "2026-10-03T14:00:00Z",
			resolvedAt,
		};
		const expectedClock = formatClock(Date.parse(resolvedAt));
		expect(reportAlert([alert], writtenAt)).toEqual({
			name: "HighLatency",
			firing: false,
			line: `cleared at ${expectedClock}`,
		});
	});

	it("returns firing false and line ending ', after the report' when resolvedAt is after writtenAt with status still firing", () => {
		const writtenAt = "2026-10-03T14:20:00Z";
		const resolvedAt = "2026-10-03T14:40:00Z";
		const alert = {
			alertName: "HighLatency",
			status: "firing",
			triggeredAt: "2026-10-03T14:00:00Z",
			resolvedAt,
		};
		const expectedClock = formatClock(Date.parse(resolvedAt));
		expect(reportAlert([alert], writtenAt)).toEqual({
			name: "HighLatency",
			firing: false,
			line: `cleared at ${expectedClock}, after the report`,
		});
	});
});
