// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { PrismaService } from "../../core/prisma/prisma.service.js";

/** The branch link events are stored under, apart from the run's own numbering. */
export const TREE_BRANCH = "tree";

/** The thread's path in the app: what an agent shows the user, never an id alone. */
export function threadLink(row: {
	id: string;
	incidentId: string | null;
	scheduleId: string | null;
}): string {
	if (row.incidentId)
		return `/incidents/${row.incidentId}/conversation?investigation=${row.id}`;
	if (row.scheduleId) return `/schedules/${row.scheduleId}/runs/${row.id}`;
	return `/threads/${row.id}`;
}

/** The text an agent receives for a message: `[Message from Fix the DB (/threads/…)] …`. */
export async function treeMessageText(
	prisma: Pick<PrismaService, "investigation">,
	m: { fromId: string; text: string },
): Promise<string> {
	const from = await prisma.investigation.findUnique({
		where: { id: m.fromId },
		select: { id: true, title: true, incidentId: true, scheduleId: true },
	});
	const name = from
		? `${from.title?.trim() || "a thread"} (${threadLink(from)})`
		: "a thread";
	return `[Message from ${name}] ${m.text}`;
}
