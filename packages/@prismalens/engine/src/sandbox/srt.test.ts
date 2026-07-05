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
import { describe, expect, it } from "vitest";
import { createSrtSandbox, isSrtAvailable } from "./srt.js";

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
