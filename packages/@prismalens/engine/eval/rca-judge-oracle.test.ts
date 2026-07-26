// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { copyFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { InvestigationContext } from "@prismalens/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { rcaJudgeOracle } from "./rca-judge-oracle.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = join(HERE, "fixtures", "fake-judge.mjs");
let tempRepo: string;

const mockContext = {} as InvestigationContext;
const mockArm = {
	arm: "raw" as const,
	rawText:
		"The root cause is DB connection pool exhaustion due to sqlalchemy_engine_options.",
	report: {
		rawText:
			"The root cause is DB connection pool exhaustion due to sqlalchemy_engine_options.",
	},
	costUsd: 0.05,
	tokens: { input: 1000, output: 200 },
	providerCost: { claudeUsd: 0.05 },
	timeToReportMs: 5000,
	alertSnapshot: [],
	events: [],
};

describe("rcaJudgeOracle", () => {
	beforeAll(async () => {
		tempRepo = await mkdtemp(join(tmpdir(), "test-sreforge-repo-"));
		const judgeDir = join(tempRepo, "tools", "rca-judge");
		await mkdir(judgeDir, { recursive: true });
		await copyFile(FIXTURE_PATH, join(judgeDir, "judge.mjs"));
	});

	afterAll(async () => {
		if (tempRepo) {
			await rm(tempRepo, { recursive: true, force: true });
		}
	});

	it("populates score, note, and detail for happy path", async () => {
		const oracle = rcaJudgeOracle({
			sreforgeRepo: tempRepo,
			scenarioDir: "scenarios/booklogr",
			judgeEnv: { FAKE_JUDGE_MODE: "happy" },
		});
		const result = await oracle(mockArm, mockContext);
		expect(result.score).toBe(0.8);
		// The trailing `rca:` segment is the fixture echoing rca.md back, which proves the
		// arm's rawText round-tripped into the judge (an empty rca.md would fail here).
		expect(result.note).toBe(
			`rca-judge test-judge-model rubric v1: Root cause correctly identified as pool size | rca: ${mockArm.rawText}`,
		);
		expect(result.detail).toBeDefined();
		const detail = result.detail as { axes: { false_leads: boolean } };
		expect(detail.axes.false_leads).toBe(false);
	});

	it("honours a valid diagnosis.json even when the judge exits non-zero", async () => {
		const oracle = rcaJudgeOracle({
			sreforgeRepo: tempRepo,
			scenarioDir: "scenarios/booklogr",
			judgeEnv: { FAKE_JUDGE_MODE: "nonzero_with_file" },
		});
		const result = await oracle(mockArm, mockContext);
		expect(result.score).toBe(0.8);
		expect(result.note).toContain("rca-judge test-judge-model rubric v1:");
	});

	it("returns score: null when the diagnosis score is out of [0,1]", async () => {
		const oracle = rcaJudgeOracle({
			sreforgeRepo: tempRepo,
			scenarioDir: "scenarios/booklogr",
			judgeEnv: { FAKE_JUDGE_MODE: "out_of_range" },
		});
		const result = await oracle(mockArm, mockContext);
		expect(result.score).toBeNull();
		expect(result.note).toBe(
			"rca-judge diagnosis.json score out of range [0,1]: 85",
		);
	});

	it("returns score: null and best-effort note when diagnosis.json is absent (exit 0)", async () => {
		const oracle = rcaJudgeOracle({
			sreforgeRepo: tempRepo,
			scenarioDir: "scenarios/booklogr",
			judgeEnv: { FAKE_JUDGE_MODE: "absent" },
		});
		const result = await oracle(mockArm, mockContext);
		expect(result.score).toBeNull();
		expect(result.note).toContain("best-effort");
	});

	it("returns score: null when diagnosis.json is malformed JSON", async () => {
		const oracle = rcaJudgeOracle({
			sreforgeRepo: tempRepo,
			scenarioDir: "scenarios/booklogr",
			judgeEnv: { FAKE_JUDGE_MODE: "malformed" },
		});
		const result = await oracle(mockArm, mockContext);
		expect(result.score).toBeNull();
		expect(result.note).toMatch(/malformed|invalid/i);
	});

	it("returns score: null when judge process exits non-zero", async () => {
		const oracle = rcaJudgeOracle({
			sreforgeRepo: tempRepo,
			scenarioDir: "scenarios/booklogr",
			judgeEnv: { FAKE_JUDGE_MODE: "nonzero" },
		});
		const result = await oracle(mockArm, mockContext);
		expect(result.score).toBeNull();
		expect(result.note).toMatch(/exited with code 2/i);
	});

	it("returns score: null when schema_version mismatches", async () => {
		const oracle = rcaJudgeOracle({
			sreforgeRepo: tempRepo,
			scenarioDir: "scenarios/booklogr",
			judgeEnv: { FAKE_JUDGE_MODE: "schema_mismatch" },
		});
		const result = await oracle(mockArm, mockContext);
		expect(result.score).toBeNull();
		expect(result.note).toMatch(/schema_version/i);
	});

	it("returns score: null and names the offending axis when axes is malformed", async () => {
		const oracle = rcaJudgeOracle({
			sreforgeRepo: tempRepo,
			scenarioDir: "scenarios/booklogr",
			judgeEnv: { FAKE_JUDGE_MODE: "bad_axes" },
		});
		const result = await oracle(mockArm, mockContext);
		expect(result.score).toBeNull();
		// Naming the field matters: mid-campaign this note is the only evidence.
		expect(result.note).toContain("axes.root_cause_correct");
		expect(result.detail).toBeUndefined();
	});

	it("kills child process and returns score: null on timeout", async () => {
		const oracle = rcaJudgeOracle({
			sreforgeRepo: tempRepo,
			scenarioDir: "scenarios/booklogr",
			judgeEnv: { FAKE_JUDGE_MODE: "timeout" },
			timeoutMs: 100,
		});
		const result = await oracle(mockArm, mockContext);
		expect(result.score).toBeNull();
		expect(result.note).toMatch(/timed out/i);
	});

	it("never throws or rejects in any case", async () => {
		const oracleMissingRepo = rcaJudgeOracle({
			sreforgeRepo: "/nonexistent/repo/path",
			scenarioDir: "scenarios/booklogr",
		});
		await expect(oracleMissingRepo(mockArm, mockContext)).resolves.toEqual(
			expect.objectContaining({
				score: null,
			}),
		);

		const oracleBadNode = rcaJudgeOracle({
			sreforgeRepo: tempRepo,
			scenarioDir: "scenarios/booklogr",
			node: "/nonexistent/node/binary",
		});
		await expect(oracleBadNode(mockArm, mockContext)).resolves.toEqual(
			expect.objectContaining({
				score: null,
			}),
		);
	});
});
