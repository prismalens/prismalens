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

/** The agent's title, or why it is refused; setAgentTitle cuts its length, as for every title. */
export function agentTitle(raw: string): { title: string } | { error: string } {
	const flat = raw.replace(BREAKS, " ").replace(/\s+/g, " ").trim();
	const title = plainTitle(flat);
	const words = title.split(" ").filter(Boolean).length;
	if (words < MIN_WORDS || words > MAX_WORDS)
		return { error: `Use ${MIN_WORDS} to ${MAX_WORDS} words.` };
	return { title };
}

/**
 * Writes the agent's title unless the user named it; one statement, so a rename always wins
 * (NULL needs its own arm in SQL). Precedence (#1101): user, agent, generated, instant.
 */
export async function setAgentTitle(
	db: Db,
	runId: string,
	raw: string,
	max: number = TITLE_LENGTH,
): Promise<{ title: string; kept: boolean }> {
	const title = finishTitle(raw, max);
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

/** The default title length, the bar's "50 characters or fewer" (#1101). */
const TITLE_LENGTH = 50;

/** The one rule every title source passes: cut at a word, no trailing punctuation, first letter capital. */
export function finishTitle(raw: string, max: number): string {
	const title = cutAtWord(plainTitle(raw), max).replace(
		/[\s.,;:!?\u2026-]+$/u,
		"",
	);
	return title.charAt(0).toUpperCase() + title.slice(1);
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
	const plain = plainTitle(sentence);
	let bare = plain;
	for (let prev = ""; prev !== bare; ) {
		prev = bare;
		bare = bare.replace(LEADING_FILLER, "");
	}
	const words = bare || plain;
	return finishTitle(words, max);
}

/** Greetings and asks that open a message but name nothing; stripped from its front, repeatedly. */
const LEADING_FILLER =
	/^(?:hey|hi|hello|yo|ok(?:ay)?|so|um+|uh+|well|please|pls|quick question|can you|could you|would you|will you|can we|could we|i need you to|i want you to|i'd like you to|help me)\b[\s,.:;!-]*/i;

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

/** A model that answered or refused instead of naming; such a line is never a title. */
const NOT_A_TITLE =
	/^(hello|hi|hey|sure|okay|ok|certainly|sorry|i'm sorry|i am sorry|i can(no|')t|i'm unable|i am unable|as an ai|here('s| is))\b/i;

/** The model's answer as a title, or null when nothing usable came back. */
export function generatedTitle(raw: string, max: number): string | null {
	const line = raw
		.replace(/<think>[\s\S]*?<\/think>/gi, "")
		.split(/\r?\n/)
		.map((l) => l.trim())
		.find(Boolean);
	if (!line || NOT_A_TITLE.test(line)) return null;
	const title = finishTitle(
		line
			.replace(/^(title|thread title)\s*:\s*/i, "")
			.replace(/^["'`*“‘]+|["'`*”’]+$/g, ""),
		max,
	);
	return title || null;
}

/**
 * Writes a generated title only while the row still holds `expected`, so a title set
 * meanwhile wins. Unforced, it needs no title the agent or user set; forced ("Name it
 * again") still never replaces a user's rename.
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
			...(expected.force
				? { OR: [{ titleSetBy: null }, { titleSetBy: { not: "user" } }] }
				: { titleSetBy: null }),
		},
		data: { title, titleSetBy: "generated" },
	});
	return count > 0;
}
