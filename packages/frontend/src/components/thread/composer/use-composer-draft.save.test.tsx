// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { QueryClient } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DraftContent } from "./draft-store";
import { DRAFT_DEBOUNCE_MS, useComposerDraft } from "./use-composer-draft";

type Saved = { rev: number; generation: number };
const saves: { baseRev: number; text: string; done: (s: Saved) => void }[] = [];

let serverNow: {
	rev: number;
	generation: number;
	text: string;
	quotes: [];
	references: [];
} | null = null;

vi.mock("@/lib/api/hooks/use-drafts-orpc", () => ({
	fetchServerDraft: async () => serverNow,
	useServerDraft: () => ({ data: null, isPending: false }),
	useSaveDraft: () => ({
		mutateAsync: (body: { baseRev: number; text: string }) =>
			new Promise<Saved>((done) => {
				saves.push({ baseRev: body.baseRev, text: body.text, done });
			}),
	}),
}));

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let api: ReturnType<typeof useComposerDraft>;

const content = (text: string): DraftContent => ({
	text,
	quotes: [],
	references: [],
});

function Harness({ text }: { text: string }) {
	api = useComposerDraft({
		client: new QueryClient(),
		scope: "new:home",
		content: content(text),
		files: [],
		onRestore: () => {},
	});
	return null;
}

const show = (text: string) =>
	act(async () => {
		root.render(<Harness text={text} />);
	});
const wait = (ms: number) => act(async () => vi.advanceTimersByTime(ms));

beforeEach(() => {
	vi.useFakeTimers();
	window.localStorage.clear();
	serverNow = null;
	saves.length = 0;
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	vi.useRealTimers();
});

describe("saving a draft (#1024)", () => {
	it("starts the second save only after the first returned, from the revision it returned", async () => {
		await show("");
		await show("a");
		await wait(DRAFT_DEBOUNCE_MS);
		expect(saves.map((s) => [s.baseRev, s.text])).toEqual([[0, "a"]]);

		await show("ab");
		await wait(DRAFT_DEBOUNCE_MS);
		// The first save is still in flight: the second waits rather than reusing revision 0.
		expect(saves).toHaveLength(1);

		await act(async () => saves[0]?.done({ rev: 4, generation: 0 }));
		await wait(0);
		expect(saves.map((s) => [s.baseRev, s.text])).toEqual([
			[0, "a"],
			[4, "ab"],
		]);
		expect(api.conflict).toBeNull();
	});

	it("writes no empty draft after a send, so another device's newer text is not wiped", async () => {
		await show("");
		await show("hello");
		await wait(DRAFT_DEBOUNCE_MS);
		await act(async () => saves[0]?.done({ rev: 5, generation: 0 }));
		saves.length = 0;

		await act(async () => api.sent());
		await show("");
		await wait(DRAFT_DEBOUNCE_MS * 2);
		expect(saves).toEqual([]);

		await show("next message");
		await wait(DRAFT_DEBOUNCE_MS);
		expect(saves.map((s) => s.text)).toEqual(["next message"]);
	});

	it("after a send that kept another device's newer draft, offers it instead of saving over it", async () => {
		await show("");
		await show("hello");
		await wait(DRAFT_DEBOUNCE_MS);
		await act(async () => saves[0]?.done({ rev: 5, generation: 0 }));
		saves.length = 0;
		serverNow = {
			rev: 6,
			generation: 0,
			text: "from the laptop",
			quotes: [],
			references: [],
		};

		await act(async () => api.sent());
		await show("");
		await wait(0);
		expect(api.conflict?.theirs.text).toBe("from the laptop");

		await show("typed after");
		await wait(DRAFT_DEBOUNCE_MS * 2);
		expect(saves).toEqual([]);
	});

	it("after a send the server tombstoned, saves from the revision and generation it holds", async () => {
		await show("");
		await show("hello");
		await wait(DRAFT_DEBOUNCE_MS);
		await act(async () => saves[0]?.done({ rev: 5, generation: 0 }));
		saves.length = 0;
		serverNow = { rev: 8, generation: 3, text: "", quotes: [], references: [] };

		await act(async () => api.sent());
		await show("");
		await wait(0);
		expect(api.conflict).toBeNull();

		await show("next");
		await wait(DRAFT_DEBOUNCE_MS);
		expect(saves.map((s) => [s.baseRev, s.text])).toEqual([[8, "next"]]);
	});
});
