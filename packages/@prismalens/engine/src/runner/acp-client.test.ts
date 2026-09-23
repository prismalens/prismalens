// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * A harness is an external binary and can die at any moment — wrong version, not
 * authenticated, OOM, killed by the OS. When it does, its pipes error
 * asynchronously, and Node rethrows an unhandled stream `error` event as an
 * uncaught exception. Under `pl up` one process serves the API, the UI and the
 * dispatch loop, so that ended the whole server instead of the one run.
 *
 * The launcher is injectable, so these drive the failure directly rather
 * than racing a real child's exit against a real write — which is exactly what
 * made this hard to catch: the same scenario reproduces only intermittently
 * through a spawned process.
 */
import { EventEmitter } from "node:events";
import { dirname, join } from "node:path";
import { PassThrough, Readable, Writable } from "node:stream";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { HarnessChild, HarnessLauncher } from "../launch/types.js";
import { AcpSession, type AcpStreamItem, offeredModels } from "./acp-client.js";

/** A child whose stdin fails every write the way a dead peer's pipe does. */
function brokenPipeChild(code: string): HarnessChild {
	const child = new EventEmitter() as EventEmitter & HarnessChild;
	child.stdin = new Writable({
		write(_chunk, _enc, cb) {
			const err: NodeJS.ErrnoException = new Error(`write ${code}`);
			err.code = code;
			cb(err);
		},
	});
	child.stdout = new PassThrough();
	child.stderr = Readable.from([Buffer.from("harness: fatal: not logged in\n")]);
	child.killed = false;
	child.kill = () => true;
	return child;
}

/** A child that accepts writes fine — used to fail stdout in isolation. */
function quietChild(): HarnessChild {
	const child = new EventEmitter() as EventEmitter & HarnessChild;
	child.stdin = new Writable({ write: (_c, _e, cb) => cb() });
	child.stdout = new PassThrough();
	child.stderr = Readable.from([]);
	child.killed = false;
	child.kill = () => true;
	return child;
}

function launcherOf(child: HarnessChild): HarnessLauncher {
	return {
		spawn: () => child,
		destroy: async () => {},
	};
}

function sessionOver(child: HarnessChild): AcpSession {
	return new AcpSession({
		command: "harness",
		args: [],
		cwd: "/tmp",
		launcher: launcherOf(child),
		permission: { mode: "readOnly" } as never,
		initTimeoutMs: 250,
	});
}

describe("AcpSession when the harness pipe dies", () => {
	for (const code of ["EPIPE", "ERR_STREAM_DESTROYED"]) {
		it(`fails the run instead of crashing the process on ${code}`, async () => {
			const uncaught: Error[] = [];
			const onUncaught = (err: Error) => uncaught.push(err);
			process.on("uncaughtException", onUncaught);

			try {
				const session = sessionOver(brokenPipeChild(code));
				// Before the fix this threw out of the process rather than
				// rejecting: the write error reached an stdin with no `error`
				// listener, and Node rethrew it as an uncaught exception.
				await expect(session.open()).rejects.toThrow();
				// Let any deferred stream error land before we judge.
				await new Promise((r) => setImmediate(r));
			} finally {
				process.off("uncaughtException", onUncaught);
			}

			expect(
				uncaught.map((e) => e.message),
				"a dead harness pipe must never reach the process",
			).toEqual([]);
		});
	}

	it("reports the harness's own stderr as the reason, not a bare write error", async () => {
		const session = sessionOver(brokenPipeChild("EPIPE"));
		await expect(session.open()).rejects.toThrow(/harness/i);
	});

	// The harness exits, its pipe EPIPEs on our write, and its `close` follows a
	// moment later. The EPIPE used to win and the reason lost the exit code and
	// the stderr — the difference between "stdin failed (write EPIPE)" and
	// "harness exited early (code=1): harness: fatal: not logged in", which is
	// the line a user can act on. It also made a macOS CI run flaky (#661).
	it("lets the child's own exit explain an EPIPE, not the write error", async () => {
		const child = brokenPipeChild("EPIPE");
		const session = sessionOver(child);
		const opening = session.open();
		setTimeout(() => child.emit("close", 1, null), 10);

		await expect(opening).rejects.toThrow(
			/harness exited early \(code=1[^)]*\).*not logged in/,
		);
	});

	it("still reports an EPIPE the child never explains", async () => {
		const session = sessionOver(brokenPipeChild("EPIPE"));
		await expect(session.open()).rejects.toThrow(/harness/i);
	});

	it("hands every stderr chunk to onStderr as it arrives", async () => {
		const child = brokenPipeChild("EPIPE");
		const seen: string[] = [];
		const session = new AcpSession({
			command: "harness",
			args: [],
			cwd: "/tmp",
			launcher: launcherOf(child),
			permission: { mode: "readOnly" } as never,
			initTimeoutMs: 250,
			onStderr: (chunk) => seen.push(chunk),
		});
		await expect(session.open()).rejects.toThrow(/harness/i);
		expect(seen.join("")).toContain("not logged in");
	});

	it("keeps a UTF-8 character split across two stderr chunks intact", async () => {
		const child = brokenPipeChild("EPIPE");
		const bytes = Buffer.from("harness: café ✓\n");
		const cut = bytes.indexOf(0xa9);
		child.stderr = Readable.from([bytes.subarray(0, cut), bytes.subarray(cut)], {
			objectMode: false,
		});
		const seen: string[] = [];
		const session = new AcpSession({
			command: "harness",
			args: [],
			cwd: "/tmp",
			launcher: launcherOf(child),
			permission: { mode: "readOnly" } as never,
			initTimeoutMs: 250,
			onStderr: (chunk) => seen.push(chunk),
		});
		await expect(session.open()).rejects.toThrow(/harness/i);
		expect(seen.join("")).toBe("harness: café ✓\n");
	});

	it("survives an error raised on stdout, not just stdin", async () => {
		const uncaught: Error[] = [];
		const onUncaught = (err: Error) => uncaught.push(err);
		process.on("uncaughtException", onUncaught);

		try {
			// stdin is healthy here, so stdout is the only thing that fails.
			const child = quietChild();
			const session = sessionOver(child);
			// Attach the rejection handler BEFORE emitting, or the failure lands
			// as an unhandled rejection instead of on the awaited promise.
			const opening = expect(session.open()).rejects.toThrow(/harness/i);
			setImmediate(() =>
				child.stdout.emit("error", new Error("stdout went away")),
			);
			await opening;
			await new Promise((r) => setImmediate(r));
		} finally {
			process.off("uncaughtException", onUncaught);
		}

		expect(uncaught.map((e) => e.message)).toEqual([]);
	});
});

const FAKE = join(
	dirname(fileURLToPath(import.meta.url)),
	"..",
	"run",
	"__fixtures__",
	"fake-acp-harness.mjs",
);

describe("AcpSession tolerant wire decoding", () => {
	it("an update with an unknown sessionUpdate kind, an unknown tool kind, an extra field and an unknown stopReason is passed through and the turn still ends with done", async () => {
		const session = new AcpSession({
			command: process.execPath,
			args: [FAKE],
			cwd: "/tmp",
			env: { ...process.env, FAKE_ACP_MODE: "tolerant" },
			permission: () => ({ allow: true, optionId: "once" }),
			initTimeoutMs: 5_000,
			promptTimeoutMs: 5_000,
		});

		await session.open();
		const items: AcpStreamItem[] = [];
		for await (const item of session.prompt("go")) {
			items.push(item);
		}
		await session.close();

		expect(
			items.some(
				(i) =>
					i.kind === "update" &&
					(i.update as Record<string, unknown>).sessionUpdate ===
						"unknown_session_update_kind" &&
					(i.update as Record<string, unknown>).extraField === "extra_update_val",
			),
		).toBe(true);

		expect(
			items.some(
				(i) =>
					i.kind === "update" &&
					(i.update as Record<string, unknown>).kind === "unknown_tool_kind" &&
					(i.update as Record<string, unknown>).extraField === "extra_tool_val",
			),
		).toBe(true);

		const last = items[items.length - 1];
		expect(last).toEqual({ kind: "done", stopReason: "unknown_stop_reason" });
	});
});

describe("offeredModels (#639)", () => {
	it("reads the model select option, flattening groups, and skips shapes it does not know", () => {
		expect(
			offeredModels([
				{ id: "mode", type: "select", category: "mode", currentValue: "a", options: [{ value: "a", name: "A" }] },
				{
					id: "model",
					type: "select",
					category: "model",
					currentValue: "m1",
					options: [
						{ value: "m1", name: "Model One" },
						{ group: "g", name: "Group", options: [{ value: "m2", name: "Model Two" }, { value: 3 }] },
						"garbage",
					],
				},
				{ id: "model-flag", type: "boolean", category: "model", currentValue: true },
			]),
		).toEqual([
			{ id: "m1", name: "Model One" },
			{ id: "m2", name: "Model Two" },
		]);
		expect(offeredModels(undefined)).toEqual([]);
		expect(offeredModels({ not: "an array" })).toEqual([]);
	});
});
