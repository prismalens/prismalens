// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * HarnessService is the server half of detect-and-report (ADR 0003 §9): it owns
 * the precedence between PRISMALENS_HARNESS, the persisted pin and auto
 * detection, and it is what `incidents.investigate` consults before refusing a
 * run with 412 (#520). The selection itself is PATH-based, so these tests drive
 * a temp PATH holding stub binaries rather than mocking @prismalens/config —
 * the wiring between the service and the registry is the part worth covering.
 */
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PRISMALENS_OWN_SECRETS } from "@prismalens/engine";
import { QUERY_KINDS } from "../../modules/integrations/source-query.js";
import { envVars } from "../../modules/integrations/telemetry-snapshot.service.js";
import type { PrismaService } from "../prisma/prisma.service.js";
import { envVarStates, HarnessService } from "./harness.service.js";
import { HarnessModelsService } from "./harness-models.service.js";
import type { HarnessProbeService } from "./harness-probe.service.js";

const mockPrismaService = {
	setting: {
		findUnique: vi.fn(),
		upsert: vi.fn(),
	},
	$transaction: (fn: (tx: unknown) => Promise<unknown>) => fn(mockPrismaService),
};

/** A PATH containing exactly the named binaries (registry `binary` values, not ids). */
function pathWith(...binaries: string[]): string {
	const dir = mkdtempSync(join(tmpdir(), "harness-path-"));
	for (const bin of binaries) {
		const file = join(dir, bin);
		writeFileSync(file, "#!/bin/sh\nexit 0\n");
		chmodSync(file, 0o755);
		// Windows finds a binary on PATH only by a PATHEXT extension (#937).
		if (process.platform === "win32") writeFileSync(`${file}.cmd`, "@exit /b 0\r\n");
	}
	return dir;
}

function service(): HarnessService {
	// biome-ignore lint/suspicious/noExplicitAny: structural test double for PrismaService
	return new HarnessService(mockPrismaService as any);
}

function settingRow(value: unknown) {
	return { key: "HARNESS", value: JSON.stringify(value), type: "json" };
}

describe("HarnessService", () => {
	const originalPath = process.env.PATH;
	const originalPin = process.env.PRISMALENS_HARNESS;

	beforeEach(() => {
		vi.clearAllMocks();
		mockPrismaService.setting.findUnique.mockResolvedValue(null);
		mockPrismaService.setting.upsert.mockResolvedValue(undefined);
		process.env.PRISMALENS_HARNESS = undefined;
		delete process.env.PRISMALENS_HARNESS;
		// Nothing on PATH unless a test puts it there.
		process.env.PATH = mkdtempSync(join(tmpdir(), "harness-empty-"));
	});

	afterEach(() => {
		process.env.PATH = originalPath;
		if (originalPin === undefined) delete process.env.PRISMALENS_HARNESS;
		else process.env.PRISMALENS_HARNESS = originalPin;
	});

	describe("getSettings", () => {
		it("defaults to auto when nothing is persisted", async () => {
			await expect(service().getSettings()).resolves.toEqual({
				harness: "auto",
			});
		});

		it("returns the persisted pin and models", async () => {
			mockPrismaService.setting.findUnique.mockResolvedValue(
				settingRow({ harness: "opencode", models: { opencode: "synthetic/model-a" } }),
			);
			await expect(service().getSettings()).resolves.toEqual({
				harness: "opencode",
				models: { opencode: "synthetic/model-a" },
			});
		});

		it("falls back to auto when the stored value is not JSON", async () => {
			mockPrismaService.setting.findUnique.mockResolvedValue({
				key: "HARNESS",
				value: "{not json",
				type: "json",
			});
			await expect(service().getSettings()).resolves.toEqual({
				harness: "auto",
			});
		});

		it("falls back to auto when the stored id is not in the registry", async () => {
			mockPrismaService.setting.findUnique.mockResolvedValue(
				settingRow({ harness: "not-a-harness" }),
			);
			await expect(service().getSettings()).resolves.toEqual({
				harness: "auto",
			});
		});

		it("drops a stored agentModes, run modes and any level this build does not know (#673 w21)", async () => {
			mockPrismaService.setting.findUnique.mockResolvedValue(
				settingRow({
					harness: "auto",
					agentModes: { "claude-code": "plan", codex: "agent" },
					accessLevels: { codex: "auto", opencode: "yolo" },
					runModes: { "claude-code": "plan" },
				}),
			);
			await expect(service().getSettings()).resolves.toEqual({
				harness: "auto",
				accessLevels: { codex: "auto" },
			});
		});
	});

	describe("updateSettings", () => {
		it("merges the patch over what is stored and upserts it", async () => {
			mockPrismaService.setting.findUnique.mockResolvedValue(
				settingRow({ harness: "opencode", models: { opencode: "synthetic/model-a" } }),
			);

			const next = await service().updateSettings({ harness: "codex" });

			expect(next).toEqual({ harness: "codex", models: { opencode: "synthetic/model-a" } });
			const call = mockPrismaService.setting.upsert.mock.calls[0][0];
			expect(call.where).toEqual({ key: "HARNESS" });
			expect(JSON.parse(call.create.value)).toEqual({
				harness: "codex",
				models: { opencode: "synthetic/model-a" },
			});
			expect(call.create.category).toBe("ai");
		});

		it("merges models per harness, and null clears one (#639)", async () => {
			mockPrismaService.setting.findUnique.mockResolvedValue(
				settingRow({ harness: "opencode", models: { opencode: "synthetic/model-a", codex: "synthetic/stale" } }),
			);

			await expect(
				service().updateSettings({ models: { "claude-code": "synthetic/model-b", codex: null } }),
			).resolves.toEqual({
				harness: "opencode",
				models: { opencode: "synthetic/model-a", "claude-code": "synthetic/model-b" },
			});
		});

		it("merges levels per harness, null going back to the default, and drops a stored allowWriteLevels (#673 w21)", async () => {
			mockPrismaService.setting.findUnique.mockResolvedValue(
				settingRow({ harness: "auto", accessLevels: { codex: "auto", opencode: "full-access" }, allowWriteLevels: true }),
			);
			await expect(
				service().updateSettings({ accessLevels: { "claude-code": "auto-edits", opencode: null } }),
			).resolves.toEqual({ harness: "auto", accessLevels: { codex: "auto", "claude-code": "auto-edits" } });
		});

		it("keeps starred models across agents, replacing the list and dropping duplicates and unknown agents (R4.2)", async () => {
			mockPrismaService.setting.findUnique.mockResolvedValue(
				settingRow({
					harness: "opencode",
					favourites: [{ harness: "opencode", model: "old/one" }],
				}),
			);

			await expect(
				service().updateSettings({
					favourites: [
						{ harness: "opencode", model: "anthropic/claude-sonnet-5-5" },
						{ harness: "codex", model: "gpt-5.6" },
						{ harness: "opencode", model: "anthropic/claude-sonnet-5-5" },
						// biome-ignore lint/suspicious/noExplicitAny: a stored row from a future build
						{ harness: "nope" as any, model: "x" },
					],
				}),
			).resolves.toEqual({
				harness: "opencode",
				favourites: [
					{ harness: "opencode", model: "anthropic/claude-sonnet-5-5" },
					{ harness: "codex", model: "gpt-5.6" },
				],
			});
			// A patch without favourites keeps the stored list.
			mockPrismaService.setting.findUnique.mockResolvedValue(
				settingRow({ harness: "opencode", favourites: [{ harness: "codex", model: "gpt-5.6" }] }),
			);
			await expect(service().updateSettings({ harness: "codex" })).resolves.toEqual({
				harness: "codex",
				favourites: [{ harness: "codex", model: "gpt-5.6" }],
			});
		});

		it("drops the old shared `model` key and anything that is not a registry id", async () => {
			mockPrismaService.setting.findUnique.mockResolvedValue(
				settingRow({ harness: "opencode", model: "synthetic/old", models: { nope: "x", opencode: " " } }),
			);
			await expect(service().getSettings()).resolves.toEqual({ harness: "opencode" });
		});
	});

	describe("customModels per harness (#673 w57)", () => {
		it("getSettings cleans customModels: trims, deduplicates, drops empty lists and unknown harness ids", async () => {
			mockPrismaService.setting.findUnique.mockResolvedValue(
				settingRow({
					harness: "auto",
					customModels: {
						"claude-code": ["  gw-1  ", "gw-1", "  gw-2  "],
						opencode: ["   ", ""],
						"unknown-agent": ["x-1"],
					} as Record<string, string[]>,
				}),
			);

			await expect(service().getSettings()).resolves.toEqual({
				harness: "auto",
				customModels: {
					"claude-code": ["gw-1", "gw-2"],
				},
			});
		});

		it("updateSettings patch replaces that harness's list and null clears it", async () => {
			mockPrismaService.setting.findUnique.mockResolvedValue(
				settingRow({
					harness: "auto",
					customModels: {
						"claude-code": ["old-1"],
						opencode: ["open-1"],
					},
				}),
			);

			const result = await service().updateSettings({
				customModels: {
					"claude-code": ["new-1", "new-2"],
					opencode: null,
				},
			});

			expect(result.customModels).toEqual({
				"claude-code": ["new-1", "new-2"],
			});
		});

		it("null clears the only customModels list leaving customModels unset", async () => {
			mockPrismaService.setting.findUnique.mockResolvedValue(
				settingRow({
					harness: "auto",
					customModels: {
						"claude-code": ["old-1"],
					},
				}),
			);

			const result = await service().updateSettings({
				customModels: {
					"claude-code": null,
				},
			});

			expect(result.customModels).toBeUndefined();
		});
	});

	describe("a model stored for a harness that cannot take one (#639 rec 4)", () => {
		it("makes the selection not runnable, with the reason", async () => {
			process.env.PATH = pathWith("gemini");
			mockPrismaService.setting.findUnique.mockResolvedValue(
				settingRow({ harness: "gemini", models: { gemini: "synthetic/model-a" } }),
			);
			await expect(service().resolveSelection()).resolves.toMatchObject({
				runnable: false,
				failure: "model-unsupported",
				harness: "gemini",
				pinnedBy: "settings",
				reason: expect.stringMatching(/picks its own model/),
			});
		});

		it("never lets another harness's model block the run", async () => {
			process.env.PATH = pathWith("gemini");
			mockPrismaService.setting.findUnique.mockResolvedValue(
				settingRow({ harness: "gemini", models: { opencode: "synthetic/model-a" } }),
			);
			await expect(service().resolveSelection()).resolves.toMatchObject({ runnable: true, harness: "gemini" });
		});

		it("runs a harness that takes a model with one set", async () => {
			process.env.PATH = pathWith("opencode");
			mockPrismaService.setting.findUnique.mockResolvedValue(
				settingRow({ harness: "opencode", models: { opencode: "synthetic/model-a" } }),
			);
			await expect(service().resolveSelection()).resolves.toMatchObject({ runnable: true, harness: "opencode" });
		});
	});

	describe("resolveSelection precedence", () => {
		it("lets PRISMALENS_HARNESS win over the persisted pin", async () => {
			process.env.PATH = pathWith("codex-acp");
			process.env.PRISMALENS_HARNESS = "codex";
			mockPrismaService.setting.findUnique.mockResolvedValue(
				settingRow({ harness: "opencode" }),
			);

			const selection = await service().resolveSelection();

			expect(selection).toMatchObject({ runnable: true, harness: "codex" });
		});

		it("uses the persisted pin when no env pin is set", async () => {
			process.env.PATH = pathWith("codex-acp");
			mockPrismaService.setting.findUnique.mockResolvedValue(
				settingRow({ harness: "codex" }),
			);

			// `auto: false` proves the persisted pin chose it, not detection.
			await expect(service().resolveSelection()).resolves.toMatchObject({
				runnable: true,
				harness: "codex",
				auto: false,
			});
		});

		it("auto-detects the row on PATH when nothing is pinned", async () => {
			process.env.PATH = pathWith("opencode");

			await expect(service().resolveSelection()).resolves.toMatchObject({
				runnable: true,
				harness: "opencode",
				auto: true,
			});
		});

		it("refuses when nothing is on PATH", async () => {
			await expect(service().resolveSelection()).resolves.toMatchObject({
				runnable: false,
				failure: "no-harness",
			});
		});

		it("takes the run's own agent over the persisted pin (#673 w52)", async () => {
			process.env.PATH = pathWith("codex-acp", "opencode");
			mockPrismaService.setting.findUnique.mockResolvedValue(
				settingRow({ harness: "opencode" }),
			);
			await expect(
				service().resolveSelection({ harness: "codex" }),
			).resolves.toEqual({ runnable: true, harness: "codex", auto: false });
		});

		it("refuses the run's own agent by name when it is not on PATH", async () => {
			process.env.PATH = pathWith("opencode");
			mockPrismaService.setting.findUnique.mockResolvedValue(
				settingRow({ harness: "opencode" }),
			);
			await expect(
				service().resolveSelection({ harness: "codex" }),
			).resolves.toMatchObject({
				runnable: false,
				failure: "pinned-harness-missing",
				harness: "codex",
				reason: expect.stringMatching(/^Codex is not on this machine/),
			});
		});

		it("keeps PRISMALENS_HARNESS over a run asking for another agent", async () => {
			process.env.PATH = pathWith("codex-acp", "opencode");
			process.env.PRISMALENS_HARNESS = "opencode";
			mockPrismaService.setting.findUnique.mockResolvedValue(null);
			await expect(
				service().resolveSelection({ harness: "codex" }),
			).resolves.toMatchObject({
				runnable: false,
				failure: "env-pinned-other",
				harness: "codex",
				pinnedBy: "env",
			});
			await expect(
				service().resolveSelection({ harness: "opencode" }),
			).resolves.toMatchObject({ runnable: true, harness: "opencode" });
		});

		it("checks the run's own model, not the stored one", async () => {
			process.env.PATH = pathWith("gemini");
			mockPrismaService.setting.findUnique.mockResolvedValue(
				settingRow({ harness: "gemini", models: { gemini: "synthetic/model-a" } }),
			);
			await expect(
				service().resolveSelection({ model: null }),
			).resolves.toMatchObject({ runnable: true, harness: "gemini" });
			await expect(
				service().resolveSelection({ harness: "gemini", model: "x/y" }),
			).resolves.toMatchObject({ runnable: false, failure: "model-unsupported" });
		});
	});

	describe("effectiveChoice (#673)", () => {
		const agentSaysAskAlways = {
			permission: { level: "supervised" as const, file: "f", value: "default" },
		};

		it("gives an auto-started run Auto whatever the next-run chain says", async () => {
			mockPrismaService.setting.findUnique.mockResolvedValue(
				settingRow({ harness: "auto", accessLevels: { opencode: "supervised" } }),
			);
			const s = service();
			s.localDefaultOf = vi.fn().mockReturnValue(agentSaysAskAlways);

			await expect(s.effectiveChoice("opencode", true)).resolves.toEqual({ accessLevel: "auto" });
		});

		it("leaves an interactive run on the next-run chain: the agent's own default here", async () => {
			const s = service();
			s.localDefaultOf = vi.fn().mockReturnValue(agentSaysAskAlways);

			await expect(s.effectiveChoice("opencode")).resolves.toEqual({ accessLevel: "supervised" });
		});
	});

	describe("getStatus", () => {
		it("reports every registry row alongside the verdict", async () => {
			process.env.PATH = pathWith("opencode");

			const status = await service().getStatus();

			expect(status.harnesses.length).toBeGreaterThan(0);
			expect(status.harnesses.map((h) => h.id)).toContain("opencode");
			expect(status.harnesses.find((h) => h.id === "opencode")?.installed).toBe(
				true,
			);
			expect(status.selection).toEqual({
				runnable: true,
				harness: "opencode",
				pinned: false,
				pinnedBy: null,
				blockedReason: null,
			});
		});

		it("localDefault injected reader reaches HarnessStatus (#673 w21)", async () => {
			const s = service();
			const stubDefault = {
				permission: {
					level: "supervised" as const,
					file: "/path/to/settings.json",
					value: "default",
				},
			};
			s.localDefaultOf = vi.fn().mockReturnValue(stubDefault);

			const status = await s.getStatus();

			expect(s.localDefaultOf).toHaveBeenCalledWith("opencode", expect.any(Object));
			const row = status.harnesses.find((h) => h.id === "opencode");
			expect(row?.localDefault).toEqual(stubDefault);
		});

		it("marks an auto-detected selection as not pinned", async () => {
			process.env.PATH = pathWith("opencode");
			const status = await service().getStatus();
			expect(status.selection.pinned).toBe(false);
		});

		it("marks an env-pinned selection as pinned", async () => {
			process.env.PATH = pathWith("opencode");
			process.env.PRISMALENS_HARNESS = "opencode";

			const status = await service().getStatus();

			expect(status.selection).toMatchObject({
				runnable: true,
				harness: "opencode",
				pinned: true,
			});
		});

		it("reports a bare machine as unrunnable and un-pinned, with a reason", async () => {
			const status = await service().getStatus();

			expect(status.selection.runnable).toBe(false);
			expect(status.selection.pinned).toBe(false);
			expect(status.selection.harness).toBeNull();
			expect(status.selection.blockedReason).toMatch(/No coding agent/i);
			expect(status.harnesses.every((h) => !h.installed)).toBe(true);
		});

		it("reports a pin that names a missing binary as pinned, not as a bare machine", async () => {
			process.env.PRISMALENS_HARNESS = "opencode";

			const status = await service().getStatus();

			expect(status.selection).toMatchObject({
				runnable: false,
				harness: "opencode",
				pinned: true,
			});
			expect(status.selection.blockedReason).toMatch(/not installed/i);
		});

		it("reports an unknown env pin as pinned with the known ids in the reason", async () => {
			process.env.PRISMALENS_HARNESS = "not-a-harness";

			const status = await service().getStatus();

			expect(status.selection).toMatchObject({
				runnable: false,
				pinned: true,
			});
			expect(status.selection.blockedReason).toMatch(/not a known harness/i);
		});
	});
});

describe("HarnessService.modeName (#673 w21)", () => {
	it("names a mode as the agent's last check listed it, else by its id", () => {
		const models = new HarnessModelsService();
		models.rememberCheck("claude-code", {
			outcome: "answers-acp",
			detail: "answers ACP",
			servedModel: null,
			effort: null,
			modes: [{ id: "default", name: "Manual" }],
			images: false,
		});
		const svc = new HarnessService(mockPrismaService as unknown as PrismaService, models, {} as HarnessProbeService);
		expect(svc.modeName("claude-code", "default")).toBe("Manual");
		expect(svc.modeName("claude-code", "plan")).toBe("plan");
		expect(svc.modeName("codex", "read-only")).toBe("read-only");
		expect(svc.modeName("claude-code", null)).toBeNull();
	});
});

describe("HarnessService.ensureReady (#673 w9)", () => {
	type Outcome = "answers-acp" | "sign-in-needed";
	function withProbe(outcomes: Outcome[]) {
		const models = new HarnessModelsService();
		const check = vi.fn(async (id: "codex") => {
			const outcome = outcomes.shift() ?? "answers-acp";
			const detail =
				outcome === "answers-acp"
					? "answers ACP"
					: "sign in needed (API Key, ChatGPT)";
			models.rememberCheck(id, {
				outcome,
				detail,
				servedModel: null,
				effort: null,
				images: false,
			});
			return { id, outcome, detail, hard: false as const };
		});
		const svc = new HarnessService(
			mockPrismaService as unknown as PrismaService,
			models,
			{ check } as unknown as HarnessProbeService,
		);
		return { svc, check };
	}

	it("refuses with the agent's name and the check's words", async () => {
		const { svc } = withProbe(["sign-in-needed"]);
		expect(await svc.ensureReady("codex")).toEqual({
			ready: false,
			reason: "Codex: sign in needed (API Key, ChatGPT)",
		});
	});

	it("reuses a remembered ready check instead of probing again", async () => {
		const { svc, check } = withProbe(["answers-acp"]);
		expect(await svc.ensureReady("codex")).toEqual({ ready: true });
		expect(await svc.ensureReady("codex")).toEqual({ ready: true });
		expect(check).toHaveBeenCalledTimes(1);
	});

	it("checks again after a not-ready answer, so signing in takes effect on the next run", async () => {
		const { svc, check } = withProbe(["sign-in-needed", "answers-acp"]);
		expect((await svc.ensureReady("codex")).ready).toBe(false);
		expect(await svc.ensureReady("codex")).toEqual({ ready: true });
		expect(check).toHaveBeenCalledTimes(2);
	});

	it("two callers at once share one probe", async () => {
		const { svc, check } = withProbe(["answers-acp"]);
		const [a, b] = await Promise.all([
			svc.ensureReady("codex"),
			svc.ensureReady("codex"),
		]);
		expect(a).toEqual({ ready: true });
		expect(b).toEqual({ ready: true });
		expect(check).toHaveBeenCalledTimes(1);
	});
});

describe("envVarStates (#907)", () => {
	it("lists the agent's keys, then stored extras; stored wins, then the host, else unset", () => {
		const vars = envVarStates("codex", ["OPENAI_API_KEY", "ZED"], { CODEX_API_KEY: "a", OPENAI_API_KEY: "b" });
		expect(vars).toEqual([
			{ name: "CODEX_API_KEY", state: "env", inEnv: false },
			{ name: "OPENAI_API_KEY", state: "set", inEnv: true },
			{ name: "ZED", state: "set", inEnv: false },
		]);
		expect(envVarStates("codex", [], {})).toEqual([
			{ name: "CODEX_API_KEY", state: "unset", inEnv: false },
			{ name: "OPENAI_API_KEY", state: "unset", inEnv: false },
		]);
	});

	it("marks a stored key inEnv only while the host has it too (#911)", () => {
		const of = (host: NodeJS.ProcessEnv) =>
			envVarStates("codex", ["OPENAI_API_KEY"], host).find((v) => v.name === "OPENAI_API_KEY")?.inEnv;
		expect(of({ OPENAI_API_KEY: "b" })).toBe(true);
		expect(of({})).toBe(false);
		// A stored name the agent doesn't take from the host overrides nothing.
		expect(envVarStates("codex", ["ZED"], { ZED: "z" }).find((v) => v.name === "ZED")?.inEnv).toBe(false);
	});

	it("never reads a host name the agent doesn't take as From environment", () => {
		expect(envVarStates("codex", [], { ANTHROPIC_API_KEY: "x" }).map((v) => v.name)).not.toContain("ANTHROPIC_API_KEY");
	});
});

describe("HarnessService agent runtime settings (#907)", () => {
	const originalPath = process.env.PATH;
	const originalBase = process.env.ANTHROPIC_BASE_URL;
	let store: Record<string, { key: string; value: string; type: string }>;
	const credentials = {
		encryptToBase64: (v: unknown) => `enc:${Buffer.from(JSON.stringify(v)).toString("base64")}`,
		decryptFromBase64: (c: string) => JSON.parse(Buffer.from(c.slice(4), "base64").toString()),
	};
	type Row = { value: string; type: string };

	function runtimeService(check = vi.fn(async () => ({}))) {
		const models = new HarnessModelsService();
		const forget = vi.spyOn(models, "forget");
		const prisma = {
			setting: {
				findUnique: vi.fn(async ({ where }: { where: { key: string } }) => store[where.key] ?? null),
				upsert: vi.fn(async ({ where, create, update }: { where: { key: string }; create: Row; update: Row }) => {
					const prev = store[where.key];
					store[where.key] = prev ? { ...prev, ...update } : { ...create, key: where.key };
				}),
			},
			// Rolls the store back when the callback throws, as a real transaction would.
			$transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
				const before = { ...store };
				try {
					return await fn(prisma);
				} catch (err) {
					store = before;
					throw err;
				}
			}),
		};
		const svc = new HarnessService(
			prisma as unknown as PrismaService,
			models,
			{ check } as unknown as HarnessProbeService,
			credentials as never,
		);
		return { svc, models, forget, check };
	}

	beforeEach(() => {
		store = {};
		process.env.PATH = mkdtempSync(join(tmpdir(), "harness-empty-"));
		delete process.env.ANTHROPIC_BASE_URL;
	});
	afterAll(() => {
		process.env.PATH = originalPath;
		if (originalBase === undefined) delete process.env.ANTHROPIC_BASE_URL;
		else process.env.ANTHROPIC_BASE_URL = originalBase;
	});

	it("round-trips every new field, and reads env names but never values", async () => {
		const { svc } = runtimeService();
		const bin = join(pathWith("claude"), "claude");
		const dir = mkdtempSync(join(tmpdir(), "claude-work-"));
		const node = join(pathWith("node-agent"), "node-agent");
		const saved = await svc.updateSettings({
			hiddenModels: { "claude-code": ["opus"] },
			modelOrder: { "claude-code": ["sonnet", "opus"] },
			binaryPaths: { "claude-code": bin },
			configDirs: { "claude-code": dir },
			localAgent: { command: node, args: ["--acp"] },
			env: { "claude-code": { ANTHROPIC_BASE_URL: "https://b.example" } },
		});
		expect(saved).toMatchObject({
			hiddenModels: { "claude-code": ["opus"] },
			modelOrder: { "claude-code": ["sonnet", "opus"] },
			binaryPaths: { "claude-code": bin },
			configDirs: { "claude-code": dir },
			localAgent: { command: node, args: ["--acp"] },
			envNames: { "claude-code": ["ANTHROPIC_BASE_URL"] },
		});
		expect(JSON.stringify(await svc.getSettings())).not.toContain("b.example");
		expect(store.HARNESS_ENV?.type).toBe("encrypted");
		expect(store.HARNESS_ENV?.value).not.toContain("b.example");
		expect(store.HARNESS_ENV?.value).toContain("enc:");

		const { svc: failing } = runtimeService();
		const write = failing["prisma"].setting.upsert as ReturnType<typeof vi.fn>;
		write.mockImplementation(async ({ where }: { where: { key: string } }) => {
			if (where.key === "HARNESS") throw new Error("disk full");
			store[where.key] = { key: where.key, value: "partial", type: "encrypted" };
		});
		const envBefore = store.HARNESS_ENV;
		await expect(
			failing.updateSettings({ models: { "claude-code": "opus" }, env: { "claude-code": { ANTHROPIC_MODEL: "x" } } }),
		).rejects.toThrow("disk full");
		expect(store.HARNESS_ENV).toEqual(envBefore);

		const cleared = await svc.updateSettings({
			hiddenModels: { "claude-code": null },
			binaryPaths: { "claude-code": null },
			localAgent: null,
			env: { "claude-code": { ANTHROPIC_BASE_URL: null } },
		});
		expect(cleared.hiddenModels).toBeUndefined();
		expect(cleared.binaryPaths).toBeUndefined();
		expect(cleared.localAgent).toBeUndefined();
		expect(cleared.envNames).toBeUndefined();
	});

	const refusals: [string, Record<string, unknown>, string, string, boolean][] = [
		["a paired device", { binaryPaths: { codex: "/usr/bin/codex" } }, "FORBIDDEN", "Only this machine's own session can change what an agent runs.", false],
		["strict mode from a paired device", { strictEnv: false }, "FORBIDDEN", "Only this machine's own session can change what an agent runs.", false],
		["a relative path", { binaryPaths: { codex: "bin/codex" } }, "BAD_REQUEST", "Use a full path, like /usr/local/bin/claude.", true],
		["a bare name not on PATH", { localAgent: { command: "nowhere-on-path", args: [] } }, "BAD_REQUEST", "Use a full path, like /usr/local/bin/claude.", true],
		["a config dir on an agent with none", { configDirs: { opencode: "/tmp" } }, "BAD_REQUEST", "OpenCode has no config directory setting.", true],
		["a name PrismaLens sets", { env: { "claude-code": { CLAUDE_CODE_EXECUTABLE: "x" } } }, "BAD_REQUEST", "Claude Code runs get CLAUDE_CODE_EXECUTABLE from PrismaLens; it can't be set here.", true],
		["a PRISMALENS_ name", { env: { codex: { PRISMALENS_SECRET: "x" } } }, "BAD_REQUEST", "Codex runs get PRISMALENS_SECRET from PrismaLens; it can't be set here.", true],
		["the config-dir key", { env: { "claude-code": { CLAUDE_CONFIG_DIR: "/x" } } }, "BAD_REQUEST", "Set CLAUDE_CONFIG_DIR with Config directory above.", true],
		["a plain-http gateway", { env: { "claude-code": { ANTHROPIC_BASE_URL: "http://gw.example" } } }, "BAD_REQUEST", "ANTHROPIC_BASE_URL must be https unless it points at this machine: http://gw.example", true],
	];
	it.each(refusals)("refuses %s", async (_, patch, code, message, host) => {
		const { svc } = runtimeService();
		await expect(svc.updateSettings(patch, { host })).rejects.toMatchObject({ code, message });
		expect(store.HARNESS_ENV).toBeUndefined();
	});

	it("refuses a missing program and a missing folder by path", async () => {
		const { svc } = runtimeService();
		const gone = join(mkdtempSync(join(tmpdir(), "gone-")), "claude");
		await expect(svc.updateSettings({ binaryPaths: { "claude-code": gone } })).rejects.toMatchObject({
			message: `No program at ${gone}.`,
		});
		await expect(svc.updateSettings({ configDirs: { codex: gone } })).rejects.toMatchObject({
			message: `No folder at ${gone}.`,
		});
	});

	it("refuses an empty value, which would override the host's (#911)", async () => {
		const { svc } = runtimeService();
		await expect(svc.updateSettings({ env: { codex: { OPENAI_API_KEY: "" } } })).rejects.toMatchObject({
			message: "OPENAI_API_KEY needs a value. Remove clears it.",
		});
	});

	it("refuses a 51st variable", async () => {
		const { svc } = runtimeService();
		const rows = Object.fromEntries(Array.from({ length: 51 }, (_, i) => [`V${i}`, "x"]));
		await expect(svc.updateSettings({ env: { codex: rows } })).rejects.toMatchObject({
			message: "An agent takes at most 50 variables.",
		});
	});

	it("holds the config folder and Environment rows; the host's own env reaches the run through the floor (#916)", async () => {
		process.env.ANTHROPIC_BASE_URL = "https://a.example";
		const { svc } = runtimeService();
		const dir = mkdtempSync(join(tmpdir(), "claude-work-"));
		expect((await svc.runtimeFor("claude-code")).env.ANTHROPIC_BASE_URL).toBeUndefined();
		expect((await svc.runtimeFor("claude-code")).note).toBeNull();
		await svc.updateSettings({
			configDirs: { "claude-code": dir },
			env: { "claude-code": { ANTHROPIC_BASE_URL: "https://b.example" } },
		});
		const runtime = await svc.runtimeFor("claude-code");
		expect(runtime.env).toMatchObject({ ANTHROPIC_BASE_URL: "https://b.example", CLAUDE_CONFIG_DIR: dir });
		expect(runtime.note).toEqual({ binaryPath: null, configDir: dir, envNames: ["ANTHROPIC_BASE_URL"], args: [] });
		expect((await svc.runtimeFor("codex")).env.ANTHROPIC_BASE_URL).toBeUndefined();
	});

	it("counts every telemetry source token PrismaLens reads by name among its own secrets (#817)", () => {
		for (const kind of QUERY_KINDS) expect(PRISMALENS_OWN_SECRETS.names).toContain(envVars(kind).token);
	});

	it("strict mode is off by default, saved with the other settings, and gives every agent the allowlist floor (#817)", async () => {
		const { svc } = runtimeService();
		expect((await svc.getSettings()).strictEnv).toBeUndefined();
		expect((await svc.runtimeFor("codex")).policy?.floor).toMatchObject({ mode: "inherit-minus-own-secrets" });
		expect((await svc.runtimeFor("codex")).policy?.github).toBe("include");
		await svc.updateSettings({ strictEnv: true });
		expect(JSON.parse(store.HARNESS?.value ?? "{}").strictEnv).toBe(true);
		expect((await svc.getSettings()).strictEnv).toBe(true);
		expect((await svc.runtimeFor("codex")).policy?.floor).toEqual({ mode: "allowlist" });
		await svc.updateSettings({ strictEnv: false });
		expect((await svc.getSettings()).strictEnv).toBeUndefined();
	});

	it("an unsafe host gateway fails only that agent, and a saved https one fixes it (#911)", async () => {
		process.env.ANTHROPIC_BASE_URL = "http://gateway.example";
		const { svc } = runtimeService();
		const ids = (await svc.getStatus()).harnesses.map((h) => h.id);
		expect(ids).toEqual(expect.arrayContaining(["claude-code", "codex"]));
		await expect(svc.runtimeFor("claude-code")).rejects.toThrow(/must be https/);
		await svc.updateSettings({ env: { "claude-code": { ANTHROPIC_BASE_URL: "https://ok.example" } } });
		expect((await svc.runtimeFor("claude-code")).env.ANTHROPIC_BASE_URL).toBe("https://ok.example");
	});

	it("names each variable Not set, From environment or Key set; a saved value wins over the host's", async () => {
		process.env.ANTHROPIC_BASE_URL = "https://host.example";
		const { svc } = runtimeService();
		const varsOf = async () => (await svc.getStatus()).harnesses.find((h) => h.id === "claude-code")?.envVars ?? [];
		const before = await varsOf();
		expect(before).toContainEqual({ name: "ANTHROPIC_BASE_URL", state: "env", inEnv: false });
		expect(before).toContainEqual({ name: "ANTHROPIC_AUTH_TOKEN", state: "unset", inEnv: false });

		await svc.updateSettings({
			env: { "claude-code": { ANTHROPIC_BASE_URL: "https://mine.example", MY_EXTRA: "x" } },
		});
		const vars = await varsOf();
		expect(vars).toContainEqual({ name: "ANTHROPIC_BASE_URL", state: "set", inEnv: true });
		expect(vars).toContainEqual({ name: "MY_EXTRA", state: "set", inEnv: false });
		const status = JSON.stringify(await svc.getStatus());
		expect(status).not.toContain("mine.example");
		expect(status).not.toContain("host.example");
		expect((await svc.runtimeFor("claude-code")).env.ANTHROPIC_BASE_URL).toBe("https://mine.example");
	});

	it("forgets the agent's check after a runtime save, then checks it with the new runtime", async () => {
		const { svc, models, forget, check } = runtimeService();
		models.rememberCheck("codex", { outcome: "answers-acp", detail: "answers ACP", servedModel: null, effort: null, images: false });
		await svc.updateSettings({ env: { codex: { OPENAI_API_KEY: "sk-1" } } });
		expect(forget).toHaveBeenCalledWith("codex");
		await vi.waitFor(() => expect(check).toHaveBeenCalled());
		expect(check).toHaveBeenCalledWith("codex", expect.objectContaining({ env: expect.objectContaining({ OPENAI_API_KEY: "sk-1" }) }));
		await svc.updateSettings({ hiddenModels: { codex: ["gpt-5"] } });
		expect(forget).toHaveBeenCalledTimes(1);
	});

	it("marks runnable only what starts and whose last check answered", async () => {
		process.env.PATH = pathWith("opencode", "gemini");
		const { svc, models } = runtimeService();
		models.rememberCheck("gemini", { outcome: "sign-in-needed", detail: "sign in needed", servedModel: null, effort: null, images: false });
		const rows = Object.fromEntries((await svc.getStatus()).harnesses.map((h) => [h.id, h.runnable]));
		expect(rows).toMatchObject({ opencode: true, gemini: false, codex: false, local: false });
	});

	it("auto never picks an agent whose check failed; a pin to it still holds", async () => {
		process.env.PATH = pathWith("opencode", "gemini");
		const { svc, models } = runtimeService();
		models.rememberCheck("opencode", { outcome: "failed-to-start", detail: "failed to start", servedModel: null, effort: null, images: false });
		expect(await svc.resolveSelection()).toMatchObject({ runnable: true, harness: "gemini" });
		await svc.updateSettings({ harness: "opencode" });
		expect(await svc.resolveSelection()).toMatchObject({ runnable: true, harness: "opencode" });
	});

	it("a binary path that stops existing reads as not on this machine", async () => {
		const { svc } = runtimeService();
		const dir = pathWith("codex");
		await svc.updateSettings({ binaryPaths: { codex: join(dir, "codex") } });
		rmSync(join(dir, "codex"));
		expect(await svc.resolveSelection({ harness: "codex" })).toMatchObject({
			runnable: false,
			reason: expect.stringContaining("Codex is not on this machine"),
		});
	});
});
