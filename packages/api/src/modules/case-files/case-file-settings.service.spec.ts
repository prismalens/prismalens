// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Module } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { beforeEach, describe, expect, it } from "vitest";
import { PrismaService } from "../../core/prisma/prisma.service.js";
import {
	CASE_FILE_SETTING_KEY,
	CaseFileSettingsService,
} from "./case-file-settings.service.js";
import { CredentialsService } from "../integrations/crypto/credentials.service.js";
import { IntegrationsModule } from "../integrations/integrations.module.js";
import { CaseFilesModule } from "./case-files.module.js";

/** Stands in for IntegrationsModule: the case files need only the vault. */
@Module({
	providers: [{ provide: CredentialsService, useValue: {} }],
	exports: [CredentialsService],
})
class CredentialsOnly {}

interface Row {
	key: string;
	value: string;
	type: string;
	category: string | null;
}

/** A setting table held in memory, with the two calls the service makes. */
function fakeSettings() {
	const rows = new Map<string, Row>();
	return {
		rows,
		setting: {
			findUnique: async ({ where }: { where: { key: string } }) =>
				rows.get(where.key) ?? null,
			upsert: async (args: {
				where: { key: string };
				update: Partial<Row>;
				create: Row;
			}) => {
				const existing = rows.get(args.where.key);
				const next = existing
					? { ...existing, ...args.update }
					: args.create;
				rows.set(args.where.key, next);
				return next;
			},
		},
	};
}

describe("CaseFileSettingsService", () => {
	let fake: ReturnType<typeof fakeSettings>;
	let service: CaseFileSettingsService;

	beforeEach(async () => {
		fake = fakeSettings();
		const moduleRef = await Test.createTestingModule({
			providers: [
				CaseFileSettingsService,
				{ provide: PrismaService, useValue: { setting: fake.setting } },
			],
		}).compile();
		service = moduleRef.get(CaseFileSettingsService);
	});

	it("is off when no row exists", async () => {
		expect(await service.isEnabled()).toBe(false);
	});

	it("reads true after set(true), stored as a general json row", async () => {
		await service.set(true);
		expect(await service.isEnabled()).toBe(true);
		expect(fake.rows.get(CASE_FILE_SETTING_KEY)).toEqual({
			key: "case_file",
			value: '{"enabled":true}',
			type: "json",
			category: "general",
		});

		await service.set(false);
		expect(await service.isEnabled()).toBe(false);
	});

	it("reads false for malformed JSON or a value of the wrong shape", async () => {
		const row = (value: string): Row => ({
			key: CASE_FILE_SETTING_KEY,
			value,
			type: "json",
			category: "general",
		});
		fake.rows.set(CASE_FILE_SETTING_KEY, row("{not json"));
		expect(await service.isEnabled()).toBe(false);

		fake.rows.set(CASE_FILE_SETTING_KEY, row('{"enabled":"yes"}'));
		expect(await service.isEnabled()).toBe(false);
	});

	it("is provided by CaseFilesModule", async () => {
		const moduleRef = await Test.createTestingModule({
			imports: [CaseFilesModule],
		})
			.overrideModule(IntegrationsModule)
			.useModule(CredentialsOnly)
			.overrideProvider(PrismaService)
			.useValue({ setting: fake.setting })
			.compile();
		expect(await moduleRef.get(CaseFileSettingsService).isEnabled()).toBe(false);
	});
});
