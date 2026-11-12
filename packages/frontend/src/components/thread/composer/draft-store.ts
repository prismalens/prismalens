// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	type ComposerDoc,
	type ComposerDraft,
	type ComposerScope,
	draftDoc,
	isEmptyDoc,
	type Quote,
	type ReferenceRef,
	sameDoc,
} from "@prismalens/contracts";
import { createStore, del, get, keys, set } from "idb-keyval";
import { readStored, writeStored } from "@/hooks/use-persisted-state";

/** What the box holds, as the journal and the server keep it: the editor document (#1101). */
export interface DraftContent {
	doc: ComposerDoc;
	/** The key the draft's files upload under; null until the first one (#1101). */
	draftKey?: string | null;
}

/** A file or folded paste whose upload the server has not acknowledged yet. */
export interface PendingFile {
	key: string;
	name: string;
	type: string;
	/** The draft upload holding its bytes, when it landed (#1101). */
	id?: string;
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

/** A journal written before the document (text beside quote and reference lists). */
interface LegacyJournal extends Omit<Journal, "doc"> {
	doc?: undefined;
	text: string;
	quotes: Quote[];
	references: ReferenceRef[];
}

/** The journal, a legacy one converted to the document on read. */
export const readJournal = (scope: ComposerScope): Journal | null => {
	const j = readStored<Journal | LegacyJournal | null>(journalKey(scope), null);
	if (!j) return null;
	if (j.doc) return j;
	const { text, quotes, references, ...rest } = j as LegacyJournal;
	return {
		...rest,
		doc: draftDoc({
			text: text ?? "",
			quotes: quotes ?? [],
			references: references ?? [],
		}),
	};
};

/** False when storage refused it: the box then says "Not saved yet". */
export const writeJournal = (scope: ComposerScope, j: Journal | undefined) =>
	writeStored(journalKey(scope), j);

export const isEmptyContent = (c: DraftContent) => isEmptyDoc(c.doc);

export type DraftResolution =
	| { kind: "journal"; journal: Journal }
	| { kind: "server"; draft: ComposerDraft }
	| { kind: "conflict"; journal: Journal; draft: ComposerDraft }
	| { kind: "none" };

/**
 * What a load restores (#1024): a journal with unsaved changes against the rev the
 * server still holds is restored without asking; a server rev that moved past the
 * journal's base asks "Keep mine / Use theirs" when the whole documents differ;
 * otherwise the server's draft.
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
		if (server.rev > journal.baseRev && !sameDoc(journal.doc, draftDoc(server)))
			return { kind: "conflict", journal, draft: server };
		return { kind: "journal", journal };
	}
	if (server) return { kind: "server", draft: server };
	if (journal && (!isEmptyContent(journal) || journal.files.length))
		return { kind: "journal", journal };
	return { kind: "none" };
}

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

/**
 * Bytes of recently sent files, so Up brings a message's attachments back after the tab or
 * the browser closes (#1101). Only the keys `keep` names stay.
 */
export async function keepSentFiles(
	files: { key: string; file: Blob }[],
	keep: ReadonlySet<string>,
): Promise<void> {
	try {
		for (const f of files) await set(`sent|${f.key}`, f.file, fileStore());
		for (const k of await keys<string>(fileStore()))
			if (k.startsWith("sent|") && !keep.has(k.slice(5)))
				await del(k, fileStore());
	} catch {
		// Storage refused: recall still has this tab's copies.
	}
}

export async function sentFileBytes(
	key: string,
	name: string,
	type: string,
): Promise<File | null> {
	try {
		const blob = await get<Blob>(`sent|${key}`, fileStore());
		return blob ? new File([blob], name, { type }) : null;
	} catch {
		return null;
	}
}

/** A draft upload's bytes from the server, for a reload or another device (#1101). */
export async function draftFileBytes(
	scope: ComposerScope,
	f: Pick<PendingFile, "id" | "name" | "type">,
): Promise<File | null> {
	if (!f.id) return null;
	try {
		const res = await fetch(
			`/api/drafts/${encodeURIComponent(scope)}/attachments/${f.id}`,
			{ credentials: "include" },
		);
		if (!res.ok) return null;
		return new File([await res.blob()], f.name, { type: f.type });
	} catch {
		return null;
	}
}
