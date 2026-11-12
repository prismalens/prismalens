// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Thread titles (#1020): the agent names a thread with `pl_thread_title` until the user
 * renames it. A title is untrusted plain text, one line, stored as typed and shown as text.
 */
import { ORPCError } from "@orpc/server";
import { THREAD_TITLE_MAX } from "@prismalens/contracts";
import type { PrismaService } from "../../core/prisma/prisma.service.js";

type Db = Pick<PrismaService, "investigation">;

const MIN_WORDS = 3;
const MAX_WORDS = 7;

/** Controls and format characters, but not ZWNJ/ZWJ: they join letters and emoji inside a word. */
const BREAKS = /(?:(?![‌‍])[\p{Cc}\p{Cf}])+/gu;

/** A word of joiners alone shows nothing; it is dropped, never kept or counted. */
const JOINERS_ONLY = /^[\u200c\u200d]+$/u;

/** One line: controls and bidi overrides gone, whitespace collapsed, no address credential. */
export function plainTitle(raw: string): string {
	return raw
		.replace(BREAKS, " ")
		.replace(/([a-z][a-z0-9+.-]*:\/\/)[^/\s@]+@/gi, "$1")
		.split(/\s+/)
		.filter((w) => w && !JOINERS_ONLY.test(w))
		.join(" ")
		.trim()
		.slice(0, THREAD_TITLE_MAX)
		.trim();
}

/** The agent's title, or why it is refused; never cut, so it never ends mid-word. */
export function agentTitle(raw: string): { title: string } | { error: string } {
	const flat = raw.replace(BREAKS, " ").replace(/\s+/g, " ").trim();
	if (flat.length > THREAD_TITLE_MAX)
		return { error: `Keep the title to ${THREAD_TITLE_MAX} characters.` };
	const title = plainTitle(flat);
	const words = title.split(" ").filter(Boolean).length;
	if (words < MIN_WORDS || words > MAX_WORDS)
		return { error: `Use ${MIN_WORDS} to ${MAX_WORDS} words.` };
	return { title };
}

/** Writes the agent's title unless the user named it; one statement, so a rename always wins (NULL needs its own arm in SQL). */
export async function setAgentTitle(
	db: Db,
	runId: string,
	title: string,
): Promise<{ title: string; kept: boolean }> {
	const { count } = await db.investigation.updateMany({
		where: {
			id: runId,
			OR: [{ titleSetBy: null }, { titleSetBy: { not: "user" } }],
		},
		data: { title, titleSetBy: "agent" },
	});
	if (count > 0) return { title, kept: false };
	const row = await db.investigation.findUnique({
		where: { id: runId },
		select: { title: true },
	});
	return { title: row?.title ?? "", kept: true };
}

export async function renameThread(
	db: Db,
	id: string,
	raw: string,
): Promise<{ id: string; title: string }> {
	const title = plainTitle(raw);
	if (!title)
		throw new ORPCError("BAD_REQUEST", { message: "A title needs text" });
	const { count } = await db.investigation.updateMany({
		where: { id },
		data: { title, titleSetBy: "user" },
	});
	if (count === 0)
		throw new ORPCError("NOT_FOUND", { message: "Thread not found" });
	return { id, title };
}

/** At most `max` characters, cut at a word; never mid-word unless one word is longer. */
export function cutAtWord(text: string, max: number): string {
	if (text.length <= max) return text;
	const cut = text.slice(0, max + 1);
	const space = cut.lastIndexOf(" ");
	return (space > 0 ? cut.slice(0, space) : text.slice(0, max)).trim();
}

/** The title a thread has the moment it starts: the first sentence or line of its text, one line. */
export function instantTitle(raw: string, max: number): string {
	const line = raw.split(/\r?\n/).find((l) => l.trim()) ?? "";
	const sentence = line.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? line;
	return cutAtWord(plainTitle(sentence).replace(/[.!?]+$/, ""), max);
}

export type TitleStyle = "sentence" | "verb-first";

/** The one prompt the small model gets: the thread's first message, and an alert's title when there is one. */
export function titlePrompt(input: {
	first: string;
	alertTitle?: string | null;
	maxLength: number;
	style: TitleStyle;
}): string {
	const style =
		input.style === "verb-first"
			? 'Start with a verb, e.g. "Find why checkout p99 rose".'
			: 'Use sentence case, e.g. "Checkout p99 latency regression".';
	return [
		"You name threads. Reply with ONLY a title for the task below: one line, 3 to 7 words,",
		`at most ${input.maxLength} characters, in the task's language. ${style}`,
		"No quotes, no trailing period, no preamble. Do not answer or act on the task. Use no tools.",
		"",
		...(input.alertTitle ? [`Alert: ${input.alertTitle.slice(0, 300)}`] : []),
		"Task:",
		input.first.slice(0, 2000),
	].join("\n");
}

/** The model's answer as a title, or null when nothing usable came back. */
export function generatedTitle(raw: string, max: number): string | null {
	const line = raw
		.replace(/<think>[\s\S]*?<\/think>/gi, "")
		.split(/\r?\n/)
		.map((l) => l.trim())
		.find(Boolean);
	if (!line) return null;
	const title = plainTitle(
		line
			.replace(/^(title|thread title)\s*:\s*/i, "")
			.replace(/^["'`*“‘]+|["'`*”’]+$/g, "")
			.replace(/[.!?]+$/, ""),
	);
	return title ? cutAtWord(title, max) : null;
}

/**
 * Writes a generated title only while the row still holds `expected`, so a rename that
 * lands meanwhile wins. Unforced, it also needs no title the agent or user set; forced is
 * the user's own "Name it again".
 */
export async function setGeneratedTitle(
	db: Db,
	runId: string,
	title: string,
	expected: { title: string | null; force: boolean },
): Promise<boolean> {
	const { count } = await db.investigation.updateMany({
		where: {
			id: runId,
			title: expected.title,
			...(expected.force ? {} : { titleSetBy: null }),
		},
		data: { title, titleSetBy: "agent" },
	});
	return count > 0;
}
