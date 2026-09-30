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

	it("lists every repository of a multi-repo workspace in place of the source-code line (#747)", () => {
		const prompt = buildInvestigationPrompt({
			...baseContext,
			workspace: {
				repos: [
					{
						path: "api/",
						services: ["checkout", "cart"],
						subPath: null,
						head: "1a2b3c4d5e6f7a8b9c0d",
					},
					{
						path: "worker/",
						services: ["jobs"],
						subPath: "svc/jobs",
						head: "5d6e7f8a9b0c1d2e3f4a",
					},
				],
			},
		});

		expect(prompt).not.toContain(
			"- Application SOURCE CODE is in your current working directory",
		);
		expect(prompt).toContain(
			"  - Application SOURCE CODE: 2 repositories under your current working directory:\n      api/  services: checkout, cart  (at 1a2b3c4d5e6f)\n      worker/  services: jobs  (at 5d6e7f8a9b0c)  sub-path: svc/jobs",
		);
	});

	it("tells the agent how to cite a context-pack fact only when a pack is present", () => {
		const pack = {
			window: { start: "2026-09-23T10:00:00Z", end: "2026-09-23T11:00:00Z" },
			changes: [],
			neighbors: [],
			priorIncidents: [],
			unavailable: [],
			assembledAt: "2026-09-23T11:00:00Z",
		};
		expect(buildInvestigationPrompt({ ...baseContext, contextPack: pack } as InvestigationContext)).toContain(
			'cites source "context-pack:<which fact>"',
		);
		expect(buildInvestigationPrompt(baseContext)).not.toContain("context-pack:");
	});
});
