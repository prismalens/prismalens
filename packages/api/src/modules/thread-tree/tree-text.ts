// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { PrismaService } from "../../core/prisma/prisma.service.js";

/** The branch tree events are stored under, apart from the run's own numbering. */
export const TREE_BRANCH = "tree";

/** A member's name in messages: its role, `root` for the root. */
export function memberName(
	m: { id: string; role: string | null },
	rootId: string,
): string {
	return m.id === rootId ? "root" : (m.role ?? "thread");
}

/** The text an agent receives for a tree message: `[FROM db #2] result: …`. */
export async function treeMessageText(
	prisma: Pick<PrismaService, "investigation">,
	m: { fromId: string; rootId: string; type: string; text: string },
): Promise<string> {
	const members = await prisma.investigation.findMany({
		where: { OR: [{ id: m.rootId }, { rootId: m.rootId }] },
		orderBy: { createdAt: "asc" },
		select: { id: true, role: true },
	});
	const i = members.findIndex((x) => x.id === m.fromId);
	const from = members[i];
	const name = from ? memberName(from, m.rootId) : "thread";
	return `[FROM ${name} #${i + 1}] ${m.type}: ${m.text}`;
}
