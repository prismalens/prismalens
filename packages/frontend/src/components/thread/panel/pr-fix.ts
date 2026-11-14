// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	type PrCheckLog,
	type PrCheckRun,
	type PrReviewThread,
	type PullRequest,
	prHostTerms,
	prLabel,
} from "@prismalens/contracts";

/** Lines of a log tail a fix message carries; the panel shows the whole tail. */
export const FIX_LOG_LINES = 15;

type PrRef = Pick<PullRequest, "number" | "repo"> &
	Partial<Pick<PullRequest, "host">> & {
		headSha?: string | null;
	};

const short = (sha: string | null | undefined) =>
	sha ? sha.slice(0, 7) : "the current head";

const ANNOTATION =
	/(?:file=([^,\s]+),line=(\d+))|((?:[\w@.-]+\/)*[\w@.-]+\.[A-Za-z]{1,5}):(\d+)(?::\d+)?/;

/** The first file and line a log names: an annotation (`file=a.ts,line=4`) or `a.ts:4:2`. */
export function annotatedLine(lines: readonly string[]): string | null {
	for (const l of lines) {
		const m = ANNOTATION.exec(l);
		if (m?.[1]) return `${m[1]}:${m[2]}`;
		if (m?.[3] && !/^https?$/.test(m[3])) return `${m[3]}:${m[4]}`;
	}
	return null;
}

/** What "Ask the agent to fix" puts in the composer for a failing check (#1101 category 15). */
export function checkFixMessage(
	pr: PrRef,
	run: Pick<PrCheckRun, "name" | "headSha">,
	log?: Pick<PrCheckLog, "step" | "lines"> | null,
): string {
	const at = annotatedLine(log?.lines ?? []);
	const parts = [
		`${at ? `Start at ${at}. ` : ""}The ${prHostTerms(pr.host).check} "${run.name}" fails on ${prLabel(pr.host, pr.number)} (${pr.repo}) at ${short(run.headSha ?? pr.headSha)}.`,
	];
	if (log?.step) parts.push(`It fails at the step "${log.step}".`);
	const lines = log?.lines.slice(-FIX_LOG_LINES) ?? [];
	if (lines.length)
		parts.push(`Log excerpt:\n\`\`\`\n${lines.join("\n")}\n\`\`\``);
	parts.push("Find the cause, fix it on this branch and push.");
	return parts.join("\n\n");
}

/** What the PR chip's "Ask the agent to fix" puts in the composer: its failing checks, by count. */
export function checksFixMessage(
	pr: Omit<PrRef, "repo"> & {
		repo?: string;
		checks?: { failed: number } | null;
	},
): string {
	const n = pr.checks?.failed ?? 0;
	const check = prHostTerms(pr.host).check;
	const what = n ? `${n} ${check}${n === 1 ? "" : "s"}` : `The ${check}s`;
	const where = pr.repo
		? `${prLabel(pr.host, pr.number)} (${pr.repo})`
		: prLabel(pr.host, pr.number);
	return [
		`${what} fail on ${where} at ${short(pr.headSha)}.`,
		"Read the failing logs, find the cause, fix it on this branch and push.",
	].join("\n\n");
}

/** What "Ask the agent to fix" puts in the composer for an open review thread. */
export function reviewFixMessage(pr: PrRef, t: PrReviewThread): string {
	const where = t.line ? `${t.path}:${t.line}` : t.path;
	const quote = t.excerpt
		.split("\n")
		.map((l) => `> ${l}`)
		.join("\n");
	return [
		`@${t.author} left a review thread on ${where} in ${prLabel(pr.host, pr.number)} (${pr.repo}), head ${short(pr.headSha)}:`,
		quote,
		"Address it on this branch, push, and say what you changed.",
	].join("\n\n");
}
