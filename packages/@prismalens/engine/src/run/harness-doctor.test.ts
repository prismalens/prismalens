// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { prismalensLaunchPolicy } from "../launch/policy.js";
import {
	answeredDetail,
	classify,
	probeHarness,
	versionOf,
} from "./harness-doctor.js";

afterEach(() => {
	vi.unstubAllEnvs();
});

const FAKE = join(
	dirname(fileURLToPath(import.meta.url)),
	"__fixtures__",
	"fake-acp-harness.mjs",
);

function descriptor(mode: string, binary = process.execPath) {
	return {
		binary,
		acpArgs: () => [FAKE],
		acpEnv: () => ({ FAKE_ACP_MODE: mode }),
		configFiles: () => ({}),
	};
}

describe("probeHarness", () => {
	it('says "answers ACP", never "ready", after initialize + session/new', async () => {
		const result = await probeHarness("opencode", {
			descriptor: descriptor("ok"),
		});
		expect(result).toEqual({
			id: "opencode",
			outcome: "answers-acp",
			detail: "answers ACP, fake 0",
			hard: false,
			version: "0",
			companionVersion: null,
			// What it reported of itself, for the picker (R4.2, R4.3): nothing here.
			servedModel: null,
			effort: null,
			modes: null,
			efforts: null,
			images: false,
			sandbox: { "agent-default": { state: "none", reason: "OpenCode has no sandbox" } },
		});
		expect(result.detail).not.toMatch(/ready/i);
	});

	describe("sign-in pushed on _auth/status_update (#831)", () => {
		const withAuth = (env: Record<string, string>) => ({
			...descriptor("ok"),
			acpEnv: () => ({ FAKE_ACP_MODE: "ok", ...env }),
		});

		it("reports signed out when the push says kind none, even after session/new", async () => {
			const result = await probeHarness("claude-code", {
				descriptor: withAuth({ FAKE_AUTH_STATUS: "none", FAKE_AUTH_DELAY_MS: "300" }),
				sandbox: async () => ({}),
			});
			expect(result.outcome).toBe("answers-acp");
			expect(result.signedOut).toBe(true);
		});

		it("reports signed in for any other kind", async () => {
			const result = await probeHarness("claude-code", {
				descriptor: withAuth({ FAKE_AUTH_STATUS: "account" }),
				sandbox: async () => ({}),
			});
			expect(result.signedOut).toBe(false);
		});

		it("says nothing when the agent advertises the extension but pushes nothing in time", async () => {
			const result = await probeHarness("claude-code", {
				descriptor: withAuth({ FAKE_AUTH_STATUS: "silent" }),
				sandbox: async () => ({}),
				authWaitMs: 100,
			});
			expect(result.outcome).toBe("answers-acp");
			expect(result).not.toHaveProperty("signedOut");
		});
	});

	it("checks the sandbox once per offered mode, with the run's env (#673 w51)", async () => {
		const calls: { harness: string; modes: readonly string[]; env?: NodeJS.ProcessEnv }[] = [];
		const result = await probeHarness("codex", {
			descriptor: {
				...descriptor("ok"),
				acpEnv: () => ({ FAKE_ACP_MODE: "ok", FAKE_MODES: "read-only,agent-full-access" }),
			},
			sandbox: async (harness, modes, opts) => {
				calls.push({ harness, modes, env: opts?.env });
				return { "read-only": { state: "enforced", reason: "refused" } };
			},
		});
		expect(calls).toHaveLength(1);
		expect(calls[0]).toMatchObject({ harness: "codex", modes: ["read-only", "agent-full-access"] });
		expect(calls[0]?.env?.FAKE_ACP_MODE).toBe("ok");
		expect(result.sandbox).toEqual({ "read-only": { state: "enforced", reason: "refused" } });
	});

	it("lists the agent's own modes and effort levels by name (#673 w21)", async () => {
		const result = await probeHarness("opencode", {
			descriptor: {
				...descriptor("ok"),
				acpEnv: () => ({ FAKE_ACP_MODE: "ok", FAKE_MODES: "default=Manual,plan=Plan", FAKE_EFFORTS: "low,high" }),
			},
		});
		expect(result.modes).toEqual([
			{ id: "default", name: "Manual" },
			{ id: "plan", name: "Plan" },
		]);
		expect(result.efforts).toEqual([
			{ id: "low", name: "low", default: true },
			{ id: "high", name: "high", default: false },
		]);
	});

	it('says "sign in needed" with the auth method names on ACP -32000', async () => {
		const result = await probeHarness("opencode", {
			descriptor: descriptor("auth-required"),
		});
		expect(result).toEqual({
			id: "opencode",
			outcome: "sign-in-needed",
			detail: "sign in needed (Log in with Fake)",
			hard: false,
		});
	});

	it("reads the companion CLI's version when the agent needs a sign-in (w8-8)", async () => {
		const dir = mkdtempSync(join(tmpdir(), "pl-companion-"));
		try {
			const cli = join(dir, "fake-cli");
			writeFileSync(cli, '#!/bin/sh\necho "fake-cli 0.162.1"\n');
			chmodSync(cli, 0o755);
			vi.stubEnv("PATH", `${dir}:${process.env.PATH ?? ""}`);
			const result = await probeHarness("codex", {
				descriptor: {
					...descriptor("auth-required"),
					companionBinary: "fake-cli",
					acpEnv: ({ companionPath }) => ({
						FAKE_ACP_MODE: "auth-required",
						...(companionPath ? { CODEX_PATH: companionPath } : {}),
					}),
				},
			});
			expect(result).toMatchObject({
				outcome: "sign-in-needed",
				companionVersion: "0.162.1",
			});
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("maps Codex missing-key start error to sign in needed (API Key, ChatGPT)", () => {
		const probed = {
			outcome: "failed-to-start" as const,
			detail:
				'Internal error: CODEX_API_KEY or OPENAI_API_KEY is not set — {"envVars":["CODEX_API_KEY","OPENAI_API_KEY"]}',
			authMethods: [],
		};
		expect(classify(probed)).toEqual({
			outcome: "sign-in-needed",
			detail: "sign in needed (API Key, ChatGPT)",
		});
	});

	it('says "no answer in Ns" when the harness never answers the handshake', async () => {
		const result = await probeHarness("opencode", {
			descriptor: descriptor("hang"),
			timeoutMs: 300,
		});
		expect(result).toEqual({
			id: "opencode",
			outcome: "no-answer",
			detail: "no answer in 1s",
			hard: false,
		});
	});

	it('says "failed to start" when the binary cannot be spawned', async () => {
		const result = await probeHarness("opencode", {
			descriptor: descriptor("ok", "/nonexistent/pl-harness-binary"),
		});
		expect(result.outcome).toBe("failed-to-start");
		// ENOENT from spawn; cross-spawn's cmd.exe says so in its own words on Windows.
		expect(result.detail).toMatch(/^failed to start: .*(ENOENT|cannot find the path)/);
	});

	it('says "failed to start" with the stderr tail when the harness exits before answering', async () => {
		const result = await probeHarness("opencode", {
			descriptor: descriptor("unauthenticated"),
		});
		expect(result.outcome).toBe("failed-to-start");
		expect(result.detail).toMatch(/^failed to start: .*not logged in/);
		expect(result.detail).not.toMatch(/\n/);
	});

	it("hands the harness the env a run would get: the user's minus PrismaLens's own, or named ones in strict mode (#817)", async () => {
		vi.stubEnv("AWS_SECRET_ACCESS_KEY", "planted-aws");
		vi.stubEnv("ANTHROPIC_API_KEY", "planted-anthropic");
		vi.stubEnv("PRISMALENS_ENCRYPTION_KEY", "planted-pl");
		const probe = (strict: boolean) =>
			probeHarness("claude-code", {
				descriptor: {
					...descriptor("print-env"),
					acpEnv: () => ({
						FAKE_ACP_MODE: "print-env",
						FAKE_ENV_PROBE:
							"AWS_SECRET_ACCESS_KEY,ANTHROPIC_API_KEY,PRISMALENS_ENCRYPTION_KEY",
					}),
				},
				policy: prismalensLaunchPolicy({ strict }),
			});
		const inherit = await probe(false);
		expect(inherit.detail).toMatch(/AWS_SECRET_ACCESS_KEY=set/);
		expect(inherit.detail).toMatch(/ANTHROPIC_API_KEY=set/);
		expect(inherit.detail).toMatch(/PRISMALENS_ENCRYPTION_KEY=unset/);
		const strict = await probe(true);
		expect(strict.detail).toMatch(/AWS_SECRET_ACCESS_KEY=unset/);
		expect(strict.detail).toMatch(/ANTHROPIC_API_KEY=set/);
		expect(strict.detail).toMatch(/PRISMALENS_ENCRYPTION_KEY=unset/);
	});

	it("holds one deadline across initialize and session/new", async () => {
		const started = Date.now();
		const result = await probeHarness("opencode", {
			descriptor: {
				...descriptor("slow-init"),
				acpEnv: () => ({ FAKE_ACP_MODE: "slow-init", FAKE_INIT_DELAY_MS: "300" }),
			},
			timeoutMs: 400,
		});
		expect(result.outcome).toBe("no-answer");
		// Per-request timeouts would take about 300 + 400 ms.
		expect(Date.now() - started).toBeLessThan(600);
	});
});

describe("answeredDetail", () => {
	it("names the shipped adapter when the run went through it (#831 w6-3)", () => {
		expect(
			answeredDetail("codex", { name: "codex-acp", version: "1.13.1" }, true),
		).toBe("answers ACP through the adapter PrismaLens ships, codex-acp 1.13.1");
		expect(
			answeredDetail("opencode", { name: "opencode", version: "1.18.30" }, false),
		).toBe("answers ACP, opencode 1.18.30");
		expect(answeredDetail("opencode", {}, false)).toBe("answers ACP");
	});
});

describe("versionOf", () => {
	it("Given an executable script, When versionOf runs, Then it returns 1.2.3 for a script printing 'tool 1.2.3 (x)' and null for one that exits 1", async () => {
		const dir = mkdtempSync(join(tmpdir(), "pl-version-test-"));
		const scriptOk = join(dir, "tool-ok.sh");
		const scriptFail = join(dir, "tool-fail.sh");
		try {
			writeFileSync(scriptOk, '#!/bin/sh\necho "tool 1.2.3 (x)"\n');
			chmodSync(scriptOk, 0o755);
			writeFileSync(scriptFail, "#!/bin/sh\nexit 1\n");
			chmodSync(scriptFail, 0o755);

			expect(await versionOf(scriptOk)).toBe("1.2.3");
			expect(await versionOf(scriptFail)).toBeNull();
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("versionOf on Windows (#902)", () => {
	it.runIf(process.platform === "win32")(
		"resolves version for tool.cmd including in paths with spaces",
		async () => {
			const dir = mkdtempSync(join(tmpdir(), "pl-version-test-"));
			const spaceDir = mkdtempSync(join(tmpdir(), "pl version space-"));
			try {
				const toolCmd = join(dir, "tool.cmd");
				writeFileSync(toolCmd, "@echo tool 4.5.6 (x)\r\n");
				expect(await versionOf(toolCmd)).toBe("4.5.6");

				const spaceCmd = join(spaceDir, "tool.cmd");
				writeFileSync(spaceCmd, "@echo tool 4.5.6 (x)\r\n");
				expect(await versionOf(spaceCmd)).toBe("4.5.6");
			} finally {
				rmSync(dir, { recursive: true, force: true });
				rmSync(spaceDir, { recursive: true, force: true });
			}
		},
	);

	it.runIf(process.platform === "win32")(
		"emits no DEP0190 warning when executing a .cmd",
		async () => {
			const dir = mkdtempSync(join(tmpdir(), "pl-version-warning-"));
			const toolCmd = join(dir, "tool.cmd");
			writeFileSync(toolCmd, "@echo tool 4.5.6 (x)\r\n");
			const warnings: (Error & { code?: string })[] = [];
			const onWarning = (w: Error & { code?: string }) => warnings.push(w);
			process.on("warning", onWarning);
			try {
				await versionOf(toolCmd);
				await new Promise((resolve) => setImmediate(resolve));
				expect(warnings.filter((w) => w.code === "DEP0190")).toHaveLength(0);
			} finally {
				process.removeListener("warning", onWarning);
				rmSync(dir, { recursive: true, force: true });
			}
		},
	);
});
