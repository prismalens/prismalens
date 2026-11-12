// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type {
	PrCheckLog,
	PrCheckRun,
	PrReviewThread,
	PullRequest,
} from "@prismalens/contracts";

/** Lines of a log tail a fix message carries; the panel shows the whole tail. */
export const FIX_LOG_LINES = 15;

type PrRef = Pick<PullRequest, "number" | "repo"> & {
	headSha?: string | null;
};

const short = (sha: string | null | undefined) =>
	sha ? sha.slice(0, 7) : "the current head";

/** What "Ask the agent to fix" puts in the composer for a failing check (#1101 category 15). */
export function checkFixMessage(
	pr: PrRef,
	run: Pick<PrCheckRun, "name" | "headSha">,
	log?: Pick<PrCheckLog, "step" | "lines"> | null,
): string {
	const parts = [
		`The check "${run.name}" fails on PR #${pr.number} (${pr.repo}) at ${short(run.headSha ?? pr.headSha)}.`,
	];
	if (log?.step) parts.push(`It fails at the step "${log.step}".`);
	const lines = log?.lines.slice(-FIX_LOG_LINES) ?? [];
	if (lines.length)
		parts.push(`Log excerpt:\n\`\`\`\n${lines.join("\n")}\n\`\`\``);
	parts.push("Find the cause, fix it on this branch and push.");
	return parts.join("\n\n");
}

/** What "Ask the agent to fix" puts in the composer for an open review thread. */
export function reviewFixMessage(pr: PrRef, t: PrReviewThread): string {
	const where = t.line ? `${t.path}:${t.line}` : t.path;
	const quote = t.excerpt
		.split("\n")
		.map((l) => `> ${l}`)
		.join("\n");
	return [
		`@${t.author} left a review thread on ${where} in PR #${pr.number} (${pr.repo}), head ${short(pr.headSha)}:`,
		quote,
		"Address it on this branch, push, and say what you changed.",
	].join("\n\n");
}
