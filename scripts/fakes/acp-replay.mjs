// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// Replays a recorded ACP session (the format of acp-recording.ts) on stdio: it sends the
// agent's recorded frames and, in strict mode, fails on any client frame the recording
// does not have next (#914). Ids are matched by position; everything else by method and param keys.
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";

/** Exit code of a replay that met a frame the recording lacks. */
export const REPLAY_MISMATCH_EXIT = 97;

/**
 * @param {string} path
 * @returns {import("./acp-replay.d.mts").ReplayFrame[]}
 */
export function loadReplayFrames(path) {
	const [, ...rows] = readFileSync(path, "utf8")
		.split("\n")
		.filter((l) => l.trim());
	return rows.map((row) => JSON.parse(row));
}

/** @param {Record<string, unknown>} frame */
const kindOf = (frame) =>
	typeof frame.method === "string" ? frame.method : "response";

/** @param {Record<string, unknown>} frame */
const shapeOf = (frame) => {
	const body = frame.method ? frame.params : (frame.result ?? frame.error);
	return body && typeof body === "object"
		? Object.keys(body).sort().join(",")
		: "";
};

/**
 * @param {string} path
 * @param {{ strict?: boolean }} [options]
 */
export function runReplay(path, options = {}) {
	const strict = options.strict !== false;
	const frames = loadReplayFrames(path);
	let at = 0;
	/** @type {Map<unknown, unknown>} recorded request id to the id this client used */
	const ids = new Map();
	const send = (/** @type {Record<string, unknown>} */ frame) =>
		process.stdout.write(`${JSON.stringify(frame)}\n`);
	const flush = () => {
		while (frames[at]?.dir === "in") {
			const frame = { ...frames[at].frame };
			if (frame.method === undefined && ids.has(frame.id))
				frame.id = ids.get(frame.id);
			send(frame);
			at += 1;
		}
	};
	const fail = (/** @type {string} */ why) => {
		process.stderr.write(`acp replay: ${why}\n`);
		process.exit(REPLAY_MISMATCH_EXIT);
	};
	flush();
	createInterface({ input: process.stdin }).on("line", (line) => {
		let msg;
		try {
			msg = JSON.parse(line);
		} catch {
			return;
		}
		const expected = frames[at];
		if (!expected) {
			if (strict) fail(`unexpected ${kindOf(msg)} after the recording ended`);
			return;
		}
		if (strict) {
			const want = kindOf(expected.frame);
			const got = kindOf(msg);
			if (got !== want)
				fail(
					`frame ${at + 1}: the recording expects ${want}, the client sent ${got}`,
				);
			if (shapeOf(msg) !== shapeOf(expected.frame))
				fail(
					`frame ${at + 1} (${got}): params differ from the recording (${shapeOf(msg)} vs ${shapeOf(expected.frame)})`,
				);
		}
		if (msg.method !== undefined && msg.id !== undefined)
			ids.set(expected.frame.id, msg.id);
		at += 1;
		flush();
	});
}
