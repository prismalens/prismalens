// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	type ComposerDoc,
	type ComposerDraft,
	textDoc,
} from "@prismalens/contracts";
import { QueryClient } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DraftContent } from "./draft-store";
import { DRAFT_DEBOUNCE_MS, useComposerDraft } from "./use-composer-draft";

type Saved = { rev: number; generation: number };
type SaveCall = {
	baseRev: number;
	text: string;
	draftKey?: string | null;
	attachments?: string[];
	done: (s: Saved) => void;
};
const saves: SaveCall[] = [];

let serverNow: ComposerDraft | null = null;
/** How `sent()` reads the server back; a test can hold it to make the read land late. */
let serverRead: () => Promise<ComposerDraft | null> = async () => serverNow;

vi.mock("@/lib/api/hooks/use-drafts-orpc", () => ({
	fetchServerDraft: () => serverRead(),
	useServerDraft: () => ({ data: null, isPending: false }),
	useSaveDraft: () => ({
		mutateAsync: (body: {
			baseRev: number;
			text: string;
			draftKey?: string | null;
			attachments?: string[];
		}) =>
			new Promise<Saved>((done) => {
				saves.push({
					baseRev: body.baseRev,
					text: body.text,
					draftKey: body.draftKey,
					attachments: body.attachments,
					done,
				});
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
	doc: textDoc(text),
});

function Harness({
	text,
	draftContent,
}: {
	text?: string;
	draftContent?: DraftContent;
}) {
	api = useComposerDraft({
		client: new QueryClient(),
		scope: "new:home",
		content: draftContent ?? content(text ?? ""),
		files: [],
		onRestore: () => {},
	});
	return null;
}

const show = (target: string | DraftContent) =>
	act(async () => {
		if (typeof target === "string") {
			root.render(<Harness text={target} />);
		} else {
			root.render(<Harness draftContent={target} />);
		}
	});
const wait = (ms: number) => act(async () => vi.advanceTimersByTime(ms));

beforeEach(() => {
	vi.useFakeTimers();
	window.localStorage.clear();
	serverNow = null;
	serverRead = async () => serverNow;
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

	it("a send waits for the save in flight and carries the revision it returned", async () => {
		await show("");
		await show("plain chat");
		await wait(DRAFT_DEBOUNCE_MS);
		expect(saves.map((s) => [s.baseRev, s.text])).toEqual([[0, "plain chat"]]);

		let fields: Awaited<ReturnType<typeof api.sendFields>> | null = null;
		const reading = act(async () => {
			fields = await api.sendFields();
		});
		await act(async () => saves[0]?.done({ rev: 3, generation: 0 }));
		await reading;
		expect(fields).toEqual({ draftScope: "new:home", draftRev: 3 });
	});

	it("sends no save while a send is out, so the sent text never comes back as a draft", async () => {
		await show("");
		await show("plain chat");
		await wait(DRAFT_DEBOUNCE_MS);
		await act(async () => saves[0]?.done({ rev: 2, generation: 0 }));
		saves.length = 0;

		await show("plain chat, edited");
		await act(async () => {
			await api.sendFields();
		});
		await wait(DRAFT_DEBOUNCE_MS * 2);
		expect(saves).toEqual([]);

		await act(async () => api.sent());
		await show("");
		await wait(DRAFT_DEBOUNCE_MS * 2);
		expect(saves).toEqual([]);
	});

	it("after a send that failed, saves the text it left in the box", async () => {
		await show("");
		await show("kept text");
		await wait(DRAFT_DEBOUNCE_MS);
		await act(async () => saves[0]?.done({ rev: 2, generation: 0 }));
		saves.length = 0;

		await act(async () => {
			await api.sendFields();
		});
		await act(async () => api.release());
		await wait(0);
		expect(saves.map((s) => [s.baseRev, s.text])).toEqual([[2, "kept text"]]);
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
			version: 2,
			doc: textDoc("from the laptop"),
			text: "from the laptop",
			quotes: [],
			references: [],
			choice: {},
			attachments: [],
			draftKey: null,
			scope: "new:home",
			updatedAt: "2026-11-11T10:00:00.000Z",
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
		serverNow = {
			rev: 8,
			generation: 3,
			version: 2,
			doc: textDoc(""),
			text: "",
			quotes: [],
			references: [],
			choice: {},
			attachments: [],
			draftKey: null,
			scope: "new:home",
			updatedAt: "2026-11-11T10:00:00.000Z",
		};

		await act(async () => api.sent());
		await show("");
		await wait(0);
		expect(api.conflict).toBeNull();

		await show("next");
		await wait(DRAFT_DEBOUNCE_MS);
		expect(saves.map((s) => [s.baseRev, s.text])).toEqual([[8, "next"]]);
	});

	it("after a send the page answered itself (an aside), empties the kept draft from its revision and raises no conflict", async () => {
		await show("");
		await show("/btw why");
		await wait(DRAFT_DEBOUNCE_MS);
		await act(async () => saves[0]?.done({ rev: 5, generation: 0 }));
		saves.length = 0;
		// No server send happened, so the server still holds the draft as it was.
		serverNow = {
			rev: 5,
			generation: 0,
			version: 2,
			doc: textDoc("/btw why"),
			text: "/btw why",
			quotes: [],
			references: [],
			choice: {},
			attachments: [],
			draftKey: null,
			scope: "new:home",
			updatedAt: "2026-11-11T10:00:00.000Z",
		};

		await show("");
		await act(async () => api.sent());
		await wait(0);
		expect(saves.map((s) => [s.baseRev, s.text])).toEqual([[5, ""]]);
		expect(api.conflict).toBeNull();
	});

	it("a server read that lands after a newer save does not roll the revision back", async () => {
		await show("");
		await show("hello");
		await wait(DRAFT_DEBOUNCE_MS);
		await act(async () => saves[0]?.done({ rev: 5, generation: 0 }));
		saves.length = 0;
		let answer: (d: ComposerDraft | null) => void = () => {};
		serverRead = () =>
			new Promise((r) => {
				answer = r;
			});

		await show("");
		await act(async () => api.sent());
		// The user types and that save lands before the read of the server returns.
		await show("next");
		await wait(DRAFT_DEBOUNCE_MS);
		await act(async () => saves[0]?.done({ rev: 7, generation: 1 }));
		await act(async () =>
			answer({
				rev: 6,
				generation: 1,
				version: 2,
				doc: textDoc(""),
				text: "",
				quotes: [],
				references: [],
				choice: {},
				attachments: [],
				draftKey: null,
				scope: "new:home",
				updatedAt: "2026-11-11T10:00:00.000Z",
			}),
		);
		await show("next two");
		await wait(DRAFT_DEBOUNCE_MS);
		expect(saves.map((s) => [s.baseRev, s.text])).toEqual([
			[6, "next"],
			[7, "next two"],
		]);
		expect(api.conflict).toBeNull();
	});

	it("the PUT body carries draftKey and exactly the uploaded ids", async () => {
		const docWithChips: ComposerDoc = {
			type: "doc",
			content: [
				{
					type: "paragraph",
					content: [
						{ type: "text", text: "report with files " },
						{
							type: "chip",
							attrs: {
								chip: "file",
								key: "k1",
								name: "uploaded.log",
								type: "text/plain",
								size: 100,
								id: "11111111-1111-4111-8111-000000000001",
							},
						},
						{ type: "text", text: " " },
						{
							type: "chip",
							attrs: {
								chip: "file",
								key: "k2",
								name: "pending.log",
								type: "text/plain",
								size: 200,
							},
						},
						{ type: "text", text: " " },
						{
							type: "chip",
							attrs: {
								chip: "file",
								key: "k3",
								name: "refused.log",
								type: "text/plain",
								size: 300,
								id: "11111111-1111-4111-8111-000000000002",
								refusal: "File too large",
							},
						},
						{ type: "text", text: " " },
						{
							type: "chip",
							attrs: {
								chip: "file",
								key: "k4",
								name: "uploaded2.png",
								type: "image/png",
								size: 400,
								id: "11111111-1111-4111-8111-000000000003",
							},
						},
					],
				},
			],
		};

		await show("");
		await show({
			doc: docWithChips,
			draftKey: "0b3c2f1e-1111-4222-8333-444455556666",
		});
		await wait(DRAFT_DEBOUNCE_MS);

		expect(saves).toHaveLength(1);
		expect(saves[0]?.draftKey).toBe("0b3c2f1e-1111-4222-8333-444455556666");
		expect(saves[0]?.attachments).toEqual([
			"11111111-1111-4111-8111-000000000001",
			"11111111-1111-4111-8111-000000000003",
		]);
	});
});
