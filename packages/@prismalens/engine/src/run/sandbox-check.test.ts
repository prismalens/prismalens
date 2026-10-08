// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { chmodSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	checkSandbox,
	locateCodex,
	managedSandboxEnabled,
	type ProbeRunner,
	probeCodexSandbox,
	readCodexProbe,
} from "./sandbox-check.js";

const tmp = (name: string) => mkdtempSync(join(tmpdir(), `pl-sbx-${name}-`));
const codex = () => ({ command: "/opt/codex", args: [], standIn: false });

/** A fake `codex sandbox` run: it echoes the marker and writes the target unless the sandbox refuses. */
function fakeRun(refuse: boolean, seen: Parameters<ProbeRunner>[] = []): ProbeRunner {
	return async (command, args, opts) => {
		seen.push([command, args, opts]);
		if (!refuse) writeFileSync(args.at(-1) as string, "x");
		return { stdout: "pl-sandbox-ran\n", stderr: refuse ? "Read-only file system" : "", timedOut: false };
	};
}

describe("readCodexProbe", () => {
	const ran = { stdout: "pl-sandbox-ran\n", stderr: "", timedOut: false };
	it("calls a refused write enforced, and a write that landed none", () => {
		expect(readCodexProbe({ ...ran, wrote: false }, 5000, false)).toEqual({
			state: "enforced",
			reason: "Codex's sandbox refused a test write outside the workspace",
		});
		expect(readCodexProbe({ ...ran, wrote: true }, 5000, true)).toEqual({
			state: "none",
			reason: "Codex's sandbox let a test write outside the workspace through (checked with the codex on PATH)",
		});
	});

	it("never calls a check that did not run enforced", () => {
		expect(readCodexProbe({ ...ran, timedOut: true, wrote: false }, 5000, false)).toEqual({
			state: "unknown",
			reason: "Codex's sandbox check got no answer in 5s",
		});
		expect(readCodexProbe({ ...ran, error: "spawn ENOENT", wrote: false }, 5000, false).state).toBe("unknown");
		expect(
			readCodexProbe({ stdout: "", stderr: "error: unexpected argument '-P'\nUsage: codex sandbox", timedOut: false, wrote: false }, 5000, false),
		).toEqual({ state: "unknown", reason: "Codex's sandbox did not run the check: Usage: codex sandbox" });
	});
});

describe("probeCodexSandbox", () => {
	it("runs a read-only write outside the workspace under the run's env", async () => {
		const seen: Parameters<ProbeRunner>[] = [];
		const result = await probeCodexSandbox({ locateCodex: codex, run: fakeRun(true, seen), env: { CODEX_HOME: "/x/codex" }, platform: "linux" });
		expect(result.state).toBe("enforced");
		const [command, args, opts] = seen[0] ?? [];
		expect(command).toBe("/opt/codex");
		expect(args?.slice(0, 5)).toEqual(["sandbox", "-P", ":read-only", "-C", opts?.cwd]);
		expect(args?.at(-1)).not.toContain(opts?.cwd ?? "?");
		expect(opts?.env.CODEX_HOME).toBe("/x/codex");
	});

	it("says none when the write lands, unknown without a codex or on Windows", async () => {
		expect((await probeCodexSandbox({ locateCodex: codex, run: fakeRun(false), platform: "linux" })).state).toBe("none");
		expect(await probeCodexSandbox({ locateCodex: () => null, platform: "linux" })).toEqual({
			state: "unknown",
			reason: "No codex binary found to check its sandbox with",
		});
		expect((await probeCodexSandbox({ locateCodex: codex, platform: "win32" })).state).toBe("unknown");
	});
});

describe("locateCodex", () => {
	it("prefers the codex bundled with codex-acp over the one on PATH", () => {
		const root = tmp("pkg");
		const pkg = join(root, "lib", "codex-acp");
		mkdirSync(join(pkg, "dist"), { recursive: true });
		writeFileSync(join(pkg, "package.json"), JSON.stringify({ name: "@agentclientprotocol/codex-acp" }));
		writeFileSync(join(pkg, "dist", "index.js"), "");
		chmodSync(join(pkg, "dist", "index.js"), 0o755);
		const bundled = join(pkg, "node_modules", "@openai", "codex");
		mkdirSync(join(bundled, "bin"), { recursive: true });
		writeFileSync(join(bundled, "package.json"), JSON.stringify({ name: "@openai/codex" }));
		writeFileSync(join(bundled, "bin", "codex.js"), "");
		const bin = join(root, "bin");
		mkdirSync(bin);
		symlinkSync(join(pkg, "dist", "index.js"), join(bin, "codex-acp"));
		writeFileSync(join(bin, "codex"), "");
		chmodSync(join(bin, "codex"), 0o755);
		expect(locateCodex(bin)).toEqual({ command: process.execPath, args: [join(bundled, "bin", "codex.js")], standIn: false });
		const onlyCodex = tmp("path");
		writeFileSync(join(onlyCodex, "codex"), "");
		chmodSync(join(onlyCodex, "codex"), 0o755);
		expect(locateCodex(onlyCodex)).toEqual({ command: join(onlyCodex, "codex"), args: [], standIn: true });
		expect(locateCodex(tmp("empty"))).toBeNull();
	});
});

describe("checkSandbox", () => {
	it("probes Codex once for its sandboxed modes, and calls full access none", async () => {
		let probes = 0;
		const run: ProbeRunner = async (...a) => {
			probes++;
			return fakeRun(true)(...a);
		};
		const checks = await checkSandbox("codex", ["read-only", "workspace-write", "agent", "agent-full-access"], { locateCodex: codex, run, platform: "linux" });
		expect(probes).toBe(1);
		expect(checks["read-only"]?.state).toBe("enforced");
		expect(checks.agent?.state).toBe("enforced");
		expect(checks["agent-full-access"]).toEqual({ state: "none", reason: "Full access runs Codex outside its sandbox" });
	});

	it("says plainly where there is no sandbox, and never enforced without a probe", async () => {
		expect(await checkSandbox("opencode", ["plan", "build"])).toEqual({
			plan: { state: "none", reason: "OpenCode has no sandbox" },
			build: { state: "none", reason: "OpenCode has no sandbox" },
		});
		expect((await checkSandbox("deepagents", ["agent-default"]))["agent-default"]?.state).toBe("none");
		expect((await checkSandbox("gemini", ["plan"])).plan?.state).toBe("unknown");
		const off = await checkSandbox("claude-code", ["plan", "default"], { claudeManagedDir: tmp("none") });
		expect(off.plan).toEqual({ state: "none", reason: "PrismaLens starts Claude Code without your settings files, so its sandbox is off" });
	});

	it("reads Claude Code's managed settings, drop-ins last, and calls an enabled sandbox unknown", async () => {
		const dir = tmp("managed");
		writeFileSync(join(dir, "managed-settings.json"), JSON.stringify({ sandbox: { enabled: true } }));
		expect(managedSandboxEnabled(dir)).toBe(true);
		const checks = await checkSandbox("claude-code", ["default"], { claudeManagedDir: dir });
		expect(checks.default?.state).toBe("unknown");
		mkdirSync(join(dir, "managed-settings.d"));
		writeFileSync(join(dir, "managed-settings.d", "20-off.json"), JSON.stringify({ sandbox: { enabled: false } }));
		expect(managedSandboxEnabled(dir)).toBe(false);
		expect(managedSandboxEnabled(null)).toBe(false);
	});
});
