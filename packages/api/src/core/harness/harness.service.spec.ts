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
import { HarnessService } from "./harness.service.js";

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

		it("returns the persisted pin and model", async () => {
			mockPrismaService.setting.findUnique.mockResolvedValue(
				settingRow({ harness: "opencode", model: "zen/free" }),
			);
			await expect(service().getSettings()).resolves.toEqual({
				harness: "opencode",
				model: "zen/free",
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
	});

	describe("updateSettings", () => {
		it("merges the patch over what is stored and upserts it", async () => {
			mockPrismaService.setting.findUnique.mockResolvedValue(
				settingRow({ harness: "opencode", model: "zen/free" }),
			);

			const next = await service().updateSettings({ harness: "codex" });

			expect(next).toEqual({ harness: "codex", model: "zen/free" });
			const call = mockPrismaService.setting.upsert.mock.calls[0][0];
			expect(call.where).toEqual({ key: "HARNESS" });
			expect(JSON.parse(call.create.value)).toEqual({
				harness: "codex",
				model: "zen/free",
			});
			expect(call.create.category).toBe("ai");
		});

		it("keeps the stored pin when only the model is patched", async () => {
			mockPrismaService.setting.findUnique.mockResolvedValue(
				settingRow({ harness: "opencode" }),
			);

			await expect(
				service().updateSettings({ model: "anthropic/claude" }),
			).resolves.toEqual({ harness: "opencode", model: "anthropic/claude" });
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
			// The env pin short-circuits before the persisted value is ever read.
			expect(mockPrismaService.setting.findUnique).not.toHaveBeenCalled();
		});

		it("uses the persisted pin when no env pin is set", async () => {
			process.env.PATH = pathWith("codex-acp");
			mockPrismaService.setting.findUnique.mockResolvedValue(
				settingRow({ harness: "codex" }),
			);

			// `codex` is unverified, so auto detection would never choose it —
			// reaching it proves the persisted pin was applied.
			await expect(service().resolveSelection()).resolves.toMatchObject({
				runnable: true,
				harness: "codex",
				auto: false,
			});
		});

		it("auto-detects the verified row on PATH when nothing is pinned", async () => {
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
