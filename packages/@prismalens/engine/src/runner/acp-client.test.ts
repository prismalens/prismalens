// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * A harness is an external binary and can die at any moment — wrong version, not
 * authenticated, OOM, killed by the OS. When it does, its pipes error
 * asynchronously, and Node rethrows an unhandled stream `error` event as an
 * uncaught exception. Under `pl up` one process serves the API, the UI and the
 * dispatch loop, so that ended the whole server instead of the one run.
 *
 * The sandbox port is injectable, so these drive the failure directly rather
 * than racing a real child's exit against a real write — which is exactly what
 * made this hard to catch: the same scenario reproduces only intermittently
 * through a spawned process.
 */
import { EventEmitter } from "node:events";
import { PassThrough, Readable, Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import type { Sandbox, SandboxProcess } from "../sandbox/types.js";
import { AcpSession } from "./acp-client.js";

/** A child whose stdin fails every write the way a dead peer's pipe does. */
function brokenPipeChild(code: string): SandboxProcess {
	const child = new EventEmitter() as EventEmitter & SandboxProcess;
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
function quietChild(): SandboxProcess {
	const child = new EventEmitter() as EventEmitter & SandboxProcess;
	child.stdin = new Writable({ write: (_c, _e, cb) => cb() });
	child.stdout = new PassThrough();
	child.stderr = Readable.from([]);
	child.killed = false;
	child.kill = () => true;
	return child;
}

function sandboxOf(child: SandboxProcess): Sandbox {
	return {
		id: "test",
		fidelity: "cooperative",
		spawn: () => child,
		destroy: async () => {},
	};
}

function sessionOver(child: SandboxProcess): AcpSession {
	return new AcpSession({
		command: "harness",
		args: [],
		cwd: "/tmp",
		sandbox: sandboxOf(child),
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
