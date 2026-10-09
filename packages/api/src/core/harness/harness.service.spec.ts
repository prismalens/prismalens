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
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PrismaService } from "../prisma/prisma.service.js";
import { HarnessService } from "./harness.service.js";
import { HarnessModelsService } from "./harness-models.service.js";
import type { HarnessProbeService } from "./harness-probe.service.js";

const mockPrismaService = {
	setting: {
		findUnique: vi.fn(),
		upsert: vi.fn(),
	},
};

/** A PATH containing exactly the named binaries (registry `binary` values, not ids). */
function pathWith(...binaries: string[]): string {
	const dir = mkdtempSync(join(tmpdir(), "harness-path-"));
	for (const bin of binaries) {
		const file = join(dir, bin);
		writeFileSync(file, "#!/bin/sh\nexit 0\n");
		chmodSync(file, 0o755);
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

		it("a stored {agentModes: {'claude-code':'plan', codex:'agent'}} reads back without claude-code", async () => {
			mockPrismaService.setting.findUnique.mockResolvedValue(
				settingRow({
					harness: "auto",
					agentModes: { "claude-code": "plan", codex: "agent" },
				}),
			);
			await expect(service().getSettings()).resolves.toEqual({
				harness: "auto",
				agentModes: { codex: "agent" },
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

		it("merges agent modes per harness, null going back to the row's default, and drops a stored allowWriteLevels (#673 w21)", async () => {
			mockPrismaService.setting.findUnique.mockResolvedValue(
				settingRow({ harness: "auto", agentModes: { codex: "agent", opencode: "build" }, allowWriteLevels: true }),
			);
			await expect(
				service().updateSettings({ agentModes: { "claude-code": "acceptEdits", opencode: null } }),
			).resolves.toEqual({ harness: "auto", agentModes: { codex: "agent", "claude-code": "acceptEdits" } });
		});

		it("updateSettings with agentModes {opencode:'plan'} stores none for opencode", async () => {
			mockPrismaService.setting.findUnique.mockResolvedValue(
				settingRow({ harness: "auto", agentModes: {} }),
			);
			const result = await service().updateSettings({
				agentModes: { opencode: "plan" },
			});
			expect(result.agentModes).toBeUndefined();
			const call = mockPrismaService.setting.upsert.mock.calls[0][0];
			expect(JSON.parse(call.create.value).agentModes).toBeUndefined();
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
			expect(status.selection.blockedReason).toMatch(/not on PATH/i);
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
