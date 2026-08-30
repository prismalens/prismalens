// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Regression cover for PR #396 thread A: the setup wizard's `ai_provider` step
 * used to go green whenever ANY provider had a key, so a stray `ANTHROPIC_API_KEY`
 * in the environment hid a completely unconfigured instance.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Logger } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { LLM_CREDENTIAL_ENV_VARS } from "@prismalens/config/llm";
import { CredentialsService } from "../../modules/integrations/crypto/credentials.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { LlmSettingsService } from "./llm-settings.service.js";

/**
 * The REAL gate runs here, with only the machine injected (#518). Stubbing the
 * verdict would let this suite agree with a fiction — the whole defect class came
 * from two components answering "would this run?" differently, so the API's tests
 * have to exercise the same code the worker does. `packages/@prismalens/config`'s
 * `harness-selection.test.ts` owns the behaviour table; these own the wiring:
 * which inputs the service feeds it.
 */
const machine = vi.hoisted(() => ({
	homeDir: "",
	installed: [] as string[],
}));

vi.mock("@prismalens/config/harness-selection", async (importOriginal) => {
	const actual =
		await importOriginal<
			typeof import("@prismalens/config/harness-selection")
		>();
	const auth = () => ({
		homeDir: machine.homeDir,
		isOnPath: (bin: string) => machine.installed.includes(bin),
	});
	return {
		...actual,
		resolveHarnessSelection: (input: Parameters<typeof actual.resolveHarnessSelection>[0]) =>
			actual.resolveHarnessSelection({ ...input, auth: auth() }),
		resolveHarnessAuthFor: (
			harness: Parameters<typeof actual.resolveHarnessAuthFor>[0],
			input: Parameters<typeof actual.resolveHarnessAuthFor>[1],
		) => actual.resolveHarnessAuthFor(harness, { ...input, auth: auth() }),
	};
});

const LLM_SETTINGS_KEY = "LLM_SETTINGS";
const LLM_CREDENTIALS_KEY = "LLM_CREDENTIALS_ENCRYPTED";

describe("LlmSettingsService — active provider resolution", () => {
	let service: LlmSettingsService;
	let originalEnv: NodeJS.ProcessEnv;

	const mockPrisma = {
		setting: {
			findUnique: vi.fn(),
			upsert: vi.fn(),
		},
	};
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
		machine.homeDir = mkdtempSync(join(tmpdir(), "pl-api-home-"));
		machine.installed = [];
		delete process.env.PRISMALENS_HARNESS;
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
					harness: "auto",
				},
			});

			await expect(service.resolveActiveLlmConfig()).resolves.toEqual({
				provider: "ollama",
				model: "gpt-oss:20b",
				baseUrl: "http://localhost:11434",
				harness: "auto",
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
				harness: "auto",
			});
		});

		it("rejects a provider id that is not in the registry", async () => {
			process.env.PRISMALENS_LLM_PROVIDER = "not-a-provider";
			givenSettings({});

			const resolved = await service.resolveActiveLlmConfig();

			expect(resolved.provider).toBeNull();
		});

		it("preserves explicit harness selection", async () => {
			givenSettings({
				llmSettings: {
					activeProvider: "anthropic",
					providers: { anthropic: { model: "claude-sonnet-5" } },
					harness: "claude-code",
				},
			});

			const resolved = await service.resolveActiveLlmConfig();
			expect(resolved.harness).toBe("claude-code");
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

		/**
		 * A real key wins the api-key route, so PATH presence must not be read as a
		 * session — the worker resolves api-key here and throws on the missing model.
		 */
		it("is false when the active provider has a key but no model, even with the CLI installed", async () => {
			process.env.ANTHROPIC_API_KEY = "sk-ant-live";
			machine.installed = ["claude"];
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
			// `loadLlmCredentialsToEnv` pushes stored keys into the env at boot, and
			// the env is all the worker ever sees — so that is what is asserted.
			process.env.OPENAI_API_KEY = "sk-openai-stored";
			machine.installed = ["deepagents-acp"];
			givenSettings({
				llmSettings: {
					activeProvider: "openai",
					providers: { openai: { model: "gpt-5.4-mini" } },
				},
				dbCredentials: { openai: "sk-openai-stored" },
			});

			await expect(service.isActiveProviderUsable()).resolves.toBe(true);
		});

		it("is true for keyless anthropic when CLI session is usable (ADR-0031)", async () => {
			machine.installed = ["claude"];
			givenSettings({
				llmSettings: {
					activeProvider: "anthropic",
					providers: { anthropic: { model: "claude-sonnet-5" } },
				},
			});

			await expect(service.isActiveProviderUsable()).resolves.toBe(true);
		});

		/**
		 * The headline #501 journey: the wizard's keyless path persists anthropic
		 * active with neither a key nor a model, and the setup step has to go green
		 * on it — the worker runs exactly this config through the cli-session route.
		 */
		it("is true for a keyless anthropic config with NO model when a CLI session is usable", async () => {
			machine.installed = ["claude"];
			givenSettings({
				llmSettings: {
					activeProvider: "anthropic",
					providers: { anthropic: { model: "" } },
					harness: "auto",
				},
			});

			await expect(service.isActiveProviderUsable()).resolves.toBe(true);
		});

		it("is false for that config when the harness is pinned away from claude-code", async () => {
			machine.installed = ["claude"];
			givenSettings({
				llmSettings: {
					activeProvider: "anthropic",
					providers: { anthropic: { model: "" } },
					harness: "deepagents",
				},
			});

			await expect(service.isActiveProviderUsable()).resolves.toBe(false);
		});

		it("is true for a keyless provider with a model, a key and its harness installed", async () => {
			process.env.OLLAMA_API_KEY = "ollama-cloud-key";
			machine.installed = ["deepagents-acp"];
			givenSettings({
				llmSettings: {
					activeProvider: "ollama",
					providers: { ollama: { model: "gpt-oss:20b" } },
				},
			});

			await expect(service.isActiveProviderUsable()).resolves.toBe(true);
		});

		/**
		 * Behaviour change on the API side, deliberate: this used to go green on the
		 * provider alone. The worker demands the harness binary AND a key for
		 * deepagents whatever the provider, so reporting it usable was the
		 * setup-goes-green-then-every-job-fails defect in another costume. The worker
		 * is unchanged; see the PR body's note on keyless ollama.
		 */
		it("is false for a keyless provider whose harness cannot start", async () => {
			givenSettings({
				llmSettings: {
					activeProvider: "ollama",
					providers: { ollama: { model: "gpt-oss:20b" } },
				},
			});

			await expect(service.isActiveProviderUsable()).resolves.toBe(false);
		});

		it("is true for an env-only keyless deployment", async () => {
			process.env.PRISMALENS_LLM_PROVIDER = "custom";
			process.env.PRISMALENS_LLM_MODEL = "local-model";
			process.env.CUSTOM_LLM_API_KEY = "custom-key";
			machine.installed = ["deepagents-acp"];
			givenSettings({});

			await expect(service.isActiveProviderUsable()).resolves.toBe(true);
		});
	});

	describe("updateLlmSettings (harness persistence)", () => {
		it("persists the harness field", async () => {
			givenSettings({});
			mockPrisma.setting.upsert.mockResolvedValue({});

			const result = await service.updateLlmSettings({
				harness: "claude-code",
			});

			expect(result.harness).toBe("claude-code");
			expect(mockPrisma.setting.upsert).toHaveBeenCalledWith(
				expect.objectContaining({
					update: expect.objectContaining({
						value: expect.stringContaining('"harness":"claude-code"'),
					}),
				}),
			);
		});
	});

	describe("getHarnessesStatus", () => {
		it("reports credential cause and runnability from the shared gate", async () => {
			machine.installed = ["claude"];
			givenSettings({});
			const response = await service.getHarnessesStatus();

			expect(response.harnesses).toHaveLength(3);

			const claude = response.harnesses.find((h) => h.id === "claude-code");
			expect(claude?.implemented).toBe(true);
			expect(claude?.verdict).toEqual({
				usable: true,
				route: "cli-session",
				verified: false,
			});
			expect(claude?.runnable).toBe(true);
			expect(claude?.blockedReason).toBeNull();

			// #518: the binary is genuinely absent, so say so — do not report it as a
			// missing key the user could go and buy.
			const deepagents = response.harnesses.find((h) => h.id === "deepagents");
			expect(deepagents?.verdict).toMatchObject({
				usable: false,
				cause: "not-installed",
			});
			expect(deepagents?.runnable).toBe(false);
			expect(deepagents?.blockedReason).not.toBeNull();

			const codex = response.harnesses.find((h) => h.id === "codex");
			expect(codex?.implemented).toBe(false);
			expect(codex?.runnable).toBe(false);
		});

		/**
		 * #517: a key stored while anthropic was active, then the provider switched.
		 * The worker only hands over the ACTIVE provider's credential, so claude-code
		 * must not be badged usable-via-api-key on the strength of the stale one.
		 */
		it("does not credit claude-code with a stored key for an inactive provider", async () => {
			process.env.ANTHROPIC_API_KEY = "sk-ant-stored";
			process.env.OPENAI_API_KEY = "sk-openai-live";
			givenSettings({
				llmSettings: {
					activeProvider: "openai",
					providers: { openai: { model: "gpt-5.4-mini" } },
				},
			});

			const response = await service.getHarnessesStatus();
			const claude = response.harnesses.find((h) => h.id === "claude-code");

			expect(claude?.verdict.usable).toBe(false);
			expect(claude?.runnable).toBe(false);
		});

		it("never returns key material", async () => {
			process.env.ANTHROPIC_API_KEY = "sk-ant-secret-value";
			machine.installed = ["claude"];
			givenSettings({});

			const serialized = JSON.stringify(await service.getHarnessesStatus());
			expect(serialized).not.toContain("sk-ant-secret-value");
		});

		/**
		 * Per-row evaluation must not be overridden by PRISMALENS_HARNESS (#516).
		 */
		it("evaluates each harness row independently when PRISMALENS_HARNESS is set", async () => {
			process.env.PRISMALENS_HARNESS = "claude-code";
			machine.installed = ["claude"];
			givenSettings({});

			const response = await service.getHarnessesStatus();
			const deepagents = response.harnesses.find((h) => h.id === "deepagents");

			expect(deepagents?.verdict.usable).toBe(false);
			expect(deepagents?.runnable).toBe(false);
			expect(deepagents?.blockedReason).not.toBeNull();
		});
	});
});
