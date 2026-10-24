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
					skipped: false,
					units: [],
				},
			],
			checkoutsSkipped: [],
		};
		expect(matrixCell(answer, "prometheus")).toEqual({ text: "Not set up" });
	});

	it("renders skipped as Choose one with warn", () => {
		const answer: SourcesPreRun = {
			kinds: [
				{
					kind: "prometheus",
					notConfigured: false,
					skipped: true,
					units: [],
				},
			],
			checkoutsSkipped: [],
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
					skipped: false,
					units: [
						{
							from: "env",
							label: "Prometheus ENV",
							sourceKind: "url",
							url: "http://env:9090",
							connectionId: null,
							selection: { rule: "env" },
						},
					],
				},
			],
			checkoutsSkipped: [],
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
					skipped: false,
					units: [
						{
							label: "Staging Prom",
							deployment: "staging",
							sourceKind: "connection",
							url: "http://staging:9090",
							connectionId: "c1",
							selection: { rule: "other-tag" },
						},
					],
				},
			],
			checkoutsSkipped: [],
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
					skipped: false,
					units: [
						{
							label: "Prod Prom",
							deployment: "prod",
							sourceKind: "connection",
							url: "http://prod:9090",
							connectionId: "c2",
							selection: { rule: "tag-match" },
						},
					],
				},
			],
			checkoutsSkipped: [],
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
					skipped: false,
					units: [
						{
							label: "Global Prom",
							sourceKind: "connection",
							url: "http://global:9090",
							connectionId: "c3",
							selection: { rule: "default" },
						},
					],
				},
			],
			checkoutsSkipped: [],
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
					skipped: false,
					units: [
						{
							label: "Unexpected Tag Match",
							deployment: "different-tag",
							sourceKind: "connection",
							url: "http://other:9090",
							connectionId: "c4",
							selection: { rule: "tag-match" },
						},
					],
				},
			],
			checkoutsSkipped: [],
		};
		expect(matrixCell(answer, "prometheus")).toEqual({
			text: "Unexpected Tag Match",
		});
	});
});
