// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { ThreadContextSettings } from "@prismalens/contracts";
import {
	DEFAULT_THREAD_CONTEXT_SETTINGS,
	ThreadContextSettingsSchema,
} from "@prismalens/contracts";
import { liveChanges } from "../../core/live/live-changes.js";
import type { PrismaService } from "../../core/prisma/prisma.service.js";

const KEY = "threads.context";

/**
 * Settings → "Show pull request status", "Open files in" and "Re-run checks from PrismaLens"
 * (#1024, #1176); a bad row reads as the defaults, and a row from before a key reads its default.
 */
export async function readThreadContextSettings(
	prisma: Pick<PrismaService, "setting">,
): Promise<ThreadContextSettings> {
	const row = await prisma.setting.findUnique({ where: { key: KEY } });
	let stored: unknown = null;
	try {
		stored = row ? JSON.parse(row.value) : null;
	} catch {
		stored = null;
	}
	return {
		...DEFAULT_THREAD_CONTEXT_SETTINGS,
		...ThreadContextSettingsSchema.partial().safeParse(stored).data,
	};
}

export async function writeThreadContextSettings(
	prisma: Pick<PrismaService, "setting">,
	next: ThreadContextSettings,
): Promise<ThreadContextSettings> {
	const value = JSON.stringify(next);
	await prisma.setting.upsert({
		where: { key: KEY },
		create: { key: KEY, value, type: "json", category: "general" },
		update: { value },
	});
	liveChanges.noteTopic("threads");
	return next;
}
