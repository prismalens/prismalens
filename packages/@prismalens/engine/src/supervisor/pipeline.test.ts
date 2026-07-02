/**
 * Hermetic tests for the Tier-1 supervisor pipeline seams (ADR-0016): decompose's
 * N=1 policy + fan-out-ready Branch shape, the conditional prompt enrichment
 * (ADR-0015), and fan-out's branch dispatch. No network / no LLM — the harness is a
 * fake generator, so these run in the default suite (unlike the gated integration
 * evals).
 */
import type { CanonicalEvent, FiringAlert } from "@prismalens/contracts";
import { singleAlertContext } from "@prismalens/contracts";
import { describe, expect, it } from "vitest";
import { decompose } from "./decompose.js";
import { fanOut } from "./fan-out.js";
import type { HarnessRunner } from "./investigate.js";

const TELEMETRY = {
	prometheusUrl: "http://prom:9090",
	alertmanagerUrl: "http://am:9093",
	apiUrl: "http://api:5000",
};

function alert(name: string): FiringAlert {
	return {
		alertname: name,
		severity: "critical",
		labels: {},
		annotations: {},
		startsAt: null,
	};
}

function agentStep(
	runId: string,
	branchId: string,
	seq: number,
): CanonicalEvent {
	return {
		kind: "agent_step",
		runId,
		branchId,
		path: [],
		seq,
		ts: "2026-07-01T00:00:00.000Z",
		text: "thinking",
		toolCalls: [],
	};
}

describe("decompose — N=1 supervisor policy (ADR-0016)", () => {
	it("emits exactly ONE branch over the whole context, id 'root'", () => {
		const branches = decompose(
			singleAlertContext(alert("HighLatency"), TELEMETRY),
		);
		expect(branches).toHaveLength(1);
		expect(branches[0].branchId).toBe("root");
		expect(branches[0].prompt).toContain("HighLatency");
		expect(branches[0].prompt).toContain(TELEMETRY.prometheusUrl);
	});

	it("renders the service + logs blocks ONLY when the host supplied them", () => {
		const bare = decompose(singleAlertContext(alert("X"), TELEMETRY))[0].prompt;
		expect(bare).not.toContain("AFFECTED SERVICE");
		expect(bare).not.toContain("Logs (");

		const enriched = decompose(
			singleAlertContext(alert("X"), TELEMETRY, {
				service: {
					name: "checkout",
					tier: "tier-1",
					repo: "acme/checkout",
					dependsOn: ["payments"],
				},
				logs: { kind: "loki", url: "http://loki:3100" },
			}),
		)[0].prompt;
		expect(enriched).toContain("AFFECTED SERVICE");
		expect(enriched).toContain("checkout");
		expect(enriched).toContain("payments");
		expect(enriched).toContain("http://loki:3100");
	});

	it("lists related alerts when the context carries more than one", () => {
		const ctx = {
			...singleAlertContext(alert("Primary"), TELEMETRY),
			alerts: [alert("Primary"), alert("Secondary")],
		};
		const prompt = decompose(ctx)[0].prompt;
		expect(prompt).toContain("RELATED FIRING ALERTS");
		expect(prompt).toContain("Secondary");
	});
});

describe("fanOut — branch dispatch (ADR-0016)", () => {
	it("dispatches each branch to the harness and relays its events with the branch id", async () => {
		const seen: Array<{ prompt: string; branchId: string }> = [];
		const harness: HarnessRunner = async function* (prompt, ctx) {
			seen.push({ prompt, branchId: ctx.branchId });
			yield agentStep(ctx.runId, ctx.branchId, 0);
			yield agentStep(ctx.runId, ctx.branchId, 1);
		};

		const events: CanonicalEvent[] = [];
		for await (const ev of fanOut(
			[{ branchId: "root", prompt: "brief" }],
			harness,
			"run-1",
		)) {
			events.push(ev);
		}

		expect(seen).toEqual([{ prompt: "brief", branchId: "root" }]);
		expect(events).toHaveLength(2);
		expect(events.every((e) => "branchId" in e && e.branchId === "root")).toBe(
			true,
		);
	});
});
