// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Records one real agent session at the engine's ACP transport, on the operator's
 * machine with the agent's existing login, when a pin moves (#914). It writes
 * scripts/fakes/transcripts/<harness>/<scenario>.ndjson and never touches a row's
 * `tested`: that changes only in the merged bump PR.
 *
 *   pnpm record:agent <harness> <scenario|all> [--clone <dir>] [--force]
 */
import { spawnSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
	HARNESS_IDS,
	HARNESS_REGISTRY,
	type HarnessId,
} from "@prismalens/config/harness";
import {
	framesFromTranscript,
	leftoverCredentials,
	RECORDING_VERSION,
	type RecordedFrame,
	type Recording,
	serialize,
	validateFrames,
} from "./acp-recording.js";
import {
	checkScenario,
	needsSignedOutAgent,
	runScenario,
	SCENARIOS,
	type ScenarioName,
} from "./acp-scenarios.js";

const HERE = dirname(fileURLToPath(import.meta.url));
export const TRANSCRIPTS_DIR = resolve(
	HERE,
	"../../../../scripts/fakes/transcripts",
);

const SEMVER = /\d+\.\d+\.\d+(?:[-+][\w.]+)?/;

function versionOf(binary: string, env: NodeJS.ProcessEnv): string {
	const out = spawnSync(binary, ["--version"], {
		encoding: "utf8",
		env,
		shell: process.platform === "win32",
	});
	return SEMVER.exec(`${out.stdout}${out.stderr}`)?.[0] ?? "unknown";
}

/** The `initialize` and `session/new` answers: who the agent says it is, and the model it served. */
function whoAnswered(frames: RecordedFrame[]): {
	adapterVersion: string;
	model: string;
} {
	const results = (id: unknown) =>
		frames.find(
			(f) => f.dir === "in" && f.frame.id === id && "result" in f.frame,
		)?.frame.result as Record<string, unknown> | undefined;
	const idOf = (method: string) =>
		frames.find((f) => f.dir === "out" && f.frame.method === method)?.frame.id;
	const info = results(idOf("initialize"))?.agentInfo as
		| { version?: string }
		| undefined;
	const options = results(idOf("session/new"))?.configOptions as
		| { category?: string; currentValue?: string }[]
		| undefined;
	return {
		adapterVersion: info?.version ?? "unknown",
		model:
			options?.find((o) => o.category === "model")?.currentValue ?? "unknown",
	};
}

export async function record(
	harness: HarnessId,
	scenario: ScenarioName,
	clone: string,
	force: boolean,
): Promise<string> {
	const descriptor = HARNESS_REGISTRY[harness];
	const home = mkdtempSync(join(tmpdir(), "pl-record-home-"));
	const runDir = mkdtempSync(join(tmpdir(), "pl-record-run-"));
	try {
		const env = needsSignedOutAgent(scenario)
			? { PATH: process.env.PATH, HOME: home, USERPROFILE: home }
			: process.env;
		const run = await runScenario(scenario, {
			harness,
			cwd: clone,
			runDir,
			env,
		});
		const problem = checkScenario(scenario, run);
		if (problem && !force)
			throw new Error(
				`the live run did not show the scenario: ${problem}. Fix the setup, or pass --force to keep it`,
			);
		const frames = framesFromTranscript(
			readFileSync(join(runDir, "transcript.jsonl"), "utf8"),
			{ home: homedir(), cwd: clone },
		);
		const { adapterVersion, model } = whoAnswered(frames);
		const adapterName = descriptor.adapterPackage ?? descriptor.binary;
		const recording: Recording = {
			header: {
				acp_recording: RECORDING_VERSION,
				agent: {
					name: harness,
					version: versionOf(
						descriptor.companionBinary ?? descriptor.binary,
						process.env,
					),
				},
				adapter: { name: adapterName, version: adapterVersion },
				model,
				recorded_at: new Date().toISOString(),
				recorder: { name: "prismalens", version: "acp-record" },
				scenario,
			},
			frames,
		};
		const problems = validateFrames(frames);
		if (problems.length)
			throw new Error(
				`${problems.length} frame(s) fail the ACP schema, nothing written: ${JSON.stringify(problems.slice(0, 3))}`,
			);
		const text = serialize(recording);
		const leaked = leftoverCredentials(text);
		if (leaked.length)
			throw new Error(
				`${leaked.length} credential-shaped value(s) survived redaction, nothing written`,
			);
		const file = join(TRANSCRIPTS_DIR, harness, `${scenario}.ndjson`);
		mkdirSync(dirname(file), { recursive: true });
		writeFileSync(file, text);
		return file;
	} finally {
		rmSync(home, { recursive: true, force: true });
		rmSync(runDir, { recursive: true, force: true });
	}
}

async function main(): Promise<void> {
	const { values, positionals } = parseArgs({
		options: {
			clone: { type: "string" },
			force: { type: "boolean", default: false },
		},
		allowPositionals: true,
	});
	const [harness, which] = positionals;
	if (
		!harness ||
		!HARNESS_IDS.includes(harness as HarnessId) ||
		!which ||
		(which !== "all" && !SCENARIOS.includes(which as ScenarioName))
	) {
		console.error(
			`usage: record:agent <${HARNESS_IDS.join("|")}> <${SCENARIOS.join("|")}|all> [--clone <dir>] [--force]`,
		);
		process.exit(2);
	}
	const clone = resolve(values.clone ?? process.env.INIT_CWD ?? process.cwd());
	if (!existsSync(clone)) {
		console.error(`no such clone: ${clone}`);
		process.exit(2);
	}
	let failed = 0;
	for (const scenario of which === "all"
		? SCENARIOS
		: [which as ScenarioName]) {
		try {
			console.log(
				`${scenario}: wrote ${await record(harness as HarnessId, scenario, clone, values.force)}`,
			);
		} catch (err) {
			failed += 1;
			console.error(`${scenario}: ${err instanceof Error ? err.message : err}`);
		}
	}
	console.log(
		"Commit the transcripts with the bump PR. `tested` stays as the bump PR sets it; this recorder never changes it.",
	);
	process.exit(failed ? 1 : 0);
}

if (
	process.argv[1] &&
	resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
	await main();
