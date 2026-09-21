// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { InvestigationContext } from "@prismalens/contracts/schemas";
import { describe, expect, it } from "vitest";
import { buildInvestigationPrompt } from "./prompt.js";

describe("buildInvestigationPrompt (#633)", () => {
	const baseContext: InvestigationContext = {
		alerts: [
			{
				alertname: "HighErrorRate",
				severity: "critical",
				labels: { service: "checkout" },
				annotations: { summary: "5xx rate > 5%" },
				startsAt: new Date().toISOString(),
			},
		],
		service: {
			name: "checkout",
		},
	};

	it("with telemetry.prometheusUrl the prompt has a Prometheus surface line and the 'Confirm the alert's signal' step", () => {
		const contextWithTelemetry: InvestigationContext = {
			...baseContext,
			telemetry: {
				prometheusUrl: "http://prometheus.internal:9090",
			},
		};

		const prompt = buildInvestigationPrompt(contextWithTelemetry);

		expect(prompt).toContain("- Prometheus    http://prometheus.internal:9090");
		expect(prompt).toContain(
			"Confirm the alert's signal in Prometheus: which metric/expression fired and how far past threshold.",
		);
		expect(prompt).toContain(
			"- Application SOURCE CODE is in your current working directory",
		);
	});

	it("without telemetry neither appears and the source-code line still does", () => {
		const prompt = buildInvestigationPrompt(baseContext);

		expect(prompt).not.toContain("- Prometheus");
		expect(prompt).not.toContain(
			"Confirm the alert's signal in Prometheus: which metric/expression fired and how far past threshold.",
		);
		expect(prompt).toContain(
			"- Application SOURCE CODE is in your current working directory",
		);
	});
});
