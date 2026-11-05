// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Injectable } from "@nestjs/common";
import {
	THREAD_TREE_DEFAULTS,
	type ThreadTreeSettings,
	ThreadTreeSettingsSchema,
} from "@prismalens/contracts";
import type { PrismaService } from "../../core/prisma/prisma.service.js";

const KEY = "threads.tree";

/** Settings → Agent → "Agents may start threads", and its folded caps (#1024 spec F). */
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

	async set(next: ThreadTreeSettings): Promise<ThreadTreeSettings> {
		const value = JSON.stringify(ThreadTreeSettingsSchema.parse(next));
		await this.prisma.setting.upsert({
			where: { key: KEY },
			create: { key: KEY, value },
			update: { value },
		});
		return this.get();
	}
}
