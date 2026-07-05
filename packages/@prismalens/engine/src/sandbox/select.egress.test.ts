/**
 * Hermetic tests for `auto`'s EGRESS SELF-CHECK (ADR-0020 B.1.1): the gate that makes
 * flipping the default to `auto` honest. srt is NOT installed in CI, and we never want to
 * spawn it here, so this file MOCKS srt's availability + construction and injects the
 * egress RUNNER seam — `probeSrtEgress` itself stays REAL (its per-target memoization is
 * under test). Separate file from `select.test.ts` because `vi.mock` is file-scoped: the
 * sibling suite deliberately exercises REAL srt availability.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// Force srt "available" + return a throwaway fake boundary from construction, so the gate
// logic runs deterministically without a real srt install. The fake never spawns.
vi.mock("./srt.js", async (importActual) => {
	const actual = await importActual<typeof import("./srt.js")>();
	return {
		...actual,
		isSrtAvailable: vi.fn(() => true),
		createSrtSandbox: vi.fn(() => ({
			id: "srt",
			fidelity: "enforced",
			spawn: () => {
				throw new Error("not spawned in hermetic egress tests");
			},
			destroy: async () => {},
		})),
	};
});

import { resolveSandbox } from "./select.js";
import { __clearSrtEgressCache, isSrtAvailable } from "./srt.js";

const availabilityMock = vi.mocked(isSrtAvailable);

describe("resolveSandbox — auto egress self-check (B.1.1)", () => {
	beforeEach(() => {
		// Fresh memo + default-available before each case (they mutate both).
		__clearSrtEgressCache();
		availabilityMock.mockReturnValue(true);
	});

	it("srt binary absent → floor with reason, never probes", async () => {
		availabilityMock.mockReturnValue(false);
		const runner = vi.fn(async () => "200");
		const sel = await resolveSandbox("auto", {
			probeUrl: "https://needs-egress.example/api",
			egressRunner: runner,
		});
		expect(sel.actual).toBe("process-floor");
		expect(sel.degradeReason).toBe("srt unavailable");
		expect(runner).not.toHaveBeenCalled();
		await sel.sandbox.destroy();
	});

	it("srt present + NO probeUrl → floor with the starve reason, never probes (FIX 6)", async () => {
		const runner = vi.fn(async () => "200");
		const omitted = await resolveSandbox("auto", { egressRunner: runner });
		expect(omitted.actual).toBe("process-floor");
		expect(omitted.degradeReason).toMatch(/no egress allowlist derivable/);

		// An allowlist without a probeUrl still floors — the LIVE-boundary allowlist is not
		// a probe target; only a real probeUrl gates srt.
		const allowlistOnly = await resolveSandbox("auto", {
			allowedDomains: ["telemetry.example"],
			egressRunner: runner,
		});
		expect(allowlistOnly.actual).toBe("process-floor");
		expect(allowlistOnly.degradeReason).toMatch(
			/no egress allowlist derivable/,
		);

		// The seam must NEVER fire when there is nothing real to probe.
		expect(runner).not.toHaveBeenCalled();
		await omitted.sandbox.destroy();
		await allowlistOnly.sandbox.destroy();
	});

	it("srt present + probeUrl + HEALTHY bridge → srt", async () => {
		const runner = vi.fn(async () => "204");
		const sel = await resolveSandbox("auto", {
			probeUrl: "https://healthy.example/metrics",
			allowedDomains: ["healthy.example", "second.example"],
			egressRunner: runner,
		});
		expect(sel.actual).toBe("srt");
		expect(sel.degradeReason).toBeUndefined();
		// Probes the REAL probeUrl the caller chose, not a fabricated host root.
		expect(runner).toHaveBeenCalledTimes(1);
		expect(runner).toHaveBeenCalledWith("https://healthy.example/metrics");
		await sel.sandbox.destroy();
	});

	it("srt present + probeUrl + DEAD bridge (000) → floor with degradeReason", async () => {
		const runner = vi.fn(async () => "000");
		const sel = await resolveSandbox("auto", {
			probeUrl: "https://dead.example/api",
			egressRunner: runner,
		});
		expect(sel.actual).toBe("process-floor");
		expect(sel.sandbox.fidelity).toBe("cooperative");
		expect(sel.degradeReason).toMatch(/egress bridge unhealthy/);
		expect(runner).toHaveBeenCalledTimes(1);
		await sel.sandbox.destroy();
	});

	it("srt present + probeUrl + empty probe output (srt/curl failed) → floor", async () => {
		const runner = vi.fn(async () => "");
		const sel = await resolveSandbox("auto", {
			probeUrl: "https://broken.example/api",
			egressRunner: runner,
		});
		expect(sel.actual).toBe("process-floor");
		expect(sel.degradeReason).toMatch(/egress bridge unhealthy/);
		await sel.sandbox.destroy();
	});

	it("memoizes the probe per target URL — a second resolve does NOT re-invoke the seam", async () => {
		const runner = vi.fn(async () => "200");
		const first = await resolveSandbox("auto", {
			probeUrl: "https://memo.example/api",
			egressRunner: runner,
		});
		const second = await resolveSandbox("auto", {
			probeUrl: "https://memo.example/api",
			egressRunner: runner,
		});
		expect(first.actual).toBe("srt");
		expect(second.actual).toBe("srt");
		// The WSL networking mode does not change mid-run → one real probe per target URL.
		expect(runner).toHaveBeenCalledTimes(1);
		await first.sandbox.destroy();
		await second.sandbox.destroy();
	});

	it("explicit srt NEVER probes (validated opt-in — the user's call)", async () => {
		const runner = vi.fn(async () => "000");
		const sel = await resolveSandbox("srt", {
			probeUrl: "https://whatever.example/api",
			egressRunner: runner,
		});
		expect(sel.actual).toBe("srt");
		expect(sel.degradeReason).toBeUndefined();
		expect(runner).not.toHaveBeenCalled();
		await sel.sandbox.destroy();
	});
});
