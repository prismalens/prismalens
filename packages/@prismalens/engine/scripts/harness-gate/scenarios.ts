// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type Fixture, makeFixture, observe, PROMPT } from "./fixture.js";
import type { Driver, GateOptions, GateSession } from "./session.js";
import { sleep, withTimeout } from "./session.js";
import { judge, liveness, type RowResult, toolPairing } from "./verdict.js";

const INTERRUPT_PROMPT =
	"Without using any tools, write the numbers from one to three hundred as words, one per line.";
const FOLLOW_UP_PROMPT =
	"What exact value did NONCE.txt contain? Reply with only that value.";
export const MISSING_MODEL = "prismalens-gate-no-such-model";

async function withSession<T>(
	driver: Driver,
	fx: Fixture,
	opts: GateOptions,
	work: (s: GateSession) => Promise<T>,
): Promise<T> {
	const session = await driver.open(fx, opts);
	try {
		return await work(session);
	} finally {
		await session.close();
	}
}

export interface ScenarioOptions extends GateOptions {
	keepFixtures: boolean;
}

/** Runs every scenario once on fresh fixtures and returns the probed rows. */
export async function runScenarios(
	driver: Driver,
	opts: ScenarioOptions,
): Promise<RowResult> {
	const rows: RowResult = {};
	const dumps: Record<string, unknown> = {};
	const fixtures: Fixture[] = [];
	const fresh = () => {
		const fx = makeFixture();
		fixtures.push(fx);
		return fx;
	};

	// Base: the four tool calls, then a follow-up in the same session.
	const fx = fresh();
	try {
		await withSession(driver, fx, opts, async (s) => {
			const start = Date.now();
			const turn = await s.prompt(PROMPT, opts.timeoutMs);
			const end = Date.now();
			const observation = observe(fx, {
				finalText: turn.text,
				permissionRequests: s.events.flatMap((e) =>
					e.request ? [e.request] : [],
				),
				toolCalls: s.events.flatMap((e) =>
					e.kind === "tool" ? [`${e.name ?? ""} ${e.input ?? ""}`] : [],
				),
				ended: turn.settled && !turn.error,
				error: turn.error,
			});
			Object.assign(rows, judge(observation, fx));
			rows.R12 = toolPairing(s.events, fx.nonce);
			rows.R13 = liveness(s.events, start, end);
			const followUp = await s.prompt(FOLLOW_UP_PROMPT, opts.timeoutMs);
			rows.R14 = followUp.text.includes(fx.nonce);
			dumps.base = { observation, turn, followUp, events: s.events };
		});
	} catch (e) {
		dumps.baseError = String(e);
		for (const id of [
			"R1",
			"R2",
			"R3",
			"R4",
			"R5",
			"R12",
			"R13",
			"R14",
			"R15",
			"R18",
		])
			rows[id] ??= false;
	}

	// Interrupt: cancel a long text-only turn once it is visibly streaming.
	try {
		rows.R6 = await withSession(driver, fresh(), opts, async (s) => {
			const turn = s.prompt(INTERRUPT_PROMPT, opts.timeoutMs);
			const began = Date.now();
			while (!s.events.some((e) => e.kind === "text" || e.kind === "delta")) {
				if (Date.now() - began > 60_000) return false;
				await sleep(200);
			}
			await sleep(1_000);
			const cancelledAt = Date.now();
			await s.cancel();
			const result = await withTimeout(turn, 10_000, null);
			dumps.interrupt = {
				result,
				secondsToSettle: (Date.now() - cancelledAt) / 1000,
			};
			return result !== null && result.settled;
		});
	} catch (e) {
		dumps.interruptError = String(e);
		rows.R6 = false;
	}

	// Errors: a model the endpoint does not serve must fail fast, not hang.
	try {
		rows.R16 = await withSession(
			driver,
			fresh(),
			{ ...opts, model: MISSING_MODEL },
			async (s) => {
				const began = Date.now();
				const result = await s.prompt("Reply with: hi", 30_000);
				const seconds = (Date.now() - began) / 1000;
				dumps.error = { result, seconds };
				const surfaced =
					Boolean(result.error) ||
					!result.ended ||
					/not found|error|model/i.test(result.text);
				return result.settled && seconds <= 30 && surfaced;
			},
		);
	} catch (e) {
		// Refusing to open a session for an unknown model is also a fast, visible failure.
		dumps.errorOpen = String(e);
		rows.R16 = true;
	}

	for (const f of fixtures) {
		if (opts.keepFixtures) {
			writeFileSync(join(f.root, "dump.json"), JSON.stringify(dumps, null, 2));
			continue;
		}
		rmSync(f.root, {
			recursive: true,
			force: true,
			maxRetries: 5,
			retryDelay: 200,
		});
	}
	return rows;
}
