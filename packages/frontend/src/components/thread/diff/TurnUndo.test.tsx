// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type {
	RevertChangesResult,
	WorktreeChanges,
} from "@prismalens/contracts";
import { act, type ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithApp } from "@/test/render";
import { TurnUndo } from "./TurnUndo";

type Shown = {
	title: string;
	description?: string;
	variant?: string;
	action?: ReactElement<{ altText: string }>;
};
const shown = vi.hoisted(() => [] as Shown[]);
vi.mock("@/hooks/use-toast", () => ({
	useToast: () => ({ toast: (t: Shown) => shown.push(t) }),
}));

const SHA = "a".repeat(40);
const changes: WorktreeChanges = {
	repos: [
		{
			state: "ok",
			repo: "repo",
			base: SHA,
			branch: null,
			files: [
				{ path: "a.txt", status: "modified", additions: 1, deletions: 1 },
				{ path: "f.txt", status: "modified", additions: 1, deletions: 1 },
			],
			additions: 2,
			deletions: 2,
			patch: null,
			omitted: "per-file",
			truncated: false,
			scoped: {
				scope: "turn",
				from: SHA,
				to: SHA,
				turn: 4,
				live: false,
				states: {},
				outside: [],
				skipped: [],
				turns: [{ seq: 4, ended: true }],
				revert: null,
				interrupted: [],
			},
		},
	],
};

const undoTurn = async (answer: RevertChangesResult) => {
	const app = await renderWithApp(<TurnUndo runId="run-1" turnId={4} />, {
		api: {
			"investigations.getChanges": changes,
			"investigations.revertChanges": answer,
		},
	});
	await vi.waitFor(() =>
		expect(
			app.container.querySelector('[data-testid="turn-undo"]'),
		).not.toBeNull(),
	);
	await act(async () =>
		app.container
			.querySelector<HTMLButtonElement>('[data-testid="turn-undo"]')
			?.click(),
	);
	await act(async () =>
		document
			.querySelector<HTMLButtonElement>(
				'[data-testid="turn-undo-confirm-action"]',
			)
			?.click(),
	);
	await vi.waitFor(() => expect(shown).toHaveLength(1));
	return shown[0] as Shown;
};

beforeEach(() => {
	shown.length = 0;
});

describe("TurnUndo's answer (#1193)", () => {
	it("an undo that wrote nothing says the turn was not undone, names each kept path with its reason, and offers no Redo", async () => {
		const t = await undoTurn({
			state: "done",
			revertId: "r1",
			paths: [],
			kept: [{ path: "f.txt", why: "filtered" }],
		});

		expect(t).toEqual({
			title: "Turn not undone",
			description:
				"Left as you saved them: f.txt (its git attributes run a filter).",
			variant: "destructive",
		});
	});

	it("an undo that wrote some files says how many, names the kept ones, and offers Redo", async () => {
		const t = await undoTurn({
			state: "done",
			revertId: "r1",
			paths: ["a.txt"],
			kept: [{ path: "f.txt", why: "changed-while-rewinding" }],
		});

		expect({ ...t, action: t.action?.props.altText }).toEqual({
			title: "Undid the turn's 1 file",
			description:
				"Left as you saved them: f.txt (it changed while being written).",
			action: "Redo the turn's changes",
		});
	});

	it("an answer from a server that sends no kept list reads as none kept", async () => {
		const t = await undoTurn({
			state: "done",
			revertId: "r1",
			paths: ["a.txt"],
		} as RevertChangesResult);

		expect({ ...t, action: t.action?.props.altText }).toEqual({
			title: "Undid the turn's 1 file",
			action: "Redo the turn's changes",
		});
	});
});
