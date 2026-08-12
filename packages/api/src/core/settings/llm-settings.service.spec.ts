// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Regression cover for PR #396 thread A: the setup wizard's `ai_provider` step
 * used to go green whenever ANY provider had a key, so a stray `ANTHROPIC_API_KEY`
 * in the environment hid a completely unconfigured instance.
 */

import { Logger } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { LLM_CREDENTIAL_ENV_VARS } from "@prismalens/config/llm";
import { CredentialsService } from "../../modules/integrations/crypto/credentials.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { LlmSettingsService } from "./llm-settings.service.js";

const LLM_SETTINGS_KEY = "LLM_SETTINGS";
const LLM_CREDENTIALS_KEY = "LLM_CREDENTIALS_ENCRYPTED";

describe("LlmSettingsService — active provider resolution", () => {
	let service: LlmSettingsService;
	let originalEnv: NodeJS.ProcessEnv;

	const mockPrisma = { setting: { findUnique: vi.fn() } };
	const mockCredentials = { decryptFromBase64: vi.fn() };

	/** Seed the two Setting rows the resolver reads. */
	function givenSettings(options: {
		llmSettings?: unknown;
		dbCredentials?: Record<string, string>;
	}) {
		mockPrisma.setting.findUnique.mockImplementation(
			({ where }: { where: { key: string } }) => {
				if (where.key === LLM_SETTINGS_KEY) {
					return Promise.resolve(
						options.llmSettings
							? { value: JSON.stringify(options.llmSettings) }
							: null,
					);
				}
				if (where.key === LLM_CREDENTIALS_KEY) {
					return Promise.resolve(
						options.dbCredentials ? { value: "ciphertext" } : null,
					);
				}
				return Promise.resolve(null);
			},
		);
		mockCredentials.decryptFromBase64.mockReturnValue(
			options.dbCredentials ?? {},
		);
	}

	beforeEach(async () => {
		vi.clearAllMocks();
		vi.spyOn(Logger.prototype, "log").mockImplementation(() => {});
		vi.spyOn(Logger.prototype, "warn").mockImplementation(() => {});
		vi.spyOn(Logger.prototype, "error").mockImplementation(() => {});

		// A developer shell routinely has a provider key exported; the whole point
		// of these cases is what that key does and does not imply.
		originalEnv = process.env;
		process.env = { ...originalEnv };
		for (const envVar of LLM_CREDENTIAL_ENV_VARS) {
			delete process.env[envVar];
		}
		delete process.env.PRISMALENS_LLM_PROVIDER;
		delete process.env.PRISMALENS_LLM_MODEL;

		const moduleRef = await Test.createTestingModule({
			providers: [
				LlmSettingsService,
				{ provide: PrismaService, useValue: mockPrisma },
				{ provide: CredentialsService, useValue: mockCredentials },
			],
		}).compile();

		service = moduleRef.get(LlmSettingsService);
	});

	afterEach(() => {
		process.env = originalEnv;
	});

	describe("resolveActiveLlmConfig", () => {
		it("prefers the DB settings over the env vars", async () => {
			process.env.PRISMALENS_LLM_PROVIDER = "groq";
			process.env.PRISMALENS_LLM_MODEL = "openai/gpt-oss-120b";
			givenSettings({
				llmSettings: {
					activeProvider: "ollama",
					providers: {
						ollama: { model: "gpt-oss:20b", baseUrl: "http://localhost:11434" },
					},
				},
			});

			await expect(service.resolveActiveLlmConfig()).resolves.toEqual({
				provider: "ollama",
				model: "gpt-oss:20b",
				baseUrl: "http://localhost:11434",
			});
		});

		it("falls back to the env vars when nothing is saved", async () => {
			process.env.PRISMALENS_LLM_PROVIDER = "anthropic";
			process.env.PRISMALENS_LLM_MODEL = "claude-sonnet-5";
			givenSettings({});

			await expect(service.resolveActiveLlmConfig()).resolves.toEqual({
				provider: "anthropic",
				model: "claude-sonnet-5",
				baseUrl: null,
			});
		});

		it("rejects a provider id that is not in the registry", async () => {
			process.env.PRISMALENS_LLM_PROVIDER = "not-a-provider";
			givenSettings({});

			const resolved = await service.resolveActiveLlmConfig();

			expect(resolved.provider).toBeNull();
		});
	});

	describe("isActiveProviderUsable", () => {
		it("is false when a key sits in the env but no provider was ever chosen", async () => {
			process.env.ANTHROPIC_API_KEY = "sk-ant-from-the-shell";
			givenSettings({});

			await expect(service.isActiveProviderUsable()).resolves.toBe(false);
		});

		it("is false when the key belongs to a provider other than the active one", async () => {
			process.env.GOOGLE_API_KEY = "gk-live";
			givenSettings({
				llmSettings: {
					activeProvider: "anthropic",
					providers: { anthropic: { model: "claude-sonnet-5" } },
				},
			});

			await expect(service.isActiveProviderUsable()).resolves.toBe(false);
		});

		it("is false when the active provider has a key but no model", async () => {
			process.env.ANTHROPIC_API_KEY = "sk-ant-live";
			givenSettings({
				llmSettings: { activeProvider: "anthropic", providers: {} },
			});

			await expect(service.isActiveProviderUsable()).resolves.toBe(false);
		});

		it("is true when the active provider's key comes from the environment", async () => {
			process.env.ANTHROPIC_API_KEY = "sk-ant-live";
			givenSettings({
				llmSettings: {
					activeProvider: "anthropic",
					providers: { anthropic: { model: "claude-sonnet-5" } },
				},
			});

			await expect(service.isActiveProviderUsable()).resolves.toBe(true);
		});

		it("is true when the active provider's key comes from the vault", async () => {
			givenSettings({
				llmSettings: {
					activeProvider: "openai",
					providers: { openai: { model: "gpt-5.4-mini" } },
				},
				dbCredentials: { openai: "sk-openai-stored" },
			});

			await expect(service.isActiveProviderUsable()).resolves.toBe(true);
		});

		it("is true for a keyless provider with a model and no credential anywhere", async () => {
			givenSettings({
				llmSettings: {
					activeProvider: "ollama",
					providers: { ollama: { model: "gpt-oss:20b" } },
				},
			});

			await expect(service.isActiveProviderUsable()).resolves.toBe(true);
		});

		it("is true for an env-only keyless deployment", async () => {
			process.env.PRISMALENS_LLM_PROVIDER = "custom";
			process.env.PRISMALENS_LLM_MODEL = "local-model";
			givenSettings({});

			await expect(service.isActiveProviderUsable()).resolves.toBe(true);
		});
	});
});
