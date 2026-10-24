// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Recorded agent sessions replayed through the real engine (#914): for every
 * agent row and scenario with a committed recording, the engine runs against
 * scripts/fakes/acp-replay.mjs in strict mode. A row with no recording is
 * skipped with the command that makes one.
 */
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HARNESS_IDS, HARNESS_REGISTRY, type HarnessId } from "@prismalens/config/harness";
import { installFakeAgent } from "../../../../scripts/fakes/fake-acp-agent.mjs";
import {
	framesFromTranscript,
	leftoverCredentials,
	type Recording,
	readRecording,
	serialize,
	validateFrames,
} from "./acp-recording.js";
import {
	checkScenario,
	runScenario,
	SCENARIOS,
	type ScenarioBase,
	type ScenarioName,
} from "./acp-scenarios.js";
import { TRANSCRIPTS_DIR } from "./acp-record.js";

const scratch = mkdtempSync(join(tmpdir(), "pl-replay-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

let counter = 0;
/** The engine over a fake agent in `args` mode: a descriptor naming the shim, and a clone to run in. */
function engineOver(
	harness: HarnessId,
	install: Parameters<typeof installFakeAgent>[1],
): ScenarioBase {
	const dir = join(scratch, `run-${counter++}`);
	const bin = join(dir, "bin");
	const clone = join(dir, "clone");
	mkdirSync(bin, { recursive: true });
	mkdirSync(clone, { recursive: true });
	writeFileSync(join(clone, "README.md"), "scenario clone\n");
	const [shim] = installFakeAgent(bin, { binaries: ["replay-agent"], ...install }) as string[];
	return {
		harness,
		cwd: clone,
		runDir: join(dir, "run"),
		env: { ...process.env, PATH: `${bin}${delimiter}${process.env.PATH}` },
		descriptor: {
			...HARNESS_REGISTRY[harness],
			binary: process.platform === "win32" ? `${shim}.cmd` : (shim as string),
		},
	};
}

describe("recorded transcripts replay through the engine", () => {
	const missing: string[] = [];
	beforeAll(() => {
		if (missing.length)
			console.warn(
				`No recording for: ${missing.join(", ")}. Record one on a machine with the agent signed in: pnpm record:agent <agent> <scenario|all>`,
			);
	});
	for (const harness of HARNESS_IDS) {
		for (const scenario of SCENARIOS) {
			const file = join(TRANSCRIPTS_DIR, harness, `${scenario}.ndjson`);
			if (!existsSync(file)) {
				missing.push(`${harness}/${scenario}`);
				it.skip(`${harness} ${scenario}: no recording at scripts/fakes/transcripts/${harness}/${scenario}.ndjson`, () => {});
				continue;
			}
			it(`${harness} ${scenario}: every frame fits the ACP schema, and the engine replays it strictly`, async () => {
				const recording = readRecording(file);
				expect(recording.header.scenario).toBe(scenario);
				expect(validateFrames(recording.frames)).toEqual([]);
				expect(leftoverCredentials(readFileSync(file, "utf8"))).toEqual([]);
				const run = await runScenario(scenario, engineOver(harness, { replay: file }));
				expect(checkScenario(scenario, run)).toBeNull();
			}, 60_000);
		}
	}
});

/** A recording of the scripted fake agent made by the same path the recorder uses. */
async function recordScriptedFake(scenario: ScenarioName): Promise<Recording> {
	const base = engineOver("opencode", { session: "success" });
	const run = await runScenario(scenario, base);
	expect(checkScenario(scenario, run)).toBeNull();
	const frames = framesFromTranscript(
		readFileSync(join(base.runDir, "transcript.jsonl"), "utf8"),
		{ home: tmpdir(), cwd: base.cwd },
	);
	return {
		header: {
			acp_recording: 1,
			agent: { name: "opencode", version: "0.0.0" },
			adapter: { name: "opencode", version: "0.0.0" },
			model: "scripted",
			recorded_at: "2026-01-01T00:00:00.000Z",
			recorder: { name: "prismalens", version: "acp-record" },
			scenario,
		},
		frames,
	};
}

describe("the recorder and the replay agent, on the scripted fake", () => {
	it("records a tool-call run whose every frame fits the ACP schema, and replays it strictly", async () => {
		const recording = await recordScriptedFake("tool-call");
		expect(recording.frames.some((f) => f.frame.method === "session/prompt")).toBe(true);
		expect(validateFrames(recording.frames)).toEqual([]);
		const file = join(scratch, "tool-call.ndjson");
		writeFileSync(file, serialize(recording));
		const run = await runScenario("tool-call", engineOver("opencode", { replay: file }));
		expect(checkScenario("tool-call", run)).toBeNull();
		expect(run.events.filter((e) => e.kind === "tool_result")).toHaveLength(
			recording.frames.filter(
				(f) =>
					f.frame.method === "session/update" &&
					(f.frame.params as { update?: { sessionUpdate?: string; status?: string } })
						.update?.status === "completed",
			).length,
		);
	}, 60_000);

	it("fails on a client frame the recording does not have (strict), and lets it pass when lenient", async () => {
		const recording = await recordScriptedFake("tool-call");
		// The recording now expects `authenticate` where the engine sends `initialize`.
		const wrong = recording.frames.map((f, i) =>
			i === 0 ? { ...f, frame: { ...f.frame, method: "authenticate" } } : f,
		);
		const file = join(scratch, "strict.ndjson");
		writeFileSync(file, serialize({ ...recording, frames: wrong }));
		const strict = await runScenario("tool-call", engineOver("opencode", { replay: file }));
		expect(JSON.stringify(strict.events)).toContain("acp replay: frame 1");
		expect(strict.events.some((e) => e.kind === "report")).toBe(false);
		const lenient = await runScenario(
			"tool-call",
			engineOver("opencode", { replay: file, lenient: true }),
		);
		expect(checkScenario("tool-call", lenient)).toBeNull();
	}, 60_000);

	it("logs an unknown enum value and passes it through (#639)", async () => {
		const recording = await recordScriptedFake("tool-call");
		const drifted = recording.frames.map((f) =>
			f.frame.result && (f.frame.result as { stopReason?: string }).stopReason
				? { ...f, frame: { ...f.frame, result: { stopReason: "future_stop_reason" } } }
				: f,
		);
		expect(validateFrames(drifted).length).toBeGreaterThan(0);
		const file = join(scratch, "drift.ndjson");
		writeFileSync(file, serialize({ ...recording, frames: drifted }));
		const run = await runScenario("tool-call", engineOver("opencode", { replay: file }));
		expect(run.drift.join("\n")).toContain("future_stop_reason");
		expect(checkScenario("tool-call", run)).toBeNull();
	}, 60_000);

	it("refuses a recording that still holds a credential", () => {
		expect(leftoverCredentials(`{"token":"sk-${"a".repeat(30)}"}`)).toHaveLength(1);
		expect(leftoverCredentials('{"token":"<redacted>"}')).toEqual([]);
	});
});

describe("recording", () => {
	it("redacts by field name and by shape, and rewrites the home and checkout paths", async () => {
		const { redact } = await import("./acp-recording.js");
		const out = redact(
			{
				apiKey: "abc",
				text: "see /home/op/proj/a.ts and /home/op/.ssh with ghp_" + "b".repeat(36),
				nested: [{ Authorization: "Bearer x" }],
				ok: true,
			},
			{ home: "/home/op", cwd: "/home/op/proj" },
		);
		expect(out).toEqual({
			apiKey: "<redacted>",
			text: "see /checkout/a.ts and ~/.ssh with <redacted>",
			nested: [{ Authorization: "<redacted>" }],
			ok: true,
		});
	});
});
