// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { textDoc } from "@prismalens/contracts";
import { QueryClient } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConflictLine } from "./chips";
import { draftUseTheirs } from "./draft.actions";
import { draftConflict } from "./draft.surface";
import type { DraftContent } from "./draft-store";
import { journalKey } from "./draft-store";
import { useComposerDraft } from "./use-composer-draft";

function TestHarness(props: {
	client: QueryClient;
	scope: string;
	onRestore: Parameters<typeof useComposerDraft>[0]["onRestore"];
	onState: (s: ReturnType<typeof useComposerDraft>) => void;
}) {
	const state = useComposerDraft({
		client: props.client,
		scope: props.scope,
		content: { doc: textDoc("mine") },
		files: [],
		onRestore: props.onRestore,
	});
	props.onState(state);
	return null;
}

vi.mock("@/lib/api/hooks/use-drafts-orpc", () => ({
	useServerDraft: () => ({
		data: {
			scope: "thread:test",
			rev: 5,
			generation: 0,
			version: 2,
			doc: textDoc("theirs"),
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
	// 967de6276 clarifies conflict wording to "Draft edited on another device".
	it("renders ConflictLine with Draft edited on another device, one Choose, and Use theirs from its menu calls its handler", async () => {
		const onKeepMine = vi.fn();
		const onUseTheirs = vi.fn();

		await act(async () => {
			root.render(
				<ConflictLine onKeepMine={onKeepMine} onUseTheirs={onUseTheirs} />,
			);
		});

		const line = container.querySelector('[data-testid="composer-conflict"]');
		expect(line?.textContent).toContain("Draft edited on another device");

		// The conflict line's two buttons became one Choose with both copies in its menu (#1101 budget).
		expect(
			Array.from(line?.querySelectorAll("button") ?? [], (b) =>
				b.getAttribute("data-testid"),
			),
		).toEqual(["composer-conflict-choose"]);
		expect(draftConflict.menus.more).toEqual([
			"draft.keepMine",
			"draft.useTheirs",
		]);
		draftUseTheirs.run({
			keepMine: onKeepMine,
			useTheirs: onUseTheirs,
			facts: {},
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

		await act(async () => {
			root.render(
				<TestHarness
					client={client}
					scope={scope}
					onRestore={onRestore}
					onState={(s) => {
						draftState = s;
					}}
				/>,
			);
		});

		expect(draftState.conflict).not.toBeNull();
		expect(draftState.conflict?.theirs.text).toBe("theirs");

		await act(async () => {
			draftState.useTheirs();
		});

		expect(onRestore).toHaveBeenCalledWith({ doc: textDoc("theirs") }, []);
	});
});
