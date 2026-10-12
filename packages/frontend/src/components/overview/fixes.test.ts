// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { Fixes } from "@prismalens/contracts";
import { describe, expect, it } from "vitest";
import {
	commandOf,
	failedStrip,
	type FixOption,
	fixStage,
	liveCheck,
	nextStrip,
	noteOf,
	splitOptions,
} from "./fixes";

const opt: FixOption = {
	id: "a",
	index: 0,
	kind: "stop-impact",
	title: "Roll back booklogr-api to v1.41",
	detail: "Undo deploy v1.42",
	command: "kubectl rollout undo deployment/booklogr-api",
	facts: [],
	priority: "high",
	readOnly: false,
	appliedAt: null,
	lastCheck: null,
	canUndo: false,
};

const base = {
	ended: false,
	cleared: false,
	runs: 1,
	live: null,
	failed: null,
	reported: true,
	option: opt,
	checkable: true,
	hasNextOption: true,
};

const firing = [{ status: "triggered", resolvedAt: null }];

describe("splitOptions", () => {
	it("keeps stop-impact options in rank order, at most three, and the lasting fix", () => {
		const o = (index: number, kind: FixOption["kind"]) => ({ ...opt, id: String(index), index, kind });
		const fixes: Fixes = {
			investigationId: "r",
			flagged: false,
			options: [o(4, "stop-impact"), o(0, "probe"), o(1, "stop-impact"), o(2, "lasting"), o(3, "stop-impact"), o(5, "stop-impact")],
		};
		const r = splitOptions(fixes);
		expect(r.stop.map((s) => s.id)).toEqual(["1", "3", "4"]);
		expect(r.lasting?.id).toBe("2");
		expect(splitOptions(undefined)).toEqual({ stop: [], lasting: null });
	});
});

describe("fixStage", () => {
	it("is ready until applied, then applied, then checked", () => {
		const input = {
			option: opt,
			copied: true,
			checking: false,
			check: null,
			alerts: firing,
		};
		expect(fixStage(input)).toMatchObject({ stage: "ready", copied: true });
		const applied = {
			...input,
			option: { ...opt, appliedAt: "2026-10-11T12:20:00Z" },
		};
		expect(fixStage(applied).stage).toBe("applied");
		expect(
			fixStage({
				...applied,
				check: { verdict: "not_yet", at: "2026-10-11T12:23:00Z" },
			}).stage,
		).toBe("checked");
		// After a reload the option's own last check stands.
		expect(
			fixStage({
				...applied,
				option: {
					...applied.option,
					lastCheck: { verdict: "it_worked", at: "2026-10-11T12:30:00Z" },
				},
			}).stage,
		).toBe("worked");
		// A check from before the option was applied again does not count.
		expect(
			fixStage({
				...applied,
				check: { verdict: "not_yet", at: "2026-10-11T12:10:00Z" },
			}).stage,
		).toBe("applied");
	});

	it("worked only when every alert cleared after it was applied", () => {
		const applied = {
			option: { ...opt, appliedAt: "2026-10-11T12:20:00Z" },
			copied: false,
			checking: false,
			check: null,
		};
		expect(
			fixStage({
				...applied,
				alerts: [{ status: "resolved", resolvedAt: "2026-10-11T12:31:00Z" }],
			}),
		).toMatchObject({ stage: "worked", clearedAt: "2026-10-11T12:31:00Z" });
		expect(
			fixStage({
				...applied,
				alerts: [{ status: "resolved", resolvedAt: "2026-10-11T12:00:00Z" }],
			}).stage,
		).toBe("applied");
	});
});

describe("a sentence where the command goes (#673 w8-15)", () => {
	// Walk 8, Run 4: "Hold off on rolling back 8a99430" carried this as its command.
	const hold = { ...opt, title: "Hold off on rolling back 8a99430", command: "None confirmed on current evidence." };

	it("reads it as text, not a command", () => {
		expect(commandOf(hold)).toBeNull();
		expect(noteOf(hold)).toBe("None confirmed on current evidence.");
		expect(commandOf({ command: "Restart the api pod" })).toBeNull();
		for (const command of [
			"kubectl rollout undo deployment/booklogr-api",
			"Restart-Service booklogr",
			"SELECT pg_cancel_backend(42);",
			"git revert 8a99430\ngit push",
		]) {
			expect(commandOf({ command })).toBe(command);
			expect(noteOf({ command })).toBeNull();
		}
	});

	it("offers no Copy and no I applied it on the Next strip", () => {
		const s = nextStrip({ ...base, option: hold, stage: { stage: "ready", copied: false, copyFailed: false } });
		expect(s.text).toBe("Hold off on rolling back 8a99430. There is nothing to run; the reason is under Stop the impact.");
		expect(s.primary).toBeUndefined();
		expect(s.secondary).toBeUndefined();
	});
});

describe("nextStrip", () => {
	it("says a live run waits for your approval, with no other action (#673 w5-14)", () => {
		const strip = nextStrip({
			ended: false,
			cleared: false,
			runs: 1,
			live: { name: "Run 2", waiting: true },
			failed: null,
			reported: false,
			option: null,
			stage: null,
			checkable: false,
			hasNextOption: false,
		});
		expect(strip).toMatchObject({
			tone: "warn",
			text: "Run 2 waits for your approval. Approve or deny it in the box below.",
		});
		expect(strip.primary).toBeUndefined();
	});

	it("walks copy, I applied it, Check now", () => {
		const ready = nextStrip({
			...base,
			stage: { stage: "ready", copied: false, copyFailed: false },
		});
		expect(ready.primary?.id).toBe("copy");
		const copied = nextStrip({
			...base,
			stage: { stage: "ready", copied: true, copyFailed: false },
		});
		expect(copied.primary?.id).toBe("applied");
		expect(copied.secondary?.id).toBe("copy");
		const applied = nextStrip({
			...base,
			stage: { stage: "applied", appliedAt: "2026-10-11T12:20:00Z" },
		});
		expect(applied.primary?.id).toBe("check");
	});

	it("says so when the clipboard was blocked and the command is selected", () => {
		const s = nextStrip({
			...base,
			stage: { stage: "ready", copied: false, copyFailed: true },
		});
		expect(s.text).toMatch(/blocked the clipboard/);
		expect(s.primary?.id).toBe("applied");
	});

	it("never offers I applied it on an old report's option", () => {
		const s = nextStrip({
			...base,
			option: { ...opt, id: null, readOnly: true },
			stage: { stage: "ready", copied: true, copyFailed: false },
		});
		expect(s.primary?.id).toBe("copy");
	});

	it("offers no check when nothing can check the alert", () => {
		const s = nextStrip({
			...base,
			checkable: false,
			stage: { stage: "applied", appliedAt: "2026-10-11T12:20:00Z" },
		});
		expect(s.primary).toBeUndefined();
		expect(s.text).toMatch(/clears on its own/);
	});

	it("words each verdict; It worked only from the alert clearing", () => {
		const at = "2026-10-11T12:20:00Z";
		const notYet = nextStrip({
			...base,
			stage: {
				stage: "checked",
				appliedAt: at,
				check: { verdict: "not_yet", at: "2026-10-11T12:23:00Z", value: 2.1 },
			},
		});
		expect(notYet.text).toMatch(/^Not yet: 2.1 at .*, 3 minutes after/);
		const inSeconds = nextStrip({
			...base,
			unit: "s",
			stage: {
				stage: "checked",
				appliedAt: at,
				check: { verdict: "not_yet", at: "2026-10-11T12:23:00Z", value: 0.31 },
			},
		});
		expect(inSeconds.text).toMatch(/^Not yet: 310ms at /);
		expect(notYet.secondary?.id).toBe("next-option");
		const below = nextStrip({
			...base,
			stage: {
				stage: "checked",
				appliedAt: at,
				check: { verdict: "below_threshold", at, value: 0.5 },
			},
		});
		expect(below.text).toMatch(/^Below the alert threshold: 0.5 at/);
		const unsupported = nextStrip({
			...base,
			stage: {
				stage: "checked",
				appliedAt: at,
				check: { verdict: "could_not_check", at, retryable: false },
			},
		});
		expect(unsupported.text).toBe(
			"Could not check; the alert clears on its own once its rule sees the recovery.",
		);
		expect(unsupported.primary).toBeUndefined();
		const worked = nextStrip({
			...base,
			stage: { stage: "worked", appliedAt: at, clearedAt: at },
		});
		expect(worked.primary?.id).toBe("resolve");
	});

	it("reads a live check the same as the verdict a reload keeps", () => {
		const appliedAt = "2026-10-11T12:20:00Z";
		const at = "2026-10-11T12:23:00Z";
		for (const verdict of ["not_yet", "below_threshold"] as const) {
			const strip = (check: Parameters<typeof liveCheck>[0] | null) =>
				nextStrip({
					...base,
					stage: {
						stage: "checked",
						appliedAt,
						check: check ? liveCheck(check) : { verdict, at },
					},
				}).text;
			const live = strip({
				stepId: "00000000-0000-4000-8000-000000000001",
				verdict,
				checkedAt: at,
				value: null,
				threshold: null,
				reason: null,
				message: verdict === "not_yet" ? "Not yet." : "Below the alert threshold.",
				retryable: false,
			});
			expect(live).toBe(strip(null));
			expect(live).not.toMatch(/^(Not yet|Below the alert threshold)\.$/);
		}
	});

	it("keeps the no-retry wording after a reload (#673 w7-8)", () => {
		const appliedAt = "2026-10-11T12:20:00Z";
		const at = "2026-10-11T12:22:00Z";
		const saved = (lastCheck: FixOption["lastCheck"], checkable: boolean) =>
			nextStrip({
				...base,
				checkable,
				stage: fixStage({
					option: { appliedAt, lastCheck },
					copied: false,
					alerts: firing,
					checking: false,
					check: null,
				}),
			});
		const noRetry =
			"Could not check; the alert clears on its own once its rule sees the recovery.";
		const kept = saved({ verdict: "could_not_check", at, retryable: false }, true);
		expect(kept.text).toBe(noRetry);
		expect(kept.primary).toBeUndefined();
		const older = saved({ verdict: "could_not_check", at }, false);
		expect(older.text).toBe(noRetry);
		expect(older.primary).toBeUndefined();
		const timedOut = saved({ verdict: "could_not_check", at }, true);
		expect(timedOut.primary).toEqual({ id: "check", label: "Try again" });
	});

	it("links the incident a Resolved one fired again as, else says it will", () => {
		const resolved = { ...base, ended: true, option: null, stage: null };
		expect(nextStrip(resolved).link).toBeUndefined();
		expect(nextStrip(resolved).text).toMatch(/links it here/);
		const refired = nextStrip({
			...resolved,
			refiredAs: { id: "00000000-0000-4000-8000-000000000011", number: 11 },
		});
		expect(refired.text).toBe("Resolved.");
		expect(refired.link).toEqual({
			incidentId: "00000000-0000-4000-8000-000000000011",
			label: "Fired again as INC-11",
		});
	});

	it("names a merged incident's survivor and never calls it Resolved (#673 w5-17)", () => {
		const merged = nextStrip({
			...base,
			ended: true,
			option: null,
			stage: null,
			mergedInto: { id: "00000000-0000-4000-8000-000000000004", number: 4 },
		});
		expect(merged.text).toBe("Merged into");
		expect(merged.link).toEqual({
			incidentId: "00000000-0000-4000-8000-000000000004",
			label: "INC-4",
		});
		expect(merged.primary).toBeUndefined();
	});

	it("Alerts cleared offers Resolve and does not say Resolved (#673 w5-28)", () => {
		const cleared = nextStrip({
			...base,
			ended: false,
			cleared: true,
			option: null,
			stage: null,
		});
		expect(cleared.text).not.toMatch(/^Resolved/);
		expect(cleared.primary?.id).toBe("resolve");
	});

	it("Alerts cleared wins over an unapplied fix and keeps the refire link", () => {
		const stored = nextStrip({
			...base,
			ended: false,
			cleared: true,
			alertsCleared: true,
			stage: { stage: "ready", copied: false, copyFailed: false },
			refiredAs: { id: "00000000-0000-4000-8000-000000000009", number: 9 },
		});
		expect(stored.primary?.id).toBe("resolve");
		expect(stored.text).not.toMatch(/comes back/);
		expect(stored.link?.label).toBe("Fired again as INC-9");
		const plain = nextStrip({ ...base, stage: null, cleared: true, alertsCleared: true });
		expect(plain.text).toMatch(/^Every alert has cleared/);
	});

	it("falls back to the run when there is no option", () => {
		const none = { ...base, option: null, stage: null };
		expect(nextStrip({ ...none, runs: 0, reported: false }).primary?.id).toBe(
			"investigate",
		);
		expect(
			nextStrip({
				...none,
				reported: false,
				failed: { name: "Run 2", reason: "Rate limited." },
			}).primary?.id,
		).toBe("retry");
		// A known fix comes first, in the same words as the agent picker (#831 v5-39).
		expect(failedStrip("Run 2", "Rate limited (429)", "Codex")).toEqual({
			name: "Run 2",
			reason: "The model provider limited the request rate.",
		});
		expect(
			nextStrip({
				...none,
				reported: false,
				failed: failedStrip("Run 2", "Authentication required", "Codex"),
			}).text,
		).toBe(
			"Run 2 stopped before a finding. Codex is not signed in to its model provider. Sign in with its own CLI, then retry.",
		);
		expect(nextStrip({ ...none, live: { name: "Run 3" } }).primary?.id).toBe(
			"watch",
		);
		expect(nextStrip(none).text).toMatch(/nothing to undo/);
		expect(nextStrip({ ...none, cleared: true }).primary?.id).toBe("resolve");
	});
});
