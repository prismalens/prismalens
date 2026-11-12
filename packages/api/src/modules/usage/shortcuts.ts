// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	type ShortcutRemaps,
	ShortcutRemapsSchema,
} from "@prismalens/contracts";
import type { PrismaService } from "../../core/prisma/prisma.service.js";

const KEY = "ui.shortcuts";

/** Settings → Keyboard shortcuts: the stored remaps, or none when the row is missing or unreadable. */
export async function readShortcuts(
	prisma: Pick<PrismaService, "setting">,
): Promise<ShortcutRemaps> {
	const row = await prisma.setting.findUnique({ where: { key: KEY } });
	try {
		const parsed = ShortcutRemapsSchema.safeParse(JSON.parse(row?.value ?? ""));
		return parsed.success ? parsed.data : { keys: {} };
	} catch {
		return { keys: {} };
	}
}

/** Replaces the remaps; any device may, since they change only how this operator types. */
export async function writeShortcuts(
	prisma: Pick<PrismaService, "setting">,
	next: ShortcutRemaps,
): Promise<ShortcutRemaps> {
	const value = JSON.stringify(ShortcutRemapsSchema.parse(next));
	await prisma.setting.upsert({
		where: { key: KEY },
		create: { key: KEY, value, type: "json", category: "ui" },
		update: { value },
	});
	return readShortcuts(prisma);
}
