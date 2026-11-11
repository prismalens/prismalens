// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type {
	ComposerDraft,
	ComposerScope,
	Quote,
	ReferenceRef,
} from "@prismalens/contracts";
import { createStore, del, get, set } from "idb-keyval";
import { readStored, writeStored } from "@/hooks/use-persisted-state";

/** What the box holds beside its files, as the journal and the server keep it. */
export interface DraftContent {
	text: string;
	quotes: Quote[];
	references: ReferenceRef[];
}

/** A file or folded paste whose upload the server has not acknowledged yet. */
export interface PendingFile {
	key: string;
	name: string;
	type: string;
	/** A folded paste: its text rides in the journal until it uploads. */
	pasted?: string;
}

/**
 * The per-scope localStorage journal (#1024): written on every change, before the
 * server save, with the rev the edit started from. It wins over an older server
 * draft on load, and carries a draft whose keepalive save would be too big.
 */
export interface Journal extends DraftContent {
	baseRev: number;
	generation: number;
	/** Changed since the server last acknowledged a save. */
	dirty: boolean;
	at: number;
	files: PendingFile[];
}

export const journalKey = (scope: ComposerScope) => `pl.draft.${scope}`;

export const readJournal = (scope: ComposerScope): Journal | null =>
	readStored<Journal | null>(journalKey(scope), null);

/** False when storage refused it: the box then says "Not saved yet". */
export const writeJournal = (scope: ComposerScope, j: Journal | undefined) =>
	writeStored(journalKey(scope), j);

export const isEmptyContent = (c: DraftContent) =>
	!c.text.trim() && c.quotes.length === 0 && c.references.length === 0;

export type DraftResolution =
	| { kind: "journal"; journal: Journal }
	| { kind: "server"; draft: ComposerDraft }
	| { kind: "conflict"; journal: Journal; draft: ComposerDraft }
	| { kind: "none" };

/**
 * What a load restores (#1024): a journal with unsaved changes against the rev the
 * server still holds is restored without asking; a server rev that moved past the
 * journal's base asks "Keep mine / Use theirs"; otherwise the server's draft.
 */
export function resolveDraft(
	journal: Journal | null,
	server: ComposerDraft | null,
): DraftResolution {
	if (journal?.dirty) {
		if (!server) return { kind: "journal", journal };
		if (server.generation > journal.generation)
			// The draft was sent since this edit; its text went with it.
			return { kind: "server", draft: server };
		if (server.rev > journal.baseRev && !sameContent(journal, server))
			return { kind: "conflict", journal, draft: server };
		return { kind: "journal", journal };
	}
	if (server) return { kind: "server", draft: server };
	if (journal && (!isEmptyContent(journal) || journal.files.length))
		return { kind: "journal", journal };
	return { kind: "none" };
}

const sameContent = (a: DraftContent, b: DraftContent) =>
	a.text === b.text &&
	JSON.stringify(a.quotes) === JSON.stringify(b.quotes) &&
	JSON.stringify(a.references) === JSON.stringify(b.references);

/** The Fetch keepalive budget is 64 KiB in flight; past this the journal carries the draft. */
export const KEEPALIVE_MAX_BYTES = 60 * 1024;

/** The page-hide save: false when it was too big to send, so the journal must carry it. */
export function keepaliveSave(scope: ComposerScope, body: unknown): boolean {
	const json = JSON.stringify(body);
	if (new Blob([json]).size > KEEPALIVE_MAX_BYTES) return false;
	try {
		void fetch(`/api/drafts/${encodeURIComponent(scope)}`, {
			method: "PUT",
			body: json,
			headers: { "content-type": "application/json" },
			credentials: "include",
			keepalive: true,
		}).catch(() => {});
		return true;
	} catch {
		return false;
	}
}

let files: ReturnType<typeof createStore> | null = null;
const fileStore = () => {
	files ??= createStore("prismalens-drafts", "files");
	return files;
};
const fileKey = (scope: ComposerScope, key: string) => `${scope}|${key}`;

/** Keeps a file's bytes until its upload is acknowledged; false where IndexedDB is unavailable. */
export async function keepFile(
	scope: ComposerScope,
	key: string,
	file: Blob,
): Promise<boolean> {
	try {
		await set(fileKey(scope, key), file, fileStore());
		return true;
	} catch {
		return false;
	}
}

export async function keptFile(
	scope: ComposerScope,
	f: PendingFile,
): Promise<File | null> {
	try {
		const blob = await get<Blob>(fileKey(scope, f.key), fileStore());
		return blob ? new File([blob], f.name, { type: f.type }) : null;
	} catch {
		return null;
	}
}

export async function dropFile(scope: ComposerScope, key: string) {
	try {
		await del(fileKey(scope, key), fileStore());
	} catch {
		// Nothing kept, nothing to drop.
	}
}
