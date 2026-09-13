// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resetConfig } from "@prismalens/config";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	createChildLogger,
	enrichContext,
	getCurrentWideEvent,
	getLogger,
	getRequestId,
	getRequestScope,
	Logger,
	runInRequestContext,
} from "./index.js";
import {
	createLogger,
	runWithWideEvent,
	runWithWideEventSync,
} from "./integrations/standalone/index.js";

async function waitForFileContent(
	filePath: string,
	minLines = 1,
	timeoutMs = 3000,
): Promise<string> {
	const start = Date.now();
	while (Date.now() - start < timeoutMs) {
		if (existsSync(filePath)) {
			const content = readFileSync(filePath, "utf-8");
			const lines = content.trim().split("\n").filter(Boolean);
			if (lines.length >= minLines) {
				return content;
			}
		}
		await new Promise((r) => setTimeout(r, 50));
	}
	return existsSync(filePath) ? readFileSync(filePath, "utf-8") : "";
}

describe("Pino Logger Integration", () => {
	let testDir: string;
	const originalEnv = { ...process.env };

	beforeEach(() => {
		testDir = join(
			tmpdir(),
			`prismalens-logger-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
		);
		mkdirSync(testDir, { recursive: true });
		Logger.resetInstance();
		resetConfig();
	});

	afterEach(() => {
		process.env = { ...originalEnv };
		Logger.resetInstance();
		resetConfig();
		vi.restoreAllMocks();
		try {
			rmSync(testDir, { recursive: true, force: true });
		} catch {}
	});

	describe("File rotation and console streaming modes", () => {
		it("logs to file and quiet console mode outputs 0 lines to stdout", async () => {
			process.env.PRISMALENS_WORKSPACE_DIR = testDir;
			delete process.env.PRISMALENS_LOG_FILE_LOCATION;
			process.env.PRISMALENS_LOG_CONSOLE = "quiet";
			process.env.PRISMALENS_LOG_LEVEL = "debug";

			let stdoutChunks = "";
			let stderrChunks = "";
			vi.spyOn(process.stdout, "write").mockImplementation((str: unknown) => {
				stdoutChunks += String(str);
				return true;
			});
			vi.spyOn(process.stderr, "write").mockImplementation((str: unknown) => {
				stderrChunks += String(str);
				return true;
			});

			const logger = new Logger("QuietModeTest");
			logger.info("Informational message in quiet mode");
			logger.warn("Warning message in quiet mode");

			const logFile = join(testDir, "logs", "prismalens.1.log");
			const content = await waitForFileContent(logFile, 2);
			const lines = content.trim().split("\n").filter(Boolean);

			expect(lines.length).toBeGreaterThanOrEqual(2);
			const parsed = lines.map((l) => JSON.parse(l));
			expect(
				parsed.some((p) => p.msg === "Informational message in quiet mode"),
			).toBe(true);
			expect(parsed.some((p) => p.msg === "Warning message in quiet mode")).toBe(
				true,
			);

			// In quiet mode, info is not logged to console, and warn goes to stderr
			expect(stdoutChunks).toBe("");
			expect(stderrChunks).toContain("Warning message in quiet mode");
		});

		it("verbose console mode outputs both info and warn lines to stdout", async () => {
			process.env.PRISMALENS_WORKSPACE_DIR = testDir;
			delete process.env.PRISMALENS_LOG_FILE_LOCATION;
			process.env.PRISMALENS_LOG_CONSOLE = "verbose";
			process.env.PRISMALENS_LOG_LEVEL = "debug";

			let stdoutChunks = "";
			vi.spyOn(process.stdout, "write").mockImplementation((str: unknown) => {
				stdoutChunks += String(str);
				return true;
			});

			const logger = new Logger("VerboseModeTest");
			logger.info("Verbose info message");
			logger.warn("Verbose warn message");

			const logFile = join(testDir, "logs", "prismalens.1.log");
			const content = await waitForFileContent(logFile, 2);
			const lines = content.trim().split("\n").filter(Boolean);
			expect(lines.length).toBeGreaterThanOrEqual(2);

			expect(stdoutChunks).toContain("Verbose info message");
			expect(stdoutChunks).toContain("Verbose warn message");
		});
	});

	describe("Redaction hook", () => {
		it("redacts nested secrets at any depth", async () => {
			process.env.PRISMALENS_WORKSPACE_DIR = testDir;
			delete process.env.PRISMALENS_LOG_FILE_LOCATION;
			process.env.PRISMALENS_LOG_LEVEL = "debug";

			const logger = new Logger("RedactionTest");
			logger.info("Inbound request with secrets", {
				headers: {
					authorization: "Bearer super-secret-jwt-token",
					cookie: "session_id=12345; auth=abcdef",
				},
				credentials: {
					password: "UserPassword123!",
					apiKey: "pk_live_123456789",
				},
				safeField: "safe-value",
			});

			const logFile = join(testDir, "logs", "prismalens.1.log");
			const content = await waitForFileContent(logFile, 1);
			expect(content).not.toContain("Bearer super-secret-jwt-token");
			expect(content).not.toContain("UserPassword123!");
			expect(content).not.toContain("pk_live_123456789");
			expect(content).toContain("[redacted]");
			expect(content).toContain("safe-value");
		});
	});

	describe("Standalone AsyncLocalStorage context", () => {
		it("binds jobId and enriches context in runWithWideEvent", async () => {
			let insideScope: ReturnType<typeof getRequestScope>;

			await runWithWideEvent("job-alpha-42", async () => {
				enrichContext({ traceId: "trace-xyz", tenantId: "tenant-1" });
				insideScope = getRequestScope();
				expect(getRequestId()).toBe("job-alpha-42");
				expect(getCurrentWideEvent()).toEqual({
					requestId: "job-alpha-42",
					traceId: "trace-xyz",
					tenantId: "tenant-1",
				});
			});

			expect(insideScope).toBeDefined();
			expect(getRequestScope()).toBeUndefined();
		});

		it("binds jobId and enriches context in runWithWideEventSync", () => {
			const result = runWithWideEventSync("sync-job-1", () => {
				enrichContext({ step: "init" });
				expect(getRequestId()).toBe("sync-job-1");
				return 42;
			});

			expect(result).toBe(42);
			expect(getRequestScope()).toBeUndefined();
		});
	});

	describe("Logger prototype methods", () => {
		it("supports vi.spyOn(Logger.prototype, 'warn')", () => {
			const warnSpy = vi
				.spyOn(Logger.prototype, "warn")
				.mockImplementation(() => {});
			const logger = new Logger("SpyTest");
			logger.warn("testing warn spy");
			expect(warnSpy).toHaveBeenCalledWith("testing warn spy");
		});

		it("supports vi.spyOn(Logger.prototype, 'error')", () => {
			const errorSpy = vi
				.spyOn(Logger.prototype, "error")
				.mockImplementation(() => {});
			const logger = new Logger("SpyTest");
			const err = new Error("something went wrong");
			logger.error("testing error spy", err);
			expect(errorSpy).toHaveBeenCalledWith("testing error spy", err);
		});

		it("supports getLogger and createChildLogger", () => {
			const root = getLogger();
			expect(root).toBeInstanceOf(Logger);
			const child = createChildLogger("ChildContext");
			expect(child).toBeInstanceOf(Logger);
			expect(child.getContext()).toBe("ChildContext");
		});
	});
});
