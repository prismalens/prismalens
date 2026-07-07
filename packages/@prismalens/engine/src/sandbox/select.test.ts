/**
 * Tests for the Sandbox selection layer (ADR-0020 defaults + ADR-0017 honest
 * fidelity): the returned `requested`/`actual` pair must make a degrade visible, and
 * an explicit `srt` request must throw (never silently downgrade) when srt is missing.
 * Hermetic — the srt-dependent assertions are gated on real availability.
 */
import { describe, expect, it } from "vitest";
import { isE2bAvailable } from "./e2b.js";
import { resolveSandbox, SANDBOX_MODES } from "./select.js";
import { isSrtAvailable } from "./srt.js";

describe("resolveSandbox", () => {
	it("process → the cooperative floor, honestly labelled", async () => {
		const sel = await resolveSandbox("process");
		expect(sel.requested).toBe("process");
		expect(sel.actual).toBe("process-floor");
		expect(sel.sandbox.id).toBe("process-floor");
		expect(sel.sandbox.fidelity).toBe("cooperative");
		await sel.sandbox.destroy();
	});

	it("exposes the selectable modes", () => {
		expect([...SANDBOX_MODES]).toEqual(["auto", "process", "srt", "e2b"]);
	});

	// E2B is EXPLICIT-ONLY (ADR-0020 cloud row): `auto` must never reach for it — it
	// needs an API key, so selecting it on a laptop would be wrong. `auto` only ever
	// yields srt or the floor, so its `actual` can never be "e2b".
	describe.skipIf(isE2bAvailable())("when E2B is unavailable", () => {
		it("e2b rejects with a clear, actionable error (never silently downgrades)", async () => {
			await expect(resolveSandbox("e2b")).rejects.toThrowError(
				/e2b sandbox unavailable/,
			);
		});
	});

	it("auto never selects the explicit-only e2b provider", async () => {
		const sel = await resolveSandbox("auto");
		expect(sel.actual).not.toBe("e2b");
		expect(["srt", "process-floor"]).toContain(sel.actual);
		await sel.sandbox.destroy();
	});

	describe.skipIf(isSrtAvailable())("when srt is unavailable", () => {
		it("auto degrades to the floor with actual=process-floor + a reason", async () => {
			// No allowlist ⇒ the binary-absence gate fires before any egress probe.
			const sel = await resolveSandbox("auto");
			expect(sel.requested).toBe("auto");
			expect(sel.actual).toBe("process-floor");
			expect(sel.sandbox.fidelity).toBe("cooperative");
			expect(sel.degradeReason).toBe("srt unavailable");
			await sel.sandbox.destroy();
		});

		it("srt rejects (never silently downgrades an explicit request)", async () => {
			await expect(resolveSandbox("srt")).rejects.toThrowError(
				/srt sandbox unavailable/,
			);
		});
	});

	describe.skipIf(!isSrtAvailable())("when srt is available", () => {
		it("auto without a probeUrl floors (no egress allowlist derivable); explicit srt is enforced", async () => {
			// No probeUrl ⇒ an enforced zero-egress boundary would starve the harness, so
			// `auto` floors with the honest reason (FIX 6) rather than standing srt up blind.
			const auto = await resolveSandbox("auto");
			expect(auto.actual).toBe("process-floor");
			expect(auto.sandbox.fidelity).toBe("cooperative");
			expect(auto.degradeReason).toMatch(/no egress allowlist derivable/);
			await auto.sandbox.destroy();

			// Explicit `srt` keeps today's zero-egress behaviour — the user's call, no probe.
			const srt = await resolveSandbox("srt");
			expect(srt.requested).toBe("srt");
			expect(srt.actual).toBe("srt");
			await srt.sandbox.destroy();
		});
	});
});
