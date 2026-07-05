/**
 * Hermetic tests for the `process`-floor Sandbox provider (ADR-0020/ADR-0009): the
 * child env must be built from the allowlist (never process.env verbatim), the
 * caller's env must win, and destroy() must reap live children. No network/LLM.
 */
import { once } from "node:events";
import { afterEach, describe, expect, it } from "vitest";
import { buildFloorEnv, createProcessFloorSandbox } from "./process-floor.js";

const SECRET = "PRISMALENS_FLOOR_TEST_SECRET";

afterEach(() => {
	delete process.env[SECRET];
});

describe("buildFloorEnv (own-secret isolation, ADR-0009)", () => {
	it("drops host secrets that are not on the allowlist", () => {
		process.env[SECRET] = "leak-me";
		const env = buildFloorEnv();
		expect(env[SECRET]).toBeUndefined();
	});

	it("keeps allowlisted vars and layers the caller's env on top", () => {
		process.env[SECRET] = "leak-me";
		const env = buildFloorEnv({ OPENAI_API_KEY: "byo-key", TZ: "UTC" });
		expect(env.OPENAI_API_KEY).toBe("byo-key");
		expect(env.TZ).toBe("UTC"); // caller wins over the inherited value
		expect(env[SECRET]).toBeUndefined();
		if (process.env.PATH !== undefined) expect(env.PATH).toBe(process.env.PATH);
	});

	it("skips undefined caller entries instead of stringifying them", () => {
		const env = buildFloorEnv({ OPENAI_BASE_URL: undefined });
		expect("OPENAI_BASE_URL" in env).toBe(false);
	});
});

describe("createProcessFloorSandbox", () => {
	it("spawns a duplex-stdio child with the scrubbed env", async () => {
		process.env[SECRET] = "leak-me";
		const sandbox = createProcessFloorSandbox();
		expect(sandbox.id).toBe("process-floor");
		expect(sandbox.fidelity).toBe("cooperative");
		const child = sandbox.spawn(
			process.execPath,
			["-e", "process.stdout.write(JSON.stringify(process.env))"],
			{ cwd: process.cwd(), env: { OPENAI_API_KEY: "byo-key" } },
		);
		const chunks: Buffer[] = [];
		child.stdout.on("data", (d: Buffer) => chunks.push(d));
		await once(child, "close");
		const childEnv = JSON.parse(Buffer.concat(chunks).toString()) as Record<
			string,
			string
		>;
		expect(childEnv.OPENAI_API_KEY).toBe("byo-key");
		expect(childEnv[SECRET]).toBeUndefined();
		await sandbox.destroy();
	});

	it("destroy() kills children still running inside the boundary", async () => {
		const sandbox = createProcessFloorSandbox();
		const child = sandbox.spawn(
			process.execPath,
			["-e", "setInterval(() => {}, 1000)"],
			{ cwd: process.cwd() },
		);
		const closed = once(child, "close");
		await sandbox.destroy();
		await closed;
		expect(child.killed).toBe(true);
	});
});
