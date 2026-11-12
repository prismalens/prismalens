// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	type ComposerDraft,
	type ComposerScope,
	DRAFT_TEXT_MAX_CHARS,
	docParts,
	docText,
	draftDoc,
	MAX_ATTACHMENTS_PER_MESSAGE,
	MAX_QUOTES_PER_MESSAGE,
	MAX_REFERENCES_PER_MESSAGE,
	sameDoc,
} from "@prismalens/contracts";
import type { QueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import {
	fetchServerDraft,
	useSaveDraft,
	useServerDraft,
} from "@/lib/api/hooks/use-drafts-orpc";
import {
	type DraftContent,
	isEmptyContent,
	type Journal,
	keepaliveSave,
	type PendingFile,
	readJournal,
	resolveDraft,
	writeJournal,
} from "./draft-store";

/** The server save waits this long after the last change (#1024). */
export const DRAFT_DEBOUNCE_MS = 300;

export interface DraftConflict {
	mine: DraftContent;
	theirs: ComposerDraft;
}

/** A version-2 body: the document, with its flat fields kept for older readers (#1101). */
function bodyOf(c: DraftContent) {
	const parts = docParts(c.doc);
	return {
		version: 2 as const,
		doc: c.doc,
		text: docText(c.doc).slice(0, DRAFT_TEXT_MAX_CHARS),
		draftKey: c.draftKey ?? null,
		// The uploads the box's file chips hold, so another device can fetch them (#1101).
		attachments: parts.files
			.flatMap((f) => (f.id && !f.refusal ? [f.id] : []))
			.slice(0, MAX_ATTACHMENTS_PER_MESSAGE),
		quotes: parts.quotes.slice(0, MAX_QUOTES_PER_MESSAGE),
		references: parts.references.slice(0, MAX_REFERENCES_PER_MESSAGE),
		choice: {},
	};
}

const contentOf = (d: ComposerDraft): DraftContent => ({
	doc: draftDoc(d),
	draftKey: d.draftKey,
});

const conflictCurrent = (e: unknown): ComposerDraft | null => {
	const err = e as { code?: string; data?: { current?: ComposerDraft | null } };
	return err?.code === "CONFLICT" ? (err.data?.current ?? null) : null;
};

/**
 * Keeps the box's draft (#1024): a localStorage journal on every change, a debounced
 * server save, a keepalive save on page hide, and the "Changed on another device"
 * choice when the server moved past the journal. Null `scope` keeps nothing.
 */
export function useComposerDraft({
	scope,
	content,
	files,
	onRestore,
	client,
}: {
	client: QueryClient;
	scope: ComposerScope | null;
	content: DraftContent;
	files: PendingFile[];
	/** Puts a restored draft into the box; the journal's pending files come with it. */
	onRestore: (content: DraftContent, files: PendingFile[]) => void;
}) {
	const server = useServerDraft(scope, client);
	const save = useSaveDraft(client);
	const [loadedScope, setLoadedScope] = useState<ComposerScope | null>(null);
	const [conflict, setConflict] = useState<DraftConflict | null>(null);
	const [unsaved, setUnsaved] = useState(false);
	const at = useRef({ rev: 0, generation: 0 });
	// One save at a time: a later one starts from the revision the earlier one returned.
	const saving = useRef<Promise<void>>(Promise.resolve());
	// After a send the box is empty; that is not a draft to save over what the server holds.
	const justSent = useRef(false);
	// From the moment a send reads its fields until it settles, no save goes out: a late
	// save would land after the server's tombstone and bring the sent text back (#1101).
	const holding = useRef(false);
	// Bumps on each landed save, so a slower read of the server never rolls the revision back.
	const landed = useRef(0);
	const restore = useRef(onRestore);
	restore.current = onRestore;
	const latest = useRef({ content, files });
	latest.current = { content, files };
	const loaded = !!scope && loadedScope === scope;

	// Load once per scope, after the server answered (or failed: the journal still restores).
	useEffect(() => {
		if (!scope || loadedScope === scope || server.isPending) return;
		const journal = readJournal(scope);
		const r = resolveDraft(journal, server.data ?? null);
		at.current = { rev: 0, generation: 0 };
		if (r.kind === "journal") {
			at.current = {
				rev: r.journal.baseRev,
				generation: r.journal.generation,
			};
			restore.current(r.journal, r.journal.files);
		} else if (r.kind === "server") {
			at.current = { rev: r.draft.rev, generation: r.draft.generation };
			restore.current(contentOf(r.draft), journal?.files ?? []);
		} else if (r.kind === "conflict") {
			at.current = { rev: r.draft.rev, generation: r.draft.generation };
			restore.current(r.journal, r.journal.files);
			setConflict({ mine: r.journal, theirs: r.draft });
		}
		setLoadedScope(scope);
	}, [scope, loadedScope, server.isPending, server.data]);

	const journalNow = (dirty: boolean): Journal => ({
		...latest.current.content,
		files: latest.current.files,
		baseRev: at.current.rev,
		generation: at.current.generation,
		dirty,
		at: Date.now(),
	});

	const push = async (retried = false): Promise<void> => {
		if (!scope || holding.current) return;
		const c = latest.current.content;
		try {
			const saved = await save.mutateAsync({
				scope,
				...bodyOf(c),
				baseRev: at.current.rev,
				generation: at.current.generation,
			});
			at.current = { rev: saved.rev, generation: saved.generation };
			landed.current++;
			const still =
				JSON.stringify(latest.current.content) === JSON.stringify(c);
			writeJournal(scope, journalNow(!still));
		} catch (e) {
			const current = conflictCurrent(e);
			if (!current) return; // Offline: the journal keeps it for the next load.
			// A send moved the generation, or the server holds what we hold: adopt and save again.
			if (
				!retried &&
				(current.generation !== at.current.generation ||
					sameDoc(draftDoc(current), c.doc))
			) {
				at.current = { rev: current.rev, generation: current.generation };
				return push(true);
			}
			setConflict({ mine: c, theirs: current });
		}
	};

	// Every change: the journal now, the server after the debounce.
	const contentKey = JSON.stringify([content, files.map((f) => f.key)]);
	const pushRef = useRef(() => {
		const next = saving.current.then(() => push());
		saving.current = next.catch(() => {});
		return next;
	});
	pushRef.current = () => {
		const next = saving.current.then(() => push());
		saving.current = next.catch(() => {});
		return next;
	};
	// biome-ignore lint/correctness/useExhaustiveDependencies: contentKey is the change signal.
	useEffect(() => {
		if (!scope || !loaded || conflict) return;
		const ok = writeJournal(scope, journalNow(true));
		setUnsaved(!ok);
		if (isEmptyContent(content) && at.current.rev === 0) return;
		if (isEmptyContent(content) && justSent.current) return;
		justSent.current = false;
		const t = setTimeout(() => void pushRef.current(), DRAFT_DEBOUNCE_MS);
		return () => clearTimeout(t);
	}, [contentKey, scope, loaded, conflict]);

	// Page hide: one keepalive save; past 60 KiB the journal carries it to the next load.
	useEffect(() => {
		if (!scope) return;
		const flush = () => {
			const j = readJournal(scope);
			if (!j?.dirty) return;
			keepaliveSave(scope, {
				scope,
				...bodyOf(j),
				baseRev: at.current.rev,
				generation: at.current.generation,
			});
		};
		const onVis = () => document.visibilityState === "hidden" && flush();
		window.addEventListener("pagehide", flush);
		document.addEventListener("visibilitychange", onVis);
		return () => {
			window.removeEventListener("pagehide", flush);
			document.removeEventListener("visibilitychange", onVis);
		};
	}, [scope]);

	return {
		loaded,
		conflict,
		/** "Changed on another device" never shows once storage refuses the journal. */
		unsaved,
		/** The envelope's draft fields: the server deletes the draft when `draftRev` is current. */
		sendFields: async () => {
			holding.current = true;
			await saving.current;
			return scope && at.current.rev > 0
				? { draftScope: scope, draftRev: at.current.rev }
				: scope
					? { draftScope: scope }
					: {};
		},
		/** The send settled: saves resume, and one goes out for text a failed send left. */
		release: () => {
			if (!holding.current) return;
			holding.current = false;
			if (!justSent.current) void pushRef.current();
		},
		/**
		 * A send went out: the server tombstoned the draft, unless another device saved a newer
		 * one first. The server's own revision and generation replace the assumed ones, and a
		 * newer draft it kept is offered as "Changed on another device" rather than overwritten.
		 */
		sent: () => {
			if (!scope) return;
			const before = at.current;
			at.current = {
				rev: before.rev + 1,
				generation: before.generation + 1,
			};
			justSent.current = true;
			holding.current = false;
			writeJournal(scope, undefined);
			const savesBefore = landed.current;
			void fetchServerDraft(client, scope).then(
				(now) => {
					if (!now || landed.current !== savesBefore) return;
					at.current = { rev: now.rev, generation: now.generation };
					// The page answered this send itself (an aside, a declined ask): the server
					// kept the draft, so it is emptied here as a send would have (#1101).
					if (now.generation === before.generation && now.rev === before.rev)
						void pushRef.current();
					else if (now.generation === before.generation && now.rev > before.rev)
						setConflict({ mine: latest.current.content, theirs: now });
				},
				() => {},
			);
		},
		keepMine: () => {
			if (!conflict) return;
			at.current = {
				rev: conflict.theirs.rev,
				generation: conflict.theirs.generation,
			};
			setConflict(null);
			void pushRef.current();
		},
		useTheirs: () => {
			if (!conflict || !scope) return;
			at.current = {
				rev: conflict.theirs.rev,
				generation: conflict.theirs.generation,
			};
			restore.current(contentOf(conflict.theirs), []);
			writeJournal(scope, undefined);
			setConflict(null);
		},
	};
}
