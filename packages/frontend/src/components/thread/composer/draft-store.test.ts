// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { type ComposerDraft, textDoc } from "@prismalens/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	type Journal,
	journalKey,
	KEEPALIVE_MAX_BYTES,
	keepaliveSave,
	readJournal,
	resolveDraft,
} from "./draft-store";

const journal = (over: Partial<Journal> = {}): Journal => ({
	doc: textDoc("my work in progress"),
	baseRev: 2,
	generation: 0,
	dirty: true,
	at: 1000,
	files: [],
	...over,
});

const serverDraft = (over: Partial<ComposerDraft> = {}): ComposerDraft => ({
	scope: "thread:test",
	rev: 2,
	generation: 0,
	version: 2,
	doc: textDoc("server text"),
	text: "server text",
	draftKey: null,
	quotes: [],
	references: [],
	choice: {},
	updatedAt: "2026-11-11T10:00:00.000Z",
	attachments: [],
	...over,
});

describe("draft-store (#1024)", () => {
	it("resolveDraft restores a dirty journal at the server rev", () => {
		const j = journal({ baseRev: 2, generation: 0, doc: textDoc("mine") });
		const s = serverDraft({ rev: 2, generation: 0, doc: textDoc("base") });
		expect(resolveDraft(j, s)).toEqual({ kind: "journal", journal: j });
	});

	it("resolveDraft flags conflict when dirty journal base is behind server rev with different text", () => {
		const j = journal({ baseRev: 2, generation: 0, doc: textDoc("mine") });
		const s = serverDraft({ rev: 3, generation: 0, doc: textDoc("theirs") });
		expect(resolveDraft(j, s)).toEqual({
			kind: "conflict",
			journal: j,
			draft: s,
		});
	});

	it("resolveDraft adopts server draft when server generation is newer than the journal", () => {
		const j = journal({ baseRev: 2, generation: 0, doc: textDoc("mine") });
		const s = serverDraft({ rev: 3, generation: 1, doc: textDoc("theirs after send") });
		expect(resolveDraft(j, s)).toEqual({ kind: "server", draft: s });
	});

	it("readJournal converts a legacy journal with text, quotes, references on read", () => {
		const scope = "thread:00000000-0000-0000-0000-000000000001";
		localStorage.setItem(
			journalKey(scope),
			JSON.stringify({
				text: "legacy work",
				quotes: [],
				references: [],
				baseRev: 1,
				generation: 0,
				dirty: true,
				at: 1000,
				files: [],
			}),
		);
		const j = readJournal(scope);
		expect(j?.doc).toEqual(textDoc("legacy work"));
		expect(j?.baseRev).toBe(1);
	});

	it("KEEPALIVE_MAX_BYTES is 60 KiB", () => {
		expect(KEEPALIVE_MAX_BYTES).toBe(60 * 1024);
	});

	it("keepaliveSave refuses bodies over 60 KiB and calls PUT fetch with keepalive under it", () => {
		const fetchSpy = vi.fn().mockResolvedValue(new Response());
		vi.stubGlobal("fetch", fetchSpy);

		const hugeBody = { text: "x".repeat(62 * 1024) };
		const rejected = keepaliveSave("new:home", hugeBody);
		expect(rejected).toBe(false);
		expect(fetchSpy).not.toHaveBeenCalled();

		const smallBody = { text: "save this note" };
		const accepted = keepaliveSave("new:home", smallBody);
		expect(accepted).toBe(true);
		expect(fetchSpy).toHaveBeenCalledOnce();
		expect(fetchSpy).toHaveBeenCalledWith(
			"/api/drafts/new%3Ahome",
			expect.objectContaining({
				method: "PUT",
				keepalive: true,
			}),
		);
	});
});
