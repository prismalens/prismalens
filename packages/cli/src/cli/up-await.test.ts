// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { spawn } from "node:child_process";
import { describe, expect, it } from "vitest";
import { awaitReplacedProcess } from "./up.js";

describe("awaitReplacedProcess", () => {
	it("returns at once without a pid, and clears the variable", async () => {
		const env: NodeJS.ProcessEnv = { PRISMALENS_AWAIT_PID: "nope" };
		await awaitReplacedProcess(env);
		expect(env.PRISMALENS_AWAIT_PID).toBeUndefined();
	});

	it("waits until the replaced process has exited", async () => {
		const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 400)"]);
		const exited = new Promise((r) => child.on("exit", r));
		let done = false;
		const env: NodeJS.ProcessEnv = { PRISMALENS_AWAIT_PID: String(child.pid) };
		const waiting = awaitReplacedProcess(env).then(() => {
			done = true;
		});
		await new Promise((r) => setTimeout(r, 100));
		expect(done).toBe(false);
		await exited;
		await waiting;
		expect(done).toBe(true);
	});
});
