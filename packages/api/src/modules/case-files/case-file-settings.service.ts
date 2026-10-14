// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Injectable } from "@nestjs/common";
import { CaseFileSettingsSchema } from "@prismalens/contracts";
import { PrismaService } from "../../core/prisma/prisma.service.js";

export const CASE_FILE_SETTING_KEY = "case_file";

/** The Case File experiment's on/off switch; off unless a valid row says otherwise. */
@Injectable()
export class CaseFileSettingsService {
	constructor(private readonly prisma: PrismaService) {}

	async isEnabled(): Promise<boolean> {
		try {
			const row = await this.prisma.setting.findUnique({
				where: { key: CASE_FILE_SETTING_KEY },
			});
			if (!row) return false;
			const parsed = CaseFileSettingsSchema.safeParse(JSON.parse(row.value));
			return parsed.success && parsed.data.enabled;
		} catch {
			return false;
		}
	}

	async set(enabled: boolean): Promise<void> {
		const value = JSON.stringify({ enabled });
		await this.prisma.setting.upsert({
			where: { key: CASE_FILE_SETTING_KEY },
			update: { value, type: "json" },
			create: {
				key: CASE_FILE_SETTING_KEY,
				value,
				type: "json",
				category: "general",
			},
		});
	}
}
