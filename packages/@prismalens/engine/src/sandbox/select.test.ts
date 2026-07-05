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
		const sel = resolveSandbox("process");
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
		it("e2b throws a clear, actionable error (never silently downgrades)", () => {
			expect(() => resolveSandbox("e2b")).toThrowError(
				/e2b sandbox unavailable/,
			);
		});
	});

	it("auto never selects the explicit-only e2b provider", async () => {
		const sel = resolveSandbox("auto");
		expect(sel.actual).not.toBe("e2b");
		expect(["srt", "process-floor"]).toContain(sel.actual);
		await sel.sandbox.destroy();
	});

	describe.skipIf(isSrtAvailable())("when srt is unavailable", () => {
		it("auto degrades to the floor with actual=process-floor", async () => {
			const sel = resolveSandbox("auto");
			expect(sel.requested).toBe("auto");
			expect(sel.actual).toBe("process-floor");
			expect(sel.sandbox.fidelity).toBe("cooperative");
			await sel.sandbox.destroy();
		});

		it("srt throws (never silently downgrades an explicit request)", () => {
			expect(() => resolveSandbox("srt")).toThrowError(
				/srt sandbox unavailable/,
			);
		});
	});

	describe.skipIf(!isSrtAvailable())("when srt is available", () => {
		it("auto and srt both select the enforced srt provider", async () => {
			const auto = resolveSandbox("auto");
			expect(auto.actual).toBe("srt");
			expect(auto.sandbox.fidelity).toBe("enforced");
			await auto.sandbox.destroy();

			const srt = resolveSandbox("srt");
			expect(srt.requested).toBe("srt");
			expect(srt.actual).toBe("srt");
			await srt.sandbox.destroy();
		});
	});
});
