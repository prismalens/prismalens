// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { GitState, GitStateKind } from "@prismalens/contracts";
import {
	ArchiveRestore,
	Check,
	FileDiff,
	GitMerge,
	MessageSquare,
	RefreshCw,
} from "lucide-react";
import {
	defineAction,
	defineObject,
	type Facts,
} from "@/components/kit/actions";

/** A thread's git state on its header chip and the details card: each state's next steps. */
export interface GitStateCtx {
	git: GitState;
	/** What the state's ask actions put in the composer (`gitAsk`). */
	askText: string;
	ask: (text: string) => void;
	/** Opens the thread's changes, where the conflicting files list. */
	openFiles: () => void;
	/** Reads the diff and the change request's checks again. */
	reread: () => void;
	settle: () => void;
	facts: Facts<GitStateKind | "settleable">;
}

export const gitStateObject = defineObject<
	GitStateCtx,
	GitStateKind | "settleable"
>("gitState");

export const gitResolve = defineAction({
	id: "gitState.resolve",
	label: "Ask the agent to resolve",
	icon: GitMerge,
	when: (f) => !!f.is?.conflict,
	run: (c) => c.ask(c.askText),
});

export const gitOpenFiles = defineAction({
	id: "gitState.openFiles",
	label: "Open the files",
	icon: FileDiff,
	when: (f) => !!f.is?.conflict,
	run: (c) => c.openFiles(),
});

export const gitReread = defineAction({
	id: "gitState.reread",
	label: "Re-read the diff and checks",
	icon: RefreshCw,
	when: (f) => !!f.is?.rewritten,
	run: (c) => c.reread(),
});

export const gitAskRewritten = defineAction({
	id: "gitState.compare",
	label: "Ask the agent to compare",
	icon: MessageSquare,
	when: (f) => !!f.is?.rewritten,
	run: (c) => c.ask(c.askText),
});

export const gitRestore = defineAction({
	id: "gitState.restore",
	label: "Ask the agent to restore it",
	icon: ArchiveRestore,
	when: (f) => !!f.is?.gone,
	run: (c) => c.ask(c.askText),
});

export const gitSettle = defineAction({
	id: "gitState.settle",
	label: "Settle",
	icon: Check,
	when: (f) => !!f.is?.gone,
	disabled: (f) => (f.is?.settleable ? false : "Stop the run first"),
	run: (c) => c.settle(),
});
