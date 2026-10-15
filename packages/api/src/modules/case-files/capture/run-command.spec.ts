// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import {
	captureEnv,
	NoKubectlError,
	reapLiveCaptures,
	resolveKubectl,
	runCommand,
} from "./run-command.js";

const node = process.execPath;
const run = (script: string, extra: Partial<Parameters<typeof runCommand>[0]> = {}) =>
	runCommand({
		bin: node,
		argv: ["-e", script],
		timeoutMs: 5_000,
		byteCap: 1024,
		...extra,
	});

describe("runCommand", () => {
	const saved = { ...process.env };
	afterEach(() => {
		process.env = { ...saved };
	});

	it("returns complete output and a zero exit", async () => {
		const res = await run('process.stdout.write("hello")');
		expect(res.stdout.toString()).toBe("hello");
		expect(res).toMatchObject({
			exitCode: 0,
			retrieval: "complete",
			retrievalReason: null,
		});
		expect(res.endedAt.getTime()).toBeGreaterThanOrEqual(
			res.startedAt.getTime(),
		);
	});

	it("cuts at the byte cap", async () => {
		const res = await run(
			'setInterval(() => process.stdout.write("x".repeat(512)), 5)',
		);
		expect(res.stdout.length).toBe(1024);
		expect(res).toMatchObject({
			retrieval: "partial",
			retrievalReason: "byte-cap",
		});
	});

	it("times out and on abort reports timeout", async () => {
		const slow = "setTimeout(() => {}, 10000)";
		expect(await run(slow, { timeoutMs: 100 })).toMatchObject({
			retrieval: "partial",
			retrievalReason: "timeout",
		});
		const ac = new AbortController();
		setTimeout(() => ac.abort(), 50);
		expect(await run(slow, { signal: ac.signal })).toMatchObject({
			retrievalReason: "timeout",
		});
	});

	it.skipIf(process.platform === "win32")(
		"a timeout kills the grandchild too",
		async () => {
			const res = await run(
				`const c = require("node:child_process").spawn(process.execPath, ["-e", "setTimeout(() => {}, 10000)"], { stdio: "ignore" });
				process.stdout.write(String(c.pid)); setTimeout(() => {}, 10000);`,
				{ timeoutMs: 300 },
			);
			const grandchild = Number(res.stdout.toString());
			await new Promise((r) => setTimeout(r, 100));
			expect(() => process.kill(grandchild, 0)).toThrow();
		},
	);

	it("gives the child no stdin", async () => {
		const res = await run(
			'process.stdin.on("data", () => {}).on("end", () => process.stdout.write("eof"))',
		);
		expect(res.stdout.toString()).toBe("eof");
	});

	it("a non-zero exit is partial(error) with the stderr tail", async () => {
		const res = await run('process.stderr.write("boom"); process.exit(3)');
		expect(res).toMatchObject({
			exitCode: 3,
			retrieval: "partial",
			retrievalReason: "error",
			stderrTail: "boom",
		});
	});

	it("a missing binary throws NoKubectlError", async () => {
		await expect(
			runCommand({
				bin: "/nonexistent/kubectl",
				argv: [],
				timeoutMs: 1_000,
				byteCap: 10,
			}),
		).rejects.toBeInstanceOf(NoKubectlError);
		expect(resolveKubectl("/nonexistent")).toBeNull();
	});

	it("passes KUBECONFIG and never PRISMALENS_*", () => {
		process.env.KUBECONFIG = "/tmp/kc";
		process.env.PRISMALENS_SECRET = "x";
		process.env.ENCRYPTION_KEY = "y";
		const env = captureEnv();
		expect(env.KUBECONFIG).toBe("/tmp/kc");
		expect(env.PRISMALENS_SECRET).toBeUndefined();
		expect(env.ENCRYPTION_KEY).toBeUndefined();
	});

	it("passes child env with KUBECONFIG kept and PRISMALENS_* dropped", async () => {
		process.env.KUBECONFIG = "/tmp/kc";
		process.env.PRISMALENS_SECRET = "x";
		const res = await run(
			'process.stdout.write(JSON.stringify({ kc: process.env.KUBECONFIG, sec: process.env.PRISMALENS_SECRET }))',
		);
		const data = JSON.parse(res.stdout.toString()) as {
			kc?: string;
			sec?: string;
		};
		expect(data.kc).toBe("/tmp/kc");
		expect(data.sec).toBeUndefined();
	});

	it("an already-aborted signal returns partial(timeout) without spawning", async () => {
		const ac = new AbortController();
		ac.abort();
		const res = await runCommand({
			bin: "/nonexistent/kubectl",
			argv: [],
			timeoutMs: 5_000,
			byteCap: 1024,
			signal: ac.signal,
		});
		expect(res).toMatchObject({
			exitCode: null,
			retrieval: "partial",
			retrievalReason: "timeout",
			stderrTail: "",
		});
		expect(res.stdout.length).toBe(0);
	});

	it("a non-ENOENT spawn error gives partial(error)", async () => {
		const res = await runCommand({
			bin: tmpdir(),
			argv: [],
			timeoutMs: 5_000,
			byteCap: 1024,
		});
		expect(res).toMatchObject({
			exitCode: null,
			retrieval: "partial",
			retrievalReason: "error",
		});
		expect(res.stderrTail).toContain("EACCES");
	});

	it("reapLiveCaptures kills running capture processes", async () => {
		const promise = run("setTimeout(() => {}, 10000)", { timeoutMs: 10_000 });
		await new Promise((r) => setTimeout(r, 100));
		reapLiveCaptures();
		const res = await promise;
		expect(res.retrieval).toBe("partial");
		expect(res.retrievalReason).toBe("error");
		expect(() => reapLiveCaptures()).not.toThrow();
	});

	it("truncates stderrTail to the last 2048 bytes across chunks", async () => {
		const res = await run(
			'process.stderr.write("a".repeat(100)); process.stderr.write("b".repeat(2500)); process.exit(1)',
		);
		expect(res.stderrTail).toBe("[stderr cut]");
	});

	it("drops the cut first line of a stderr tail, where a key can lose its head (#842 OBJ-011)", async () => {
		const tail = `ssword: HeadTrunc4ted\n${"z".repeat(2048 - 22)}`;
		const res = await run(`process.stderr.write("W".repeat(3000) + "\\nwarning: db pa" + ${JSON.stringify(tail)}); process.exit(1)`);
		expect(res.stderrTail).not.toContain("HeadTrunc4ted");
		expect(res.stderrTail).toBe(`[stderr cut]\n${"z".repeat(2048 - 22)}`);
		const whole = await run('process.stderr.write("line one\\nline two\\n"); process.exit(1)');
		expect(whole.stderrTail).toBe("line one\nline two\n");
	});

	it("resolveKubectl uses process.env.PATH by default", () => {
		process.env.PATH = "/nonexistent";
		expect(resolveKubectl()).toBeNull();
	});
});
