// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Tests for the `srt` Sandbox provider (ADR-0020/ADR-0011). Two kinds:
 *  - HERMETIC: when srt is not resolvable (the dependency-light default — the engine
 *    has no srt dep), construction must FAIL CLEARLY, never silently degrade.
 *  - GUARDED SMOKE: when the host actually has srt (+ bwrap), a real duplex-stdio
 *    round-trip through the OS boundary. Skipped by default so the suite stays offline.
 */
import { once } from "node:events";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	__clearSrtEgressCache,
	createSrtSandbox,
	isSrtAvailable,
	probeSrtEgress,
	runEgressProbeWithWatchdog,
	SRT_EGRESS_UNHEALTHY_TTL_MS,
} from "./srt.js";

describe.skipIf(isSrtAvailable())(
	"createSrtSandbox (srt unavailable — dependency-light default)",
	() => {
		it("throws a clear, actionable error instead of degrading", () => {
			expect(() => createSrtSandbox()).toThrowError(/srt sandbox unavailable/);
			// The message must point the user at a fix (install or switch mode).
			expect(() =>
				createSrtSandbox({ allowedDomains: ["example.com"] }),
			).toThrowError(/sandbox-runtime|--sandbox process/);
		});
	},
);

// The egress SELF-CHECK (B.1.1) is exercised hermetically through its injected runner
// seam — no srt is ever spawned. Only the http-code verdict + per-target memo/TTL are
// under test here; the real srt+curl runner is covered by the guarded smoke path in prod.
describe("probeSrtEgress (egress self-check, injected runner)", () => {
	beforeEach(() => __clearSrtEgressCache());

	it("a real 3-digit HTTP code ⇒ healthy (bridge carries traffic)", async () => {
		for (const code of ["200", "204", "404", "500"]) {
			__clearSrtEgressCache();
			const runner = vi.fn(async () => code);
			await expect(
				probeSrtEgress("https://ok.example/api", { runner }),
			).resolves.toBe(true);
		}
	});

	it("curl 000 or empty output ⇒ unhealthy (dead bridge / srt|curl failed), never throws", async () => {
		for (const code of ["000", "", "  ", "not-a-code"]) {
			__clearSrtEgressCache();
			const runner = vi.fn(async () => code);
			await expect(
				probeSrtEgress("https://dead.example/api", { runner }),
			).resolves.toBe(false);
		}
	});

	it("a rejecting runner is treated as unhealthy, not a thrown probe", async () => {
		const runner = vi.fn(async () => {
			throw new Error("spawn EACCES");
		});
		await expect(
			probeSrtEgress("https://boom.example/api", { runner }),
		).resolves.toBe(false);
	});

	it("memoizes per target URL for the process lifetime (one real probe when HEALTHY)", async () => {
		const runner = vi.fn(async () => "200");
		await probeSrtEgress("https://memo.example/api", { runner });
		await probeSrtEgress("https://memo.example/api", { runner });
		expect(runner).toHaveBeenCalledTimes(1);
	});

	// FIX 5: a HEALTHY verdict is permanent; an UNHEALTHY one expires after the TTL so a
	// transient blip on a long-lived worker re-probes instead of disabling srt for days.
	it("caches a HEALTHY verdict for the process lifetime (never re-probes, even past the TTL)", async () => {
		let clock = 1_000;
		const now = () => clock;
		const runner = vi.fn(async () => "200");
		await probeSrtEgress("https://healthy.example/api", { runner, now });
		clock += SRT_EGRESS_UNHEALTHY_TTL_MS * 10;
		await expect(
			probeSrtEgress("https://healthy.example/api", { runner, now }),
		).resolves.toBe(true);
		expect(runner).toHaveBeenCalledTimes(1);
	});

	it("re-probes an UNHEALTHY verdict only after the TTL elapses", async () => {
		let clock = 1_000;
		const now = () => clock;
		const runner = vi.fn(async () => "000");
		await expect(
			probeSrtEgress("https://blip.example/api", { runner, now }),
		).resolves.toBe(false);

		// Still within the TTL → cached, no re-probe.
		clock += SRT_EGRESS_UNHEALTHY_TTL_MS - 1;
		await expect(
			probeSrtEgress("https://blip.example/api", { runner, now }),
		).resolves.toBe(false);
		expect(runner).toHaveBeenCalledTimes(1);

		// Past the TTL → the verdict is stale, so it re-probes (and now recovers).
		clock += 2;
		runner.mockResolvedValue("200");
		await expect(
			probeSrtEgress("https://blip.example/api", { runner, now }),
		).resolves.toBe(true);
		expect(runner).toHaveBeenCalledTimes(2);
	});
});

// FIX 4: the overall watchdog inside the production runner — a wedged srt mux (the exact
// WSL blackout failure) must be SIGKILLed and read as unhealthy, never hang the probe.
describe("runEgressProbeWithWatchdog (overall watchdog)", () => {
	it("SIGKILLs a never-closing child after the timeout and resolves unhealthy", async () => {
		let killedSignal: string | undefined;
		const code = await runEgressProbeWithWatchdog(
			// A child that NEVER calls finish (mimics a wedged srt mux).
			() => ({
				kill: (signal?: string) => {
					killedSignal = signal;
				},
			}),
			5,
		);
		expect(code).toBe("");
		expect(killedSignal).toBe("SIGKILL");
	});

	it("resolves the child's code when it closes before the watchdog fires (timer cleared)", async () => {
		const code = await runEgressProbeWithWatchdog((finish) => {
			setTimeout(() => finish("204"), 1);
			return { kill: () => {} };
		}, 10_000);
		expect(code).toBe("204");
	});

	it("a synchronous throw from spawnChild resolves unhealthy, never rejects", async () => {
		await expect(
			runEgressProbeWithWatchdog(() => {
				throw new Error("spawn EACCES");
			}),
		).resolves.toBe("");
	});
});

// A tiny JSON-RPC-over-stdio child (shaped like the ACP harness): read one line,
// echo it back, exit. Proves the duplex channel survives the srt/bwrap boundary.
const ECHO_HARNESS = `
const rl = require("node:readline").createInterface({ input: process.stdin });
rl.on("line", (l) => { process.stdout.write("ECHO:" + l + "\\n"); process.exit(0); });
`;

describe.skipIf(!isSrtAvailable())(
	"createSrtSandbox (real srt round-trip)",
	() => {
		it("holds a duplex stdio channel to a child inside the boundary", async () => {
			const cwd = mkdtempSync(join(tmpdir(), "srt-smoke-"));
			const harness = join(cwd, "echo-harness.js");
			writeFileSync(harness, ECHO_HARNESS);

			const sandbox = createSrtSandbox();
			expect(sandbox.id).toBe("srt");
			expect(sandbox.fidelity).toBe("enforced");
			try {
				const child = sandbox.spawn(process.execPath, [harness], { cwd });
				const chunks: Buffer[] = [];
				child.stdout.on("data", (d: Buffer) => chunks.push(d));
				child.stdin.write("ping-line\n");
				await once(child, "close");
				expect(Buffer.concat(chunks).toString()).toContain("ECHO:ping-line");
			} finally {
				await sandbox.destroy();
			}
		}, 60_000);
	},
);
