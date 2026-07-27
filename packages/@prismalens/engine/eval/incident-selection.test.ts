// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import {
	type NamedAlert,
	pickIncidentAlerts,
	scenarioLabel,
	slug,
} from "./incident-selection.js";

describe("incident-selection", () => {
	describe("slug", () => {
		it("lowercases input strings", () => {
			expect(slug("BooklogrApiLatencyP99High")).toBe(
				"booklograpilatencyp99high",
			);
			expect(slug("Booklogr-Api-Latency-P99-High")).toBe(
				"booklogr-api-latency-p99-high",
			);
		});

		it("collapses non-alphanumeric runs into a single dash", () => {
			expect(slug("foo---bar   baz!!123")).toBe("foo-bar-baz-123");
			expect(slug("a!!b@@c")).toBe("a-b-c");
		});

		it("strips leading and trailing dashes", () => {
			expect(slug("-foo-bar-")).toBe("foo-bar");
			expect(slug("  hello world  ")).toBe("hello-world");
			expect(slug("---test---")).toBe("test");
		});

		it("returns 'incident' when input reduces to nothing (empty string, whitespace, symbols)", () => {
			expect(slug("")).toBe("incident");
			expect(slug("   ")).toBe("incident");
			expect(slug("!!!")).toBe("incident");
			expect(slug("---")).toBe("incident");
			expect(slug("@#$%^&*")).toBe("incident");
		});
	});

	describe("pickIncidentAlerts", () => {
		const sampleAlerts: NamedAlert[] = [
			{ alertname: "EdgeClientRequestJitter" },
			{ alertname: "BooklogrApiLatencyP99High" },
			{ alertname: "DbConnectionPoolExhausted" },
		];

		it("throws when alerts array is empty", () => {
			expect(() => pickIncidentAlerts([], {})).toThrow(
				"no firing alerts — nothing to investigate",
			);
		});

		describe("INCIDENT_ALERTNAMES (storm mode)", () => {
			it("returns all named alerts when every named alert is firing", () => {
				const picked = pickIncidentAlerts(sampleAlerts, {
					INCIDENT_ALERTNAMES:
						"BooklogrApiLatencyP99High, DbConnectionPoolExhausted",
				});
				expect(picked).toEqual([
					{ alertname: "BooklogrApiLatencyP99High" },
					{ alertname: "DbConnectionPoolExhausted" },
				]);
			});

			it("trims whitespace around comma-separated alert names and filters empty entries", () => {
				const picked = pickIncidentAlerts(sampleAlerts, {
					INCIDENT_ALERTNAMES:
						"  BooklogrApiLatencyP99High , , DbConnectionPoolExhausted  ",
				});
				expect(picked).toEqual([
					{ alertname: "BooklogrApiLatencyP99High" },
					{ alertname: "DbConnectionPoolExhausted" },
				]);
			});

			it("throws listing missing alerts when any named alert is not firing", () => {
				expect(() =>
					pickIncidentAlerts(sampleAlerts, {
						INCIDENT_ALERTNAMES:
							"BooklogrApiLatencyP99High, NonExistentAlert",
					}),
				).toThrow(
					"incident alert(s) not firing: [NonExistentAlert] — got [EdgeClientRequestJitter, BooklogrApiLatencyP99High, DbConnectionPoolExhausted]. Refusing to investigate a different incident.",
				);
			});

			it("throws listing multiple missing alerts when several named alerts are not firing", () => {
				expect(() =>
					pickIncidentAlerts(sampleAlerts, {
						INCIDENT_ALERTNAMES: "MissingOne, MissingTwo",
					}),
				).toThrow(
					"incident alert(s) not firing: [MissingOne, MissingTwo] — got [EdgeClientRequestJitter, BooklogrApiLatencyP99High, DbConnectionPoolExhausted]. Refusing to investigate a different incident.",
				);
			});
		});

		describe("INCIDENT_ALERTNAME (single mode)", () => {
			it("returns exactly the named alert when firing", () => {
				const picked = pickIncidentAlerts(sampleAlerts, {
					INCIDENT_ALERTNAME: "BooklogrApiLatencyP99High",
				});
				expect(picked).toEqual([{ alertname: "BooklogrApiLatencyP99High" }]);
			});

			it("trims whitespace around the single alert name", () => {
				const picked = pickIncidentAlerts(sampleAlerts, {
					INCIDENT_ALERTNAME: "  DbConnectionPoolExhausted  ",
				});
				expect(picked).toEqual([{ alertname: "DbConnectionPoolExhausted" }]);
			});

			it("throws when the named single alert is not firing", () => {
				expect(() =>
					pickIncidentAlerts(sampleAlerts, {
						INCIDENT_ALERTNAME: "NonExistentAlert",
					}),
				).toThrow(
					"incident alert(s) not firing: [NonExistentAlert] — got [EdgeClientRequestJitter, BooklogrApiLatencyP99High, DbConnectionPoolExhausted]. Refusing to investigate a different incident.",
				);
			});
		});

		describe("precedence when both env vars are set", () => {
			it("throws when both INCIDENT_ALERTNAMES and INCIDENT_ALERTNAME are set", () => {
				expect(() =>
					pickIncidentAlerts(sampleAlerts, {
						INCIDENT_ALERTNAMES: "BooklogrApiLatencyP99High",
						INCIDENT_ALERTNAME: "DbConnectionPoolExhausted",
					}),
				).toThrow(
					"INCIDENT_ALERTNAMES and INCIDENT_ALERTNAME are both set — pick one.",
				);
			});
		});

		describe("fallback when neither env var is set", () => {
			it("falls back to the first firing alert (alerts[0])", () => {
				const picked = pickIncidentAlerts(sampleAlerts, {});
				expect(picked).toEqual([{ alertname: "EdgeClientRequestJitter" }]);
			});

			it("falls back to alerts[0] when env vars are whitespace-only or empty strings", () => {
				const picked = pickIncidentAlerts(sampleAlerts, {
					INCIDENT_ALERTNAMES: "   ",
					INCIDENT_ALERTNAME: "",
				});
				expect(picked).toEqual([{ alertname: "EdgeClientRequestJitter" }]);
			});
		});
	});

	describe("scenarioLabel", () => {
		const sampleAlerts: NamedAlert[] = [
			{ alertname: "BooklogrApiLatencyP99High" },
			{ alertname: "DbConnectionPoolExhausted" },
		];

		it("returns slug of INCIDENT_SCENARIO when set", () => {
			const label = scenarioLabel(sampleAlerts, {
				INCIDENT_SCENARIO: " Booklogr API Latency P99 High ",
			});
			expect(label).toBe("booklogr-api-latency-p99-high");
		});

		it("falls back to slug of first incident alert when INCIDENT_SCENARIO is unset", () => {
			const label = scenarioLabel(sampleAlerts, {});
			expect(label).toBe("booklograpilatencyp99high");
		});

		it("falls back to slug of first incident alert in a storm scenario when INCIDENT_SCENARIO is unset", () => {
			const stormAlerts: NamedAlert[] = [
				{ alertname: "DbConnectionPoolExhausted" },
				{ alertname: "BooklogrApiLatencyP99High" },
			];
			const label = scenarioLabel(stormAlerts, {});
			expect(label).toBe("dbconnectionpoolexhausted");
		});

		it("throws when incidentAlerts is empty and INCIDENT_SCENARIO is unset", () => {
			expect(() => scenarioLabel([], {})).toThrow(
				"scenarioLabel: no incident alerts to derive a label from",
			);
		});
	});
});
