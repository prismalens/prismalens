// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { journeys } from "../../../../scripts/journeys/index.mjs";
import {
	findTarball,
	packedConfig,
} from "../../../../scripts/journeys/targets/packed.mjs";

describe("The packed and live targets", () => {
	it("Given PACKED_INTAKE_AGENT=live, When the target is chosen, Then it is the live target on the real agent with the model it was given", () => {
		expect(
			packedConfig({
				PACKED_INTAKE_AGENT: "live",
				PRISMALENS_HARNESS_MODEL: "opencode/free-model",
				PACKED_INTAKE_PORT: "3105",
			}),
		).toEqual({
			name: "live",
			agent: "real",
			repo: undefined,
			port: "3105",
			model: "opencode/free-model",
			journeys: null,
			eventsOut: undefined,
		});
	});

	it("Given no agent is named, When the target is chosen, Then it is the live target", () => {
		expect(packedConfig({})).toMatchObject({ name: "live", agent: "real" });
	});

	it("Given PACKED_INTAKE_AGENT=fake, When the target is chosen, Then it is the packed target on the scripted agent and the built-in fixture", () => {
		expect(
			packedConfig({
				PACKED_INTAKE_AGENT: "fake",
				PACKED_INTAKE_REPO: "fixture",
			}),
		).toMatchObject({
			name: "packed",
			agent: "scripted",
			repo: undefined,
			port: "3102",
		});
	});

	it("Given PACKED_INTAKE_REPO names a checkout, When the live target is chosen, Then it investigates that checkout", () => {
		expect(
			packedConfig({ PACKED_INTAKE_REPO: "../somewhere" }).repo,
		).toBe(resolve("../somewhere"));
	});

	it("Given the scripted agent and another checkout, When the target is chosen, Then it refuses, because the session cites the fixture's files", () => {
		expect(() =>
			packedConfig({
				PACKED_INTAKE_AGENT: "fake",
				PACKED_INTAKE_REPO: "/some/checkout",
			}),
		).toThrow("PACKED_INTAKE_AGENT=fake needs PACKED_INTAKE_REPO=fixture");
	});

	it("Given an unknown agent, When the target is chosen, Then it refuses", () => {
		expect(() => packedConfig({ PACKED_INTAKE_AGENT: "mock" })).toThrow(
			"PACKED_INTAKE_AGENT must be live or fake, got mock",
		);
	});

	it("Given PACKED_INTAKE_JOURNEYS and PACKED_INTAKE_EVENTS_OUT, When the target is chosen, Then both are read", () => {
		expect(
			packedConfig({
				PACKED_INTAKE_JOURNEYS: "alert-to-report, restart-resumes",
				PACKED_INTAKE_EVENTS_OUT: "/tmp/events.json",
			}),
		).toMatchObject({
			journeys: ["alert-to-report", "restart-resumes"],
			eventsOut: "/tmp/events.json",
		});
	});
});

describe("Finding the tarball", () => {
	const dir = mkdtempSync(join(tmpdir(), "pl-journeys-"));
	afterAll(() => rmSync(dir, { recursive: true, force: true }));

	it("Given a directory holding the packed tarball, When it is searched, Then the tarball's path is returned", () => {
		writeFileSync(join(dir, "prismalens-0.5.6.tgz"), "");
		writeFileSync(join(dir, "other.tgz"), "");
		expect(findTarball(dir, {})).toBe(join(resolve(dir), "prismalens-0.5.6.tgz"));
	});

	it("Given PRISMALENS_TARBALL, When it is searched, Then that exact path wins over the directory", () => {
		expect(findTarball(dir, { PRISMALENS_TARBALL: "x/y.tgz" })).toBe(
			resolve("x/y.tgz"),
		);
	});

	it("Given an empty directory, When it is searched, Then it says where it looked", () => {
		const empty = join(dir, "empty");
		mkdirSync(empty);
		expect(() => findTarball(empty, {})).toThrow(
			`no tarball matching prismalens-*.tgz in ${resolve(empty)}`,
		);
	});

	it("Given no directory and no override, When it is searched, Then it prints the usage", () => {
		expect(() => findTarball(undefined, {})).toThrow(
			"usage: packed-intake.mjs <dir-with-tarball> (or set PRISMALENS_TARBALL)",
		);
	});
});

describe("The journey list", () => {
	it("Given the journeys every target runs, When they are listed, Then they are the two core journeys, each under its own name", () => {
		expect(journeys.map((j) => j.name)).toEqual([
			"alert-to-report",
			"restart-resumes",
		]);
	});
});
