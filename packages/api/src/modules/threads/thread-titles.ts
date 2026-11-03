// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Thread titles (#1020): the agent names a thread with `thread_title` until the user
 * renames it. A title is untrusted plain text, one line, stored as typed and shown as text.
 */
import { ORPCError } from "@orpc/server";
import { THREAD_TITLE_MAX } from "@prismalens/contracts";
import type { PrismaService } from "../../core/prisma/prisma.service.js";

type Db = Pick<PrismaService, "investigation">;

const MIN_WORDS = 3;
const MAX_WORDS = 7;

/** One line: controls and bidi overrides gone, whitespace collapsed, no address credential. */
export function plainTitle(raw: string): string {
	return raw
		.replace(/[\p{Cc}\p{Cf}]+/gu, " ")
		.replace(/([a-z][a-z0-9+.-]*:\/\/)[^/\s@]+@/gi, "$1")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, THREAD_TITLE_MAX)
		.trim();
}

/** The agent's title, or why it is refused; never cut, so it never ends mid-word. */
export function agentTitle(raw: string): { title: string } | { error: string } {
	const flat = raw
		.replace(/[\p{Cc}\p{Cf}]+/gu, " ")
		.replace(/\s+/g, " ")
		.trim();
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
