// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	type PersonSettings,
	PersonSettingsSchema,
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

const PERSON_KEY = "ui.person";

/** The settings that follow the person across devices; none when missing or unreadable. */
export async function readPersonSettings(
	prisma: Pick<PrismaService, "setting">,
): Promise<PersonSettings> {
	const row = await prisma.setting.findUnique({ where: { key: PERSON_KEY } });
	try {
		const parsed = PersonSettingsSchema.safeParse(JSON.parse(row?.value ?? ""));
		return parsed.success ? parsed.data : { values: {} };
	} catch {
		return { values: {} };
	}
}

/** Replaces them; any device may, since they change only how this person reads. */
export async function writePersonSettings(
	prisma: Pick<PrismaService, "setting">,
	next: PersonSettings,
): Promise<PersonSettings> {
	const value = JSON.stringify(PersonSettingsSchema.parse(next));
	await prisma.setting.upsert({
		where: { key: PERSON_KEY },
		create: { key: PERSON_KEY, value, type: "json", category: "ui" },
		update: { value },
	});
	return readPersonSettings(prisma);
}
