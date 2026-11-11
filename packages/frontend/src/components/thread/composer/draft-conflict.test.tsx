// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { QueryClient } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConflictLine } from "./chips";
import { journalKey } from "./draft-store";
import { useComposerDraft } from "./use-composer-draft";

vi.mock("@/lib/api/hooks/use-drafts-orpc", () => ({
	useServerDraft: () => ({
		data: {
			scope: "thread:test",
			rev: 5,
			generation: 0,
			text: "theirs",
			quotes: [],
			references: [],
			choice: {},
			updatedAt: "2026-11-11T10:00:00.000Z",
			attachments: [],
		},
		isPending: false,
	}),
	fetchServerDraft: async () => null,
	useSaveDraft: () => ({ mutate: vi.fn(), mutateAsync: vi.fn() }),
	useDeleteDraft: () => ({ mutate: vi.fn() }),
	useDraftAttachments: () => ({ data: undefined }),
}));

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
	window.localStorage.clear();
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
});

describe("Draft conflict UI (#1024)", () => {
	it("renders ConflictLine with Changed on another device and clicking Use theirs calls its handler", async () => {
		const onKeepMine = vi.fn();
		const onUseTheirs = vi.fn();

		await act(async () => {
			root.render(
				<ConflictLine onKeepMine={onKeepMine} onUseTheirs={onUseTheirs} />,
			);
		});

		const line = container.querySelector('[data-testid="composer-conflict"]');
		expect(line?.textContent).toContain("Changed on another device");

		const useTheirsBtn = container.querySelector(
			'[data-testid="composer-use-theirs"]',
		) as HTMLButtonElement;
		await act(async () => {
			useTheirsBtn.click();
		});

		expect(onUseTheirs).toHaveBeenCalledOnce();
		expect(onKeepMine).not.toHaveBeenCalled();
	});

	it("in useComposerDraft with server rev ahead of dirty journal base: conflict is set and useTheirs restores server draft", async () => {
		const scope = "thread:test";
		window.localStorage.setItem(
			journalKey(scope),
			JSON.stringify({
				text: "mine",
				baseRev: 3,
				generation: 0,
				dirty: true,
				files: [],
				quotes: [],
				references: [],
				at: 1,
			}),
		);

		let draftState!: ReturnType<typeof useComposerDraft>;
		const onRestore = vi.fn();
		const client = new QueryClient();

		function TestHarness() {
			draftState = useComposerDraft({
				client,
				scope,
				content: { text: "mine", quotes: [], references: [] },
				files: [],
				onRestore,
			});
			return null;
		}

		await act(async () => {
			root.render(<TestHarness />);
		});

		expect(draftState.conflict).not.toBeNull();
		expect(draftState.conflict?.theirs.text).toBe("theirs");

		await act(async () => {
			draftState.useTheirs();
		});

		expect(onRestore).toHaveBeenCalledWith(
			expect.objectContaining({ text: "theirs" }),
			[],
		);
	});
});
