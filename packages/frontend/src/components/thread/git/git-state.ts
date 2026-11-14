// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { GitState } from "@prismalens/contracts";
import { markLook } from "@/components/kit/marks";

const OP_WORD: Record<
	NonNullable<Extract<GitState, { state: "conflict" }>["op"]>,
	string
> = {
	merge: "The merge",
	rebase: "The rebase",
	"cherry-pick": "The cherry-pick",
	revert: "The revert",
};

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;
const list = (files: readonly string[], count: number) =>
	`${files.slice(0, 3).join(", ")}${count > 3 ? ` and ${count - 3} more` : ""}`;

/** ": 1 commit only here, 1 only there", or nothing when only the host's force-push record tells. */
const split = (g: Extract<GitState, { state: "rewritten" }>) =>
	g.ahead === null || g.behind === null
		? " (force-pushed)"
		: `: ${plural(g.ahead, "commit")} only here, ${plural(g.behind, "commit")} only there`;

/** The mark's short word: "Conflict", "Rewritten", "Branch deleted". */
export const gitWord = (g: GitState) =>
	markLook("gitState", g.state).word ?? "";

/** The state in one sentence with its next step, for the mark's hint. */
export function gitLine(g: GitState): string {
	switch (g.state) {
		case "conflict":
			return `${g.op ? OP_WORD[g.op] : "A merge"} stopped on ${plural(g.count, "conflicting file")}: ${list(g.files, g.count)}. Ask the agent to resolve them, or open the files.`;
		case "rewritten":
			return `${g.branch} was rewritten on ${g.remote}${split(g)}. Re-read the diff and the checks.`;
		case "gone":
			return `${g.branch} was deleted on ${g.upstream}. Restore it, or settle the thread.`;
		case "moved":
			return `${g.branch} on ${g.remote} is at ${g.sha.slice(0, 7)}, a commit this worktree has not seen. Re-read the diff and the checks.`;
	}
}

/** What the agent is asked to do for each state's ask action. */
export function gitAsk(g: GitState): string {
	switch (g.state) {
		case "conflict":
			return `${g.op ? OP_WORD[g.op] : "A merge"} in this worktree stopped on conflicts in ${g.files.map((f) => `\`${f}\``).join(", ")}${g.count > g.files.length ? ` and ${g.count - g.files.length} more` : ""}. Resolve them keeping both sides' intent, run the tests, and finish the ${g.op ?? "merge"}.`;
		case "rewritten":
			return `\`${g.branch}\` was rewritten on \`${g.remote}\`${split(g)}. Fetch it, compare the two, tell me what differs, and don't force-push without asking me.`;
		case "moved":
			return `\`${g.branch}\` on \`${g.remote}\` moved to \`${g.sha.slice(0, 7)}\`, which this worktree has not seen. Fetch it, tell me whether it builds on our commits or rewrote them, and don't push until I answer.`;
		case "gone":
			return `\`${g.branch}\` was deleted on \`${g.upstream}\`. Push it again to restore it, and tell me whether its pull request needs reopening.`;
	}
}
