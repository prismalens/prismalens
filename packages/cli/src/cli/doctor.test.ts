// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { chmodSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getAppDataDir, secretFileName } from "@prismalens/config";
import { HARNESS_REGISTRY } from "@prismalens/config/harness";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	checkAnyHarnessOnPath,
	checkAutoSelection,
	checkHarnessesOnPath,
	checkHarnessHandshake,
	checkWebhookToken,
} from "./doctor.js";

const FAKE_HANDSHAKE = join(
	dirname(fileURLToPath(import.meta.url)),
	"__fixtures__",
	"fake-acp-handshake.mjs",
);

describe("doctor — harness detection", () => {
	let tempPathDir: string;
	let originalPath: string | undefined;

	beforeEach(() => {
		tempPathDir = join(
			os.tmpdir(),
			`pl-doctor-${Date.now()}-${Math.random().toString(36).slice(2)}`,
		);
		mkdirSync(tempPathDir, { recursive: true });
		originalPath = process.env.PATH;
	});

	afterEach(() => {
		rmSync(tempPathDir, { recursive: true, force: true });
		if (originalPath === undefined) {
			process.env.PATH = "";
		} else {
			process.env.PATH = originalPath;
		}
	});

	it("names the model a run would ask for, and that a saved Settings pin wins (#337 run e, G11, G15)", () => {
		writeFileSync(join(tempPathDir, "opencode"), "#!/bin/sh\n");
		chmodSync(join(tempPathDir, "opencode"), 0o755);
		process.env.PATH = tempPathDir;
		delete process.env.PRISMALENS_HARNESS;

		const [selected, model] = checkAutoSelection();
		expect(selected).toMatchObject({ name: "Selected harness", pass: true });
		expect(selected?.detail).toContain("Settings → Harness");
		expect(model).toMatchObject({ name: "Model", pass: true });
		expect(model?.detail).toContain(HARNESS_REGISTRY.opencode.defaultModel);
		expect(model?.detail).toContain("Settings → Harness → Model");
	});

	it("is a HARD failure, listing every registry harness, when none is on PATH", () => {
		process.env.PATH = tempPathDir; // empty dir — nothing resolvable

		const perHarness = checkHarnessesOnPath();
		expect(perHarness.every((check) => !check.pass)).toBe(true);

		const overall = checkAnyHarnessOnPath(perHarness);
		expect(overall.pass).toBe(false);
		expect(overall.hard).toBe(true);
		// The ERROR line carries the install commands themselves, not just the ids (#337 run e, G12).
		expect(overall.detail).toContain("Install one:");
		for (const descriptor of Object.values(HARNESS_REGISTRY)) {
			expect(overall.detail).toContain(descriptor.install);
		}
	});

	it("names Claude Code when the claude binary is present and its ACP adapter is not (#650)", () => {
		writeFileSync(join(tempPathDir, "claude"), "#!/bin/sh\n");
		chmodSync(join(tempPathDir, "claude"), 0o755);
		process.env.PATH = tempPathDir;

		const row = checkHarnessesOnPath().find((c) => c.name === "Harness: Claude Code");
		expect(row?.pass).toBe(false);
		expect(row?.detail).toContain(`Claude Code found at ${join(tempPathDir, "claude")}, adapter missing`);
		expect(row?.detail).toContain("claude /login");
	});

	it("passes when a registry harness binary is on PATH", () => {
		const descriptor = Object.values(HARNESS_REGISTRY)[0];
		const binPath = join(tempPathDir, descriptor.binary);
		writeFileSync(binPath, "#!/bin/sh\nexit 0\n");
		chmodSync(binPath, 0o755);
		process.env.PATH = tempPathDir;

		const perHarness = checkHarnessesOnPath();
		const match = perHarness.find((check) =>
			check.name.includes(descriptor.label),
		);
		expect(match?.pass).toBe(true);

		const overall = checkAnyHarnessOnPath(perHarness);
		expect(overall.pass).toBe(true);
		expect(overall.hard).toBe(true);
	});
});

describe("doctor — harness ACP handshake", () => {
	let tempPathDir: string;
	let originalPath: string | undefined;

	beforeEach(() => {
		tempPathDir = join(
			os.tmpdir(),
			`pl-doctor-handshake-${Date.now()}-${Math.random().toString(36).slice(2)}`,
		);
		mkdirSync(tempPathDir, { recursive: true });
		originalPath = process.env.PATH;
		process.env.PATH = tempPathDir;
	});

	afterEach(() => {
		rmSync(tempPathDir, { recursive: true, force: true });
		if (originalPath === undefined) {
			process.env.PATH = "";
		} else {
			process.env.PATH = originalPath;
		}
	});

	/** A shell shim named after the registry binary. The mode is baked into the shim, not the parent env, which the harness child does not inherit. */
	function installFakeOpencode(mode: string): void {
		const binPath = join(tempPathDir, HARNESS_REGISTRY.opencode.binary);
		writeFileSync(
			binPath,
			`#!/bin/sh\nFAKE_ACP_MODE=${mode} exec "${process.execPath}" "${FAKE_HANDSHAKE}"\n`,
		);
		chmodSync(binPath, 0o755);
	}

	it('says "answers ACP", never "ready", for a harness whose handshake succeeds', async () => {
		installFakeOpencode("ok");
		const results = await checkHarnessHandshake();
		const opencode = results.find((c) => c.name.includes("OpenCode"));
		expect(opencode).toEqual({
			name: `Harness ACP handshake: ${HARNESS_REGISTRY.opencode.label}`,
			pass: true,
			detail: "answers ACP",
			hard: false,
		});
	});

	it("is a SOFT failure carrying the harness's own stderr tail when it exits before answering", async () => {
		installFakeOpencode("unauthenticated");
		const results = await checkHarnessHandshake();
		const opencode = results.find((c) => c.name.includes("OpenCode"));
		expect(opencode?.pass).toBe(false);
		expect(opencode?.hard).toBe(false);
		expect(opencode?.detail).toMatch(/^failed to start: .*not logged in/);
	});

	it("probes nothing when no harness is on PATH", async () => {
		const results = await checkHarnessHandshake();
		expect(results).toEqual([]);
	});
});

describe("doctor — webhook token", () => {
	let tempDir: string;
	const originalWorkspace = process.env.PRISMALENS_WORKSPACE_DIR;

	beforeEach(() => {
		tempDir = join(
			os.tmpdir(),
			`pl-doctor-token-${Date.now()}-${Math.random().toString(36).slice(2)}`,
		);
		mkdirSync(tempDir, { recursive: true });
		process.env.PRISMALENS_WORKSPACE_DIR = tempDir;
	});

	afterEach(() => {
		if (originalWorkspace === undefined) {
			delete process.env.PRISMALENS_WORKSPACE_DIR;
		} else {
			process.env.PRISMALENS_WORKSPACE_DIR = originalWorkspace;
		}
		rmSync(tempDir, { recursive: true, force: true });
	});

	it("reports webhook token file path and whether it exists without exposing the secret", () => {
		const expectedFile = join(
			tempDir,
			secretFileName("PRISMALENS_WEBHOOK_SECRET"),
		);

		// Before creation: does not exist, hard is false
		const checkBefore = checkWebhookToken();
		expect(checkBefore.name).toBe("Webhook token");
		expect(checkBefore.hard).toBe(false);
		expect(checkBefore.detail).toBe(`${expectedFile} (does not exist yet)`);

		// After creation: exists, hard is false, does NOT print the secret
		const secretValue = "super_secret_webhook_token_value_42";
		writeFileSync(expectedFile, secretValue);

		const checkAfter = checkWebhookToken();
		expect(checkAfter.name).toBe("Webhook token");
		expect(checkAfter.hard).toBe(false);
		expect(checkAfter.detail).toBe(`${expectedFile} (exists)`);
		expect(checkAfter.detail).not.toContain(secretValue);
	});
});
