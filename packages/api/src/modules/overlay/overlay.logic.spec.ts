import {
	buildLabelSet,
	computeProximity,
	computeWindow,
	containsToken,
	correlateChanges,
	hypothesisHaystack,
	jaccard,
	type OverlayHypothesisInput,
	scoreSimilarity,
	selectSimilarIncidents,
	toStoredScore,
} from "./overlay.logic.js";

const hyp = (
	statement: string,
	evidence: Array<{ observation: string; source: string }> = [],
): OverlayHypothesisInput => ({ statement, evidence });

describe("overlay.logic", () => {
	describe("computeWindow", () => {
		it("anchors the look-back 24h before the earliest alert and ends at report time", () => {
			const t1 = new Date("2026-07-05T12:00:00Z");
			const t2 = new Date("2026-07-05T10:00:00Z"); // earliest
			const reportTime = new Date("2026-07-05T13:00:00Z");

			const w = computeWindow([t1, t2], reportTime);

			expect(w.start.toISOString()).toBe("2026-07-04T10:00:00.000Z");
			expect(w.end).toBe(reportTime);
		});

		it("falls back to the report time when there are no alert times", () => {
			const reportTime = new Date("2026-07-05T13:00:00Z");
			const w = computeWindow([], reportTime);
			expect(w.start.toISOString()).toBe("2026-07-04T13:00:00.000Z");
			expect(w.end).toBe(reportTime);
		});
	});

	describe("hypothesisHaystack / containsToken", () => {
		it("lowercases statement + evidence into one searchable string", () => {
			const h = hyp("Deploy of PAYMENTS-API broke checkout", [
				{ observation: "500s spiked", source: "loki-query" },
			]);
			const hay = hypothesisHaystack(h);
			expect(hay).toContain("payments-api");
			expect(hay).toContain("loki-query");
		});

		it("matches a whole token bounded by non-alphanumerics", () => {
			expect(containsToken("the payments-api deploy", "payments-api")).toBe(
				true,
			);
			expect(containsToken("release abc123def committed", "abc123def")).toBe(
				true,
			);
		});

		it("does not match a token embedded inside a larger word", () => {
			expect(containsToken("apihandler restarted", "api")).toBe(false);
		});

		it("rejects needles shorter than 3 chars", () => {
			expect(containsToken("db is down", "db")).toBe(false);
		});
	});

	describe("correlateChanges", () => {
		const window = computeWindow([], new Date("2026-07-05T12:00:00Z"));

		it("matches a change by service name and attributes it to the lowest hypothesis index", () => {
			const hypotheses = [
				hyp("Network blip, unrelated"),
				hyp("The payments-api deployment regressed the checkout flow"),
			];
			const changes = [
				{
					kind: "deployment" as const,
					id: "dep-1",
					title: "payments-api @ abc123",
					source: "deployment",
					serviceName: "payments-api",
					timestamp: new Date("2026-07-05T09:00:00Z"),
					identifiers: ["srv_9", "abc123"],
				},
			];

			const matched = correlateChanges(hypotheses, changes, window);

			expect(matched).toHaveLength(1);
			expect(matched[0].hypothesisIndex).toBe(1);
			expect(matched[0].matchedOn).toBe("payments-api");
			expect(matched[0].id).toBe("dep-1");
		});

		it("matches by a deploy identifier when the service name is absent from the text", () => {
			const hypotheses = [hyp("Rollout abc123 introduced a null deref")];
			const changes = [
				{
					kind: "deployment" as const,
					id: "dep-2",
					title: "worker deploy",
					source: "deployment",
					serviceName: "worker",
					timestamp: new Date("2026-07-05T08:00:00Z"),
					identifiers: ["abc123"],
				},
			];
			const matched = correlateChanges(hypotheses, changes, window);
			expect(matched).toHaveLength(1);
			expect(matched[0].matchedOn).toBe("abc123");
		});

		it("drops changes outside the correlation window", () => {
			const hypotheses = [hyp("payments-api broke")];
			const changes = [
				{
					kind: "deployment" as const,
					id: "old",
					title: "old deploy",
					source: "deployment",
					serviceName: "payments-api",
					timestamp: new Date("2026-06-01T00:00:00Z"), // way before window.start
					identifiers: [],
				},
			];
			expect(correlateChanges(hypotheses, changes, window)).toHaveLength(0);
		});

		it("drops changes no hypothesis references", () => {
			const hypotheses = [hyp("database connection pool exhausted")];
			const changes = [
				{
					kind: "change_event" as const,
					id: "c1",
					title: "frontend config",
					source: "github",
					serviceName: "frontend",
					timestamp: new Date("2026-07-05T09:00:00Z"),
					identifiers: [],
				},
			];
			expect(correlateChanges(hypotheses, changes, window)).toHaveLength(0);
		});
	});

	describe("computeProximity", () => {
		const hypotheses = [
			hyp("payments-api regressed after deploy"),
			hyp("ledger-db latency also rose; billing-worker retried"),
		];
		const candidates = [
			"payments-api",
			"ledger-db",
			"billing-worker",
			"notifications",
		];

		it("ranks named services by graph distance and omits unnamed ones", () => {
			const result = computeProximity(hypotheses, candidates, {
				affected: ["payments-api"],
				dependencies: ["ledger-db"],
				dependents: ["billing-worker"],
			});

			// notifications is not named in any hypothesis → omitted
			expect(result.map((r) => r.serviceName)).toEqual([
				"payments-api",
				"billing-worker",
				"ledger-db",
			]);

			const self = result.find((r) => r.serviceName === "payments-api");
			expect(self).toMatchObject({ proximity: 0, relation: "self" });
			expect(self?.hypothesisIndexes).toEqual([0]);

			expect(result.find((r) => r.serviceName === "ledger-db")).toMatchObject({
				proximity: 1,
				relation: "dependency",
			});
			expect(
				result.find((r) => r.serviceName === "billing-worker"),
			).toMatchObject({ proximity: 1, relation: "dependent" });
		});

		it("marks a named service outside the neighbourhood as beyond (proximity 2)", () => {
			const result = computeProximity(
				[hyp("cdn-edge was slow")],
				["cdn-edge"],
				{
					affected: ["payments-api"],
					dependencies: [],
					dependents: [],
				},
			);
			expect(result[0]).toMatchObject({
				serviceName: "cdn-edge",
				proximity: 2,
				relation: "beyond",
			});
		});
	});

	describe("buildLabelSet / jaccard / scoreSimilarity", () => {
		it("builds a label set from alert labels and titles", () => {
			const set = buildLabelSet([
				{ title: "High latency", labels: { severity: "high", team: "core" } },
			]);
			expect(set.has("severity=high")).toBe(true);
			expect(set.has("team=core")).toBe(true);
			expect(set.has("title:high latency")).toBe(true);
		});

		it("computes the Jaccard index", () => {
			const a = new Set(["x", "y", "z"]);
			const b = new Set(["y", "z", "w"]);
			expect(jaccard(a, b)).toBeCloseTo(2 / 4); // |∩|=2, |∪|=4
			expect(jaccard(new Set(), new Set())).toBe(0);
		});

		it("adds same-service and shared-category bonuses, clamped to 1", () => {
			const labels = new Set(["a", "b"]);
			const f = scoreSimilarity(
				{ labels, serviceId: "svc-1", rootCauseCategory: "code" },
				{ labels, serviceId: "svc-1", rootCauseCategory: "code" },
			);
			// jaccard 1 + 0.2 + 0.1 -> clamped to 1
			expect(f.jaccard).toBe(1);
			expect(f.sameService).toBe(true);
			expect(f.sharedCategory).toBe(true);
			expect(f.score).toBe(1);
		});

		it("does not credit a same-service bonus when both service ids are null", () => {
			const f = scoreSimilarity(
				{ labels: new Set(["a"]), serviceId: null, rootCauseCategory: null },
				{ labels: new Set(["a"]), serviceId: null, rootCauseCategory: null },
			);
			expect(f.sameService).toBe(false);
			expect(f.sharedCategory).toBe(false);
			expect(f.score).toBe(1); // pure jaccard
		});
	});

	describe("selectSimilarIncidents", () => {
		const current = {
			labels: new Set(["severity=high", "svc=payments"]),
			serviceId: "svc-1",
			rootCauseCategory: "code",
		};

		it("keeps only incidents at or above the threshold, top-K by score", () => {
			const past = [
				{
					incidentId: "i-strong",
					incidentNumber: 10,
					title: "strong",
					similarity: {
						labels: new Set(["severity=high", "svc=payments"]),
						serviceId: "svc-1",
						rootCauseCategory: "code",
					},
				},
				{
					incidentId: "i-weak",
					incidentNumber: 11,
					title: "weak",
					similarity: {
						labels: new Set(["unrelated"]),
						serviceId: "svc-9",
						rootCauseCategory: "config",
					},
				},
			];

			const result = selectSimilarIncidents(current, past, {
				k: 5,
				threshold: 0.3,
			});
			expect(result.map((r) => r.incidentId)).toEqual(["i-strong"]);
			expect(result[0].score).toBeGreaterThanOrEqual(0.3);
		});

		it("respects K and breaks ties by higher incident number", () => {
			const sim = {
				labels: new Set(["severity=high", "svc=payments"]),
				serviceId: "svc-1",
				rootCauseCategory: "code",
			};
			const past = [11, 12, 13].map((n) => ({
				incidentId: `i-${n}`,
				incidentNumber: n,
				title: `t-${n}`,
				similarity: sim,
			}));
			const result = selectSimilarIncidents(current, past, {
				k: 2,
				threshold: 0.3,
			});
			expect(result).toHaveLength(2);
			// all identical score → highest incident numbers first
			expect(result.map((r) => r.incidentNumber)).toEqual([13, 12]);
		});
	});

	describe("toStoredScore", () => {
		it("maps a 0..1 float to a clamped 0-100 integer", () => {
			expect(toStoredScore(0.42)).toBe(42);
			expect(toStoredScore(1.5)).toBe(100);
			expect(toStoredScore(-1)).toBe(0);
		});
	});
});
