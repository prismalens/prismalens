// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Tests for the `e2b` Sandbox provider (ADR-0020 cloud row / ADR-0011 dependency-light).
 * Three kinds:
 *  - HERMETIC (unavailable): E2B is not resolvable in CI (the engine has no `e2b` dep and
 *    no `E2B_API_KEY`) — construction must FAIL CLEARLY, never silently degrade, and
 *    {@link isE2bAvailable} must report false.
 *  - HERMETIC (transport): the intricate bit — stdin buffering/replay/EOF ordering, the
 *    wall-clock deadline, close/error settlement, VM-lifetime headroom — driven through
 *    {@link E2bSandboxOptions.loader}, a fake `e2b` module, so it runs unconditionally in
 *    CI rather than only behind the (never-true-in-CI) `isE2bAvailable()` guard below.
 *  - GUARDED SMOKE: when the host actually has the `e2b` package + `E2B_API_KEY`, a real
 *    duplex-stdio round-trip through a remote microVM. Skipped by default so the suite
 *    stays offline.
 */
import { once } from "node:events";
import { describe, expect, it } from "vitest";
import { createE2bSandbox, isE2bAvailable } from "./e2b.js";

describe.skipIf(isE2bAvailable())(
	"createE2bSandbox (E2B unavailable — dependency-light default)",
	() => {
		it("reports unavailable", () => {
			expect(isE2bAvailable()).toBe(false);
		});

		it("throws a clear, actionable error instead of degrading", () => {
			expect(() => createE2bSandbox()).toThrowError(/e2b sandbox unavailable/);
			// The message must point the user at a fix (install the package / set the key,
			// or switch mode).
			expect(() =>
				createE2bSandbox({ allowedDomains: ["api.openai.com"] }),
			).toThrowError(/e2b|--sandbox process/);
		});
	},
);

// --- Hermetic transport-logic coverage (review finding) ---------------------------
// The real round-trip below never runs in CI (no `e2b` package / `E2B_API_KEY`), which
// left the adapter's actual transport logic — stdin buffering/replay/EOF ordering, the
// wall-clock deadline, close/error settlement, VM-lifetime headroom — completely
// unexercised. `E2bSandboxOptions.loader` lets us inject a fake `e2b` module so all of
// that runs hermetically, unconditionally, on every CI run.

/** A promise plus its external resolve/reject, for controlling async resolution timing. */
function deferred<T>(): {
	promise: Promise<T>;
	resolve: (value: T) => void;
	reject: (err: unknown) => void;
} {
	let resolve!: (value: T) => void;
	let reject!: (err: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

/**
 * Flush the microtask queue. `setImmediate` runs in the check phase, after Node has
 * fully drained the microtask queue (including microtasks chained during that drain) —
 * so one flush is enough to let the adapter's internal promise chains (attach → forward
 * → sendStdin/closeStdin, wait() → closeWith/failWith) settle, regardless of how many
 * links are chained.
 */
const flush = (): Promise<void> =>
	new Promise((resolve) => setImmediate(resolve));

/** What the adapter's `commands.run({ onStdout, onStderr, ... })` call is given. */
interface FakeRunOpts {
	cwd?: string;
	envs?: Record<string, string>;
	onStdout?: (data: string) => void;
	onStderr?: (data: string) => void;
}

/**
 * A fake `E2bCommandHandle`: records `sendStdin`/`closeStdin` calls in the order the
 * adapter actually issues them, and exposes a controllable `wait()` so tests can decide
 * exactly when (and how) the remote command "finishes".
 */
class FakeHandle {
	readonly calls: string[] = [];
	killCount = 0;
	/** Run when `kill()` is invoked — tests use this to simulate the remote termination
	 * that (in real E2B) causes the in-flight `wait()` to settle. */
	onKill: () => void = () => {};
	private readonly waitDeferred = deferred<{ exitCode?: number }>();

	async sendStdin(data: string | Uint8Array): Promise<void> {
		const text = typeof data === "string" ? data : Buffer.from(data).toString();
		this.calls.push(`sendStdin:${text}`);
	}

	async closeStdin(): Promise<void> {
		this.calls.push("closeStdin");
	}

	async kill(): Promise<boolean> {
		this.killCount++;
		this.onKill();
		return true;
	}

	wait(): Promise<{ exitCode?: number }> {
		return this.waitDeferred.promise;
	}

	resolveWait(result: { exitCode?: number }): void {
		this.waitDeferred.resolve(result);
	}

	rejectWait(err: unknown): void {
		this.waitDeferred.reject(err);
	}
}

/**
 * A fake `e2b` module: `Sandbox.create` records every options object it is given
 * (synchronously — see the VM-lifetime tests) and resolves to a fake VM whose
 * `commands.run` delegates to `run` and whose `kill()` is counted.
 */
function makeFakeVm(run: (opts: FakeRunOpts) => Promise<FakeHandle>) {
	const createOptsCalls: Record<string, unknown>[] = [];
	let vmKillCount = 0;
	const vm = {
		sandboxId: "fake-vm",
		commands: {
			run: async (_cmd: string, opts: FakeRunOpts) => run(opts),
		},
		kill: async () => {
			vmKillCount++;
			return true;
		},
	};
	const loader = () => ({
		Sandbox: {
			create: async (_template: string, opts: Record<string, unknown>) => {
				createOptsCalls.push(opts);
				return vm;
			},
		},
	});
	return {
		loader,
		createOptsCalls,
		get vmKillCount() {
			return vmKillCount;
		},
	};
}

describe("createE2bSandbox (hermetic transport logic, injected e2b loader)", () => {
	it("buffers pre-attach stdin writes and replays them in order, EOF last", async () => {
		const handle = new FakeHandle();
		const runDeferred = deferred<FakeHandle>();
		const fake = makeFakeVm(() => runDeferred.promise);
		const sandbox = createE2bSandbox({
			apiKey: "test-key",
			loader: fake.loader,
		});
		try {
			const proc = sandbox.spawn("harness", [], { cwd: "/work" });
			// Written BEFORE `commands.run` resolves — must be buffered, not dropped, and
			// must never let EOF (closeStdin) overtake the buffered payload.
			proc.stdin.write(`${JSON.stringify({ id: 1 })}\n`);
			proc.stdin.write(`${JSON.stringify({ id: 2 })}\n`);
			proc.stdin.end();
			await once(proc.stdin, "finish");
			expect(handle.calls).toEqual([]); // no remote handle yet — nothing sent
			runDeferred.resolve(handle);
			await flush();
			expect(handle.calls).toEqual([
				`sendStdin:${JSON.stringify({ id: 1 })}\n`,
				`sendStdin:${JSON.stringify({ id: 2 })}\n`,
				"closeStdin",
			]);
		} finally {
			await sandbox.destroy();
		}
	});

	it("relays remote stdout/stderr into the readline-compatible stdio streams", async () => {
		const handle = new FakeHandle();
		let callbacks: FakeRunOpts = {};
		const fake = makeFakeVm(async (opts) => {
			callbacks = opts;
			return handle;
		});
		const sandbox = createE2bSandbox({
			apiKey: "test-key",
			loader: fake.loader,
		});
		try {
			const proc = sandbox.spawn("harness", [], { cwd: "/work" });
			await flush(); // let create()+run() settle so onStdout/onStderr are captured
			const out: Buffer[] = [];
			const err: Buffer[] = [];
			proc.stdout.on("data", (d: Buffer) => out.push(Buffer.from(d)));
			proc.stderr.on("data", (d: Buffer) => err.push(Buffer.from(d)));
			callbacks.onStdout?.("hello\n");
			callbacks.onStderr?.("oops\n");
			expect(Buffer.concat(out).toString()).toBe("hello\n");
			expect(Buffer.concat(err).toString()).toBe("oops\n");
		} finally {
			await sandbox.destroy();
		}
	});

	it("wait() resolving cleanly emits close(0) with timedOut false", async () => {
		const handle = new FakeHandle();
		const fake = makeFakeVm(async () => handle);
		const sandbox = createE2bSandbox({
			apiKey: "test-key",
			loader: fake.loader,
		});
		try {
			const proc = sandbox.spawn("harness", [], { cwd: "/work" });
			await flush();
			handle.resolveWait({ exitCode: 0 });
			const [code, signal] = (await once(proc, "close")) as [
				number | null,
				NodeJS.Signals | null,
			];
			expect(code).toBe(0);
			expect(signal).toBeNull();
			expect(proc.timedOut).toBe(false);
		} finally {
			await sandbox.destroy();
		}
	});

	it("SIGKILLs on the wallClockMs deadline and reports timedOut", async () => {
		const handle = new FakeHandle();
		// Real E2B: killing the remote command causes its own in-flight `wait()` to
		// settle. Simulate that so the test proves the deadline path drives a real
		// `close`, not just a fire-and-forget `kill()` that leaves the process hanging.
		handle.onKill = () => handle.resolveWait({});
		const fake = makeFakeVm(async () => handle);
		const sandbox = createE2bSandbox({
			apiKey: "test-key",
			loader: fake.loader,
		});
		try {
			const proc = sandbox.spawn("harness", [], {
				cwd: "/work",
				limits: { wallClockMs: 50 },
			});
			expect(proc.appliedLimits?.wallClockMs).toBe(50);
			await once(proc, "close"); // wait() never resolves on its own — only the kill unblocks it
			expect(proc.timedOut).toBe(true);
			expect(proc.killed).toBe(true);
			expect(handle.killCount).toBeGreaterThanOrEqual(1);
		} finally {
			await sandbox.destroy();
		}
	});

	describe("VM lifetime honesty (headroom over wallClockMs, review finding B.1.3)", () => {
		it("raises the VM timeout to cover a long wallClockMs deadline", () => {
			const fake = makeFakeVm(() => new Promise(() => {}));
			const sandbox = createE2bSandbox({
				apiKey: "test-key",
				loader: fake.loader,
			});
			sandbox.spawn("harness", [], {
				cwd: "/work",
				limits: { wallClockMs: 900_000 },
			});
			expect(fake.createOptsCalls).toHaveLength(1);
			expect(fake.createOptsCalls[0]?.timeoutMs).toBeGreaterThanOrEqual(
				960_000,
			);
		});

		it("passes no timeoutMs when neither wallClockMs nor options.timeoutMs is set", () => {
			const fake = makeFakeVm(() => new Promise(() => {}));
			const sandbox = createE2bSandbox({
				apiKey: "test-key",
				loader: fake.loader,
			});
			sandbox.spawn("harness", [], { cwd: "/work" });
			expect("timeoutMs" in (fake.createOptsCalls[0] ?? {})).toBe(false);
		});

		it("takes the max of options.timeoutMs and wallClockMs+headroom", () => {
			const fake = makeFakeVm(() => new Promise(() => {}));
			const sandbox = createE2bSandbox({
				apiKey: "test-key",
				timeoutMs: 120_000,
				loader: fake.loader,
			});
			sandbox.spawn("harness", [], {
				cwd: "/work",
				limits: { wallClockMs: 900_000 },
			});
			expect(fake.createOptsCalls[0]?.timeoutMs).toBe(960_000);
		});
	});

	it("commands.run rejecting settles the process with 'error' — never a hang", async () => {
		const fake = makeFakeVm(async () => {
			throw new Error("vm exploded");
		});
		const sandbox = createE2bSandbox({
			apiKey: "test-key",
			loader: fake.loader,
		});
		try {
			const proc = sandbox.spawn("harness", [], { cwd: "/work" });
			const [err] = (await once(proc, "error")) as [Error];
			expect(err.message).toBe("vm exploded");
			// failWith() only emits 'close' as a courtesy to an explicit kill()
			// (`if (this.killed) { this.closeWith(null); return; }`) — a transport failure
			// that was never killed settles via 'error' alone, and never fires 'close' too.
			// The ACP client (acp-client.ts) independently finishes on 'error', so this does
			// not hang the caller — but it does mean a listener that ONLY awaits 'close'
			// (as the srt/process-floor round-trips do) would hang on this path.
			let closed = false;
			proc.on("close", () => {
				closed = true;
			});
			await flush();
			expect(closed).toBe(false);
		} finally {
			await sandbox.destroy();
		}
	});

	it("destroy() kills a live proc and the VM", async () => {
		const handle = new FakeHandle();
		const fake = makeFakeVm(async () => handle);
		const sandbox = createE2bSandbox({
			apiKey: "test-key",
			loader: fake.loader,
		});
		const proc = sandbox.spawn("harness", [], { cwd: "/work" });
		await flush();
		expect(proc.killed).toBe(false);
		await sandbox.destroy();
		expect(proc.killed).toBe(true);
		expect(fake.vmKillCount).toBe(1);
	});
});

describe.skipIf(!isE2bAvailable())(
	"createE2bSandbox (real E2B round-trip)",
	() => {
		it("holds a duplex stdio channel to a command inside the remote VM", async () => {
			const sandbox = createE2bSandbox();
			expect(sandbox.id).toBe("e2b");
			expect(sandbox.fidelity).toBe("enforced");
			try {
				// `cat` echoes stdin→stdout: write a line, close stdin (EOF ⇒ cat exits),
				// and prove the bytes survived the remote boundary both ways.
				const child = sandbox.spawn("cat", [], { cwd: "/home/user" });
				const chunks: Buffer[] = [];
				child.stdout.on("data", (d: Buffer) => chunks.push(Buffer.from(d)));
				child.stdin.write("ping-line\n");
				child.stdin.end();
				await once(child, "close");
				expect(Buffer.concat(chunks).toString()).toContain("ping-line");
			} finally {
				await sandbox.destroy();
			}
		}, 120_000);
	},
);
