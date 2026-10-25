// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { SourcesPreRun } from "@prismalens/contracts";
import { describe, expect, it } from "vitest";
import { matrixCell } from "./ServiceConnectionsMatrix";

describe("matrixCell server preview (case 10)", () => {
	it("returns null when answer is undefined", () => {
		expect(matrixCell(undefined, "prometheus")).toBeNull();
	});

	it("renders notConfigured as Not set up", () => {
		const answer: SourcesPreRun = {
			kinds: [
				{
					kind: "prometheus",
					notConfigured: true,
					skipped: null,
					envFallback: null,
					units: [],
				},
			],
			deploymentsSeen: [],
		};
		expect(matrixCell(answer, "prometheus")).toEqual({ text: "Not set up" });
	});

	it("renders skipped as Choose one with warn", () => {
		const answer: SourcesPreRun = {
			kinds: [
				{
					kind: "prometheus",
					notConfigured: false,
					skipped: "several connections",
					envFallback: null,
					units: [],
				},
			],
			deploymentsSeen: [],
		};
		expect(matrixCell(answer, "prometheus")).toEqual({
			text: "Choose one",
			warn: true,
		});
	});

	it("renders unit from env as From environment", () => {
		const answer: SourcesPreRun = {
			kinds: [
				{
					kind: "prometheus",
					notConfigured: false,
					skipped: null,
					envFallback: null,
					units: [
						{
							kind: "prometheus",
							from: "env",
							label: "Prometheus ENV",
							selection: { rule: "env", service: "s1" },
						},
					],
				},
			],
			deploymentsSeen: [],
		};
		expect(matrixCell(answer, "prometheus")).toEqual({
			text: "From environment",
		});
	});

	it("renders other-tag rule with deployment data and warn", () => {
		const answer: SourcesPreRun = {
			kinds: [
				{
					kind: "prometheus",
					notConfigured: false,
					skipped: null,
					envFallback: null,
					units: [
						{
							kind: "prometheus",
							from: "set",
							label: "Staging Prom",
							deployment: "staging",
							selection: { rule: "other-tag", service: "s1" },
						},
					],
				},
			],
			deploymentsSeen: [],
		};
		expect(matrixCell(answer, "prometheus")).toEqual({
			text: "Staging Prom",
			sub: "staging data",
			warn: true,
		});
	});

	it("renders tag-match rule with label only", () => {
		const answer: SourcesPreRun = {
			kinds: [
				{
					kind: "prometheus",
					notConfigured: false,
					skipped: null,
					envFallback: null,
					units: [
						{
							kind: "prometheus",
							from: "set",
							label: "Prod Prom",
							deployment: "prod",
							selection: { rule: "tag-match", service: "s1" },
						},
					],
				},
			],
			deploymentsSeen: [],
		};
		expect(matrixCell(answer, "prometheus")).toEqual({
			text: "Prod Prom",
		});
	});

	it("renders default rule as Any deployment", () => {
		const answer: SourcesPreRun = {
			kinds: [
				{
					kind: "prometheus",
					notConfigured: false,
					skipped: null,
					envFallback: null,
					units: [
						{
							kind: "prometheus",
							from: "set",
							label: "Global Prom",
							selection: { rule: "untagged", service: "s1" },
						},
					],
				},
			],
			deploymentsSeen: [],
		};
		expect(matrixCell(answer, "prometheus")).toEqual({
			text: "Global Prom",
			sub: "Any deployment",
		});
	});

	it("renders verbatim as server says even if tag-match differs from expected column", () => {
		const answer: SourcesPreRun = {
			kinds: [
				{
					kind: "prometheus",
					notConfigured: false,
					skipped: null,
					envFallback: null,
					units: [
						{
							kind: "prometheus",
							from: "set",
							label: "Unexpected Tag Match",
							deployment: "different-tag",
							selection: { rule: "tag-match", service: "s1" },
						},
					],
				},
			],
			deploymentsSeen: [],
		};
		expect(matrixCell(answer, "prometheus")).toEqual({
			text: "Unexpected Tag Match",
		});
	});
});
