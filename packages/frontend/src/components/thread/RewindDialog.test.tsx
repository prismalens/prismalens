// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type {
	RewindPreview,
	RewindRestorePreview,
} from "@prismalens/contracts";
import type { QueryClient } from "@tanstack/react-query";
import { act, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { type ApiRequest, renderWithApp } from "@/test/render";
import { RewindDialog } from "./RewindDialog";

// The dialog's body and buttons, without the portal: what these tests drive is the confirm.
vi.mock("@/components/shared/DestructiveConfirm", () => ({
	DestructiveConfirm: (p: {
		description: ReactNode;
		children?: ReactNode;
		error?: string | null;
		isLoading?: boolean;
		confirmLabel: string;
		onConfirm: () => unknown;
	}) => (
		<div>
			{p.description}
			{p.children}
			{p.error && <p data-testid="confirm-error">{p.error}</p>}
			<button
				type="button"
				data-testid="confirm-action"
				disabled={p.isLoading}
				onClick={() => void Promise.resolve(p.onConfirm()).catch(() => {})}
			>
				{p.confirmLabel}
			</button>
		</div>
	),
}));

const ID = "11111111-1111-1111-1111-111111111111";
const OP = "22222222-2222-2222-2222-222222222222";
const REWIND = "33333333-3333-3333-3333-333333333333";

const q = (testid: string) =>
	document.body.querySelector<HTMLElement>(`[data-testid="${testid}"]`);
const click = (el: Element | null) =>
	act(async () => {
		if (!el) throw new Error("nothing to click");
		(el as HTMLElement).click();
	});
/** A live refresh: the refetch lands and the dialog renders with it. */
const refetch = (app: { queryClient: QueryClient }) =>
	act(async () => {
		await app.queryClient.refetchQueries();
		await new Promise((r) => setTimeout(r, 0));
	});
/** The procedure's input: its `id` rides in the path. */
const input = (req: ApiRequest) => ({
	id: req.params.id,
	...(req.body as object),
});

function editPreview(tree: string, duringTurn: string[]): RewindPreview {
	return {
		seq: 3,
		messageOrdinal: 7,
		revision: 12,
		block: null,
		turns: 1,
		repos: [
			{
				repo: "app",
				state: "ok",
				head: "h1",
				tree,
				revert: [{ path: "src/a.ts", status: "modified" }],
				duringTurn,
				kept: [],
				commits: 0,
			},
		],
		stays: [],
		session: { via: "fork", why: null },
	};
}

function restorePreview(
	tree: string,
	damaged: string[],
	created: string[],
): RewindRestorePreview {
	return {
		op: OP,
		repo: "app",
		block: null,
		overwrite: ["src/a.ts"],
		created,
		damaged,
		head: "h1",
		tree,
		backup: "b1",
		now: "n1",
	};
}

describe("RewindDialog binds a confirm to the preview the user saw (#1193)", () => {
	it("an edit confirmed after a refetch sends the seen preview's tree and only the during-turn paths it showed, and says the list changed", async () => {
		let preview = editPreview("t1", ["notes.md"]);
		const sent: unknown[] = [];
		const app = await renderWithApp(
			<RewindDialog
				threadId={ID}
				target={{ mode: "edit", seq: 3, text: "Use port 8080" }}
				onClose={() => {}}
				onKept={() => {}}
			/>,
			{
				api: {
					"threads.rewindPreview": () => preview,
					"threads.rewind": (req: ApiRequest) => {
						sent.push(input(req));
						return {
							state: "refused",
							reason: "stale",
							paths: [],
						};
					},
				},
			},
		);
		await vi.waitFor(() => expect(q("rewind-during-include")).not.toBeNull());
		await click(q("rewind-during-include"));
		preview = editPreview("t2", ["notes.md", "secrets.env"]);
		await refetch(app);

		await click(q("confirm-action"));
		await vi.waitFor(() => expect(sent).toHaveLength(1));
		expect(sent[0]).toEqual({
			id: ID,
			seq: 3,
			text: "Use port 8080",
			expect: {
				messageOrdinal: 7,
				revision: 12,
				repos: { app: { head: "h1", tree: "t1" } },
			},
			include: [{ repo: "app", path: "notes.md" }],
		});
		expect(q("rewind-changed")?.textContent).toBe(
			"The thread or its files changed since this was shown. Show what it would do now",
		);
	});

	it("a restore confirmed after a refetch sends the seen preview's tree with the paths ticked on it", async () => {
		let preview = restorePreview("t1", ["src/b.ts"], []);
		const sent: unknown[] = [];
		const app = await renderWithApp(
			<RewindDialog
				threadId={ID}
				target={{ mode: "restore", op: OP }}
				onClose={() => {}}
				onKept={() => {}}
			/>,
			{
				api: {
					"threads.rewindRestorePreview": () => preview,
					"threads.rewindRestore": (req: ApiRequest) => {
						sent.push(input(req));
						return { state: "refused", reason: "stale", paths: [] };
					},
				},
			},
		);
		const box = () =>
			document.body.querySelector<HTMLElement>(
				'[aria-label="Restore src/b.ts too"]',
			);
		await vi.waitFor(() => expect(box()).not.toBeNull());
		await click(box());
		preview = restorePreview("t2", ["src/b.ts"], ["src/c.ts"]);
		await refetch(app);

		await click(q("confirm-action"));
		await vi.waitFor(() => expect(sent).toHaveLength(1));
		expect(sent[0]).toEqual({
			id: ID,
			op: OP,
			expect: { head: "h1", tree: "t1" },
			include: ["src/b.ts"],
		});
	});

	it("a restore's ticks clear when the user takes the changed preview, and its confirm binds to that preview", async () => {
		let preview = restorePreview("t1", ["src/b.ts"], []);
		const sent: unknown[] = [];
		const app = await renderWithApp(
			<RewindDialog
				threadId={ID}
				target={{ mode: "restore", op: OP }}
				onClose={() => {}}
				onKept={() => {}}
			/>,
			{
				api: {
					"threads.rewindRestorePreview": () => preview,
					"threads.rewindRestore": (req: ApiRequest) => {
						sent.push(input(req));
						return { state: "done", restored: [], kept: [] };
					},
				},
			},
		);
		const box = () =>
			document.body.querySelector<HTMLElement>(
				'[aria-label="Restore src/b.ts too"]',
			);
		await vi.waitFor(() => expect(box()).not.toBeNull());
		await click(box());
		expect(box()?.getAttribute("data-state")).toBe("checked");
		preview = restorePreview("t2", ["src/b.ts"], ["src/c.ts"]);
		await refetch(app);
		await click(q("rewind-changed-show"));

		expect(box()?.getAttribute("data-state")).toBe("unchecked");
		expect(q("rewind-changed")).toBeNull();
		await click(q("confirm-action"));
		await vi.waitFor(() => expect(sent).toHaveLength(1));
		expect(sent[0]).toEqual({
			id: ID,
			op: OP,
			expect: { head: "h1", tree: "t2" },
			include: [],
		});
	});

	it("a rewind that ran but was not sent hands its text and why to the page", async () => {
		const onKept = vi.fn();
		await renderWithApp(
			<RewindDialog
				threadId={ID}
				target={{ mode: "edit", seq: 3, text: "Use port 8080" }}
				onClose={() => {}}
				onKept={onKept}
			/>,
			{
				api: {
					"threads.rewindPreview": () => editPreview("t1", []),
					"threads.rewind": {
						state: "done",
						rewindId: REWIND,
						reverted: [],
						kept: [],
						sent: false,
						why: "The agent is out of credit.",
					},
					"investigations.get": null,
					"investigations.getChanges": null,
				},
			},
		);
		await vi.waitFor(() =>
			expect(q("confirm-action")?.hasAttribute("disabled")).toBe(false),
		);
		await click(q("confirm-action"));
		await vi.waitFor(() => expect(onKept).toHaveBeenCalledTimes(1));
		expect(onKept).toHaveBeenCalledWith({
			text: "Use port 8080",
			why: "The agent is out of credit.",
		});
	});

	it("lists a file kept for a link in its path by its count and reason, not as yours", async () => {
		const preview = editPreview("t1", []);
		const repo = preview.repos[0];
		if (repo?.state !== "ok") throw new Error("the fixture's repo is ok");
		repo.kept = [{ path: "vendor/lib.ts", why: "linked" }];
		await renderWithApp(
			<RewindDialog
				threadId={ID}
				target={{ mode: "edit", seq: 3, text: "Use port 8080" }}
				onClose={() => {}}
				onKept={() => {}}
			/>,
			{ api: { "threads.rewindPreview": preview } },
		);
		await vi.waitFor(() =>
			expect(q("rewind-kept")?.textContent).toBe(
				"Keeps 1 file: vendor/lib.ts (a link is in its path)",
			),
		);
	});
});
