// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it, vi } from "vitest";
import type { MenuEntry } from "@/components/kit/Menu";
import { entryOf, runAction } from "@/components/kit/registry";
import type { DetailsCtx } from "./details.actions";
import "./details.actions";
import "./details.surface";

type Row = Exclude<MenuEntry, { separator: true }>;
const row = (e: MenuEntry | null): Row | null =>
	e && !("separator" in e) ? e : null;

function makeCtx(overrides: Partial<DetailsCtx> = {}): DetailsCtx {
	return {
		branch: "fix/a",
		host: "github",
		pr: { number: 12, repo: "owner/repo" },
		ask: vi.fn(),
		openPr: vi.fn(),
		openFolder: vi.fn(),
		openTerminal: vi.fn(),
		facts: { is: {} },
		...overrides,
	};
}

describe("details actions (#1101)", () => {
	it("returns null for each action via entryOf unless its fact is set in facts.is", () => {
		const emptyCtx = makeCtx({ facts: { is: {} } });
		expect(entryOf("details.push", emptyCtx)).toBeNull();
		expect(entryOf("details.createPr", emptyCtx)).toBeNull();
		expect(entryOf("details.fixChecks", emptyCtx)).toBeNull();
		expect(entryOf("details.resolveConflicts", emptyCtx)).toBeNull();
		expect(entryOf("details.markReady", emptyCtx)).toBeNull();
		expect(entryOf("details.viewPr", emptyCtx)).toBeNull();
		expect(entryOf("details.openFolder", emptyCtx)).toBeNull();
		expect(entryOf("details.openTerminal", emptyCtx)).toBeNull();

		expect(
			entryOf("details.push", makeCtx({ facts: { is: { push: true } } })),
		).not.toBeNull();
		expect(
			entryOf(
				"details.createPr",
				makeCtx({ facts: { is: { createPr: true } } }),
			),
		).not.toBeNull();
		expect(
			entryOf(
				"details.fixChecks",
				makeCtx({ facts: { is: { fixChecks: true } } }),
			),
		).not.toBeNull();
		expect(
			entryOf(
				"details.resolveConflicts",
				makeCtx({ facts: { is: { resolveConflicts: true } } }),
			),
		).not.toBeNull();
		expect(
			entryOf(
				"details.markReady",
				makeCtx({ facts: { is: { markReady: true } } }),
			),
		).not.toBeNull();
		expect(
			entryOf(
				"details.viewPr",
				makeCtx({ facts: { is: { viewPr: true } } }),
			),
		).not.toBeNull();
		expect(
			entryOf(
				"details.openFolder",
				makeCtx({ facts: { is: { folder: true } } }),
			),
		).not.toBeNull();
		expect(
			entryOf(
				"details.openTerminal",
				makeCtx({ facts: { is: { terminal: true } } }),
			),
		).not.toBeNull();
	});

	it("adapts action labels to code host: Create PR/MR, Fix checks/jobs, View PR/MR", () => {
		const ghCtx = makeCtx({
			host: "github",
			facts: { is: { createPr: true, fixChecks: true, viewPr: true } },
		});
		expect(row(entryOf("details.createPr", ghCtx))?.label).toBe("Create PR");
		expect(row(entryOf("details.fixChecks", ghCtx))?.label).toBe("Fix checks");
		expect(row(entryOf("details.viewPr", ghCtx))?.label).toBe("View PR");

		const glCtx = makeCtx({
			host: "gitlab",
			facts: { is: { createPr: true, fixChecks: true, viewPr: true } },
		});
		expect(row(entryOf("details.createPr", glCtx))?.label).toBe("Create MR");
		expect(row(entryOf("details.fixChecks", glCtx))?.label).toBe("Fix jobs");
		expect(row(entryOf("details.viewPr", glCtx))?.label).toBe("View MR");
	});

	it("runs details.push and calls ask once with the commit and push prompt", () => {
		const ask = vi.fn();
		const ctx = makeCtx({
			branch: "fix/a",
			ask,
			facts: { is: { push: true } },
		});
		const entry = row(entryOf("details.push", ctx));
		entry?.onSelect();
		expect(ask).toHaveBeenCalledTimes(1);
		expect(ask).toHaveBeenCalledWith(
			"Commit the finished work on `fix/a` and push it to its remote.",
		);
	});

	it("runs details.createPr and calls ask once with the create PR prompt", () => {
		const ask = vi.fn();
		const ctx = makeCtx({
			branch: "fix/a",
			host: "github",
			ask,
			facts: { is: { createPr: true } },
		});
		const entry = row(entryOf("details.createPr", ctx));
		entry?.onSelect();
		expect(ask).toHaveBeenCalledTimes(1);
		expect(ask).toHaveBeenCalledWith(
			"Push `fix/a` and open a pull request for it. Title it from the change and give me its link.",
		);
	});

	it("runs details.fixChecks and calls ask once with the fix checks prompt", () => {
		const ask = vi.fn();
		const ctx = makeCtx({
			host: "github",
			pr: { number: 12, repo: "owner/repo" },
			ask,
			facts: { is: { fixChecks: true } },
		});
		const entry = row(entryOf("details.fixChecks", ctx));
		entry?.onSelect();
		expect(ask).toHaveBeenCalledTimes(1);
		expect(ask).toHaveBeenCalledWith(
			"Checks fail on PR #12 (owner/repo). Find the cause, fix it on this branch and push.",
		);
	});

	it("runs details.resolveConflicts and calls ask once with the resolve conflicts prompt", () => {
		const ask = vi.fn();
		const ctx = makeCtx({
			branch: "fix/a",
			pr: { number: 12, repo: "owner/repo" },
			ask,
			facts: { is: { resolveConflicts: true } },
		});
		const entry = row(entryOf("details.resolveConflicts", ctx));
		entry?.onSelect();
		expect(ask).toHaveBeenCalledTimes(1);
		expect(ask).toHaveBeenCalledWith(
			"PR #12 (owner/repo) conflicts with its base. Merge the base into `fix/a`, resolve the conflicts, run the tests and push.",
		);
	});

	it("runs details.markReady and calls ask once with the mark ready prompt", () => {
		const ask = vi.fn();
		const ctx = makeCtx({
			pr: { number: 12, repo: "owner/repo" },
			ask,
			facts: { is: { markReady: true } },
		});
		const entry = row(entryOf("details.markReady", ctx));
		entry?.onSelect();
		expect(ask).toHaveBeenCalledTimes(1);
		expect(ask).toHaveBeenCalledWith("Mark PR #12 (owner/repo) ready for review.");
	});

	it("runs details.viewPr and calls openPr once", () => {
		const openPr = vi.fn();
		const ctx = makeCtx({
			openPr,
			facts: { is: { viewPr: true } },
		});
		const entry = row(entryOf("details.viewPr", ctx));
		entry?.onSelect();
		expect(openPr).toHaveBeenCalledTimes(1);
	});

	it("runs details.openFolder and calls openFolder once", () => {
		const openFolder = vi.fn();
		const ctx = makeCtx({
			openFolder,
			facts: { is: { folder: true } },
		});
		const entry = row(entryOf("details.openFolder", ctx));
		entry?.onSelect();
		expect(openFolder).toHaveBeenCalledTimes(1);
	});

	it("runs details.openTerminal and calls openTerminal once", () => {
		const openTerminal = vi.fn();
		const ctx = makeCtx({
			openTerminal,
			facts: { is: { terminal: true } },
		});
		const entry = row(entryOf("details.openTerminal", ctx));
		entry?.onSelect();
		expect(openTerminal).toHaveBeenCalledTimes(1);
	});

	it("evaluates open-in choices with when, checked, and run (#1176)", () => {
		const openIn = vi.fn();
		const ctx = makeCtx({
			openIn,
			editor: {
				current: "vscode",
				label: (e) => (e === "system" ? "Files" : e.toUpperCase()),
			},
			facts: {
				is: {
					folder: true,
					"has.vscode": true,
					"has.zed": true,
					notOwner: true,
				},
			},
		});

		const vs = row(entryOf("details.openIn.vscode", ctx));
		expect(vs?.label).toBe("VSCODE");
		expect(vs?.checked).toBe(true);
		vs?.onSelect();
		expect(openIn).toHaveBeenCalledWith("vscode");

		const zed = row(entryOf("details.openIn.zed", ctx));
		expect(zed?.label).toBe("ZED");
		expect(zed?.checked).toBe(false);

		// Cursor is not installed in facts.is
		expect(entryOf("details.openIn.cursor", ctx)).toBeNull();

		// system uses folder fact and FILES_WORD/label
		const sys = row(entryOf("details.openIn.system", ctx));
		expect(sys?.label).toBe("Files");
		expect(sys?.checked).toBe(false);

		// Non-owner row
		const ownerDef = row(entryOf("details.ownerDefault", ctx));
		expect(ownerDef?.label).toBe("Default set by the owner");
		expect(ownerDef?.disabled).toBe(true);

		// For owner, ownerDefault is not shown
		const ownerCtx = makeCtx({
			facts: { is: { folder: true, notOwner: false } },
		});
		expect(entryOf("details.ownerDefault", ownerCtx)).toBeNull();
	});

	it("runs details.branchAndPush and calls ask with branchAsk prompt (#1176)", async () => {
		const ask = vi.fn();
		const ctx = makeCtx({
			ask,
			newBranch: { name: "prismalens/fix-123456", pushable: true },
			facts: { is: { branchAndPush: true } },
		});
		const entry = row(entryOf("details.branchAndPush", ctx));
		expect(entry?.label).toBe("Create branch and push");
		entry?.onSelect();
		await vi.waitFor(() => expect(ask).toHaveBeenCalledTimes(1));
		expect(ask).toHaveBeenCalledWith(
			"Create the branch `prismalens/fix-123456` at HEAD with `git switch -c prismalens/fix-123456`, commit anything uncommitted, then push it with `git push -u origin prismalens/fix-123456`.",
		);

		const noPushCtx = makeCtx({
			ask,
			newBranch: { name: "prismalens/fix-123456", pushable: false },
			facts: { is: { branchAndPush: true } },
		});
		const noPushEntry = row(entryOf("details.branchAndPush", noPushCtx));
		expect(noPushEntry?.label).toBe("Create branch");
	});
});
