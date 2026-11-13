// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Injectable } from "@nestjs/common";
import {
	THREAD_TREE_DEFAULTS,
	type ThreadTreeSettings,
	type ThreadTreeSettingsInput,
	ThreadTreeSettingsSchema,
} from "@prismalens/contracts";
import { PrismaService } from "../../core/prisma/prisma.service.js";

const KEY = "threads.tree";

/** Settings → Agent → Agent-started threads: may start, and its caps (#1101 cat 18). */
@Injectable()
export class TreeSettings {
	constructor(private readonly prisma: PrismaService) {}

	async get(): Promise<ThreadTreeSettings> {
		const row = await this.prisma.setting.findUnique({ where: { key: KEY } });
		if (!row) return { ...THREAD_TREE_DEFAULTS };
		try {
			const parsed = ThreadTreeSettingsSchema.partial().safeParse(
				JSON.parse(row.value),
			);
			return {
				...THREAD_TREE_DEFAULTS,
				...(parsed.success ? parsed.data : {}),
			};
		} catch {
			return { ...THREAD_TREE_DEFAULTS };
		}
	}

	async set(next: ThreadTreeSettingsInput): Promise<ThreadTreeSettings> {
		const value = JSON.stringify(ThreadTreeSettingsSchema.parse(next));
		await this.prisma.setting.upsert({
			where: { key: KEY },
			create: { key: KEY, value },
			update: { value },
		});
		return this.get();
	}
}
