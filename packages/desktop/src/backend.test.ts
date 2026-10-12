// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveBackendMain, stopBackend, waitForHealth } from "./backend.js";

describe("backend", () => {
	describe("resolveBackendMain", () => {
		let tempDirs: string[] = [];

		const createTempDir = (prefix: string): string => {
			const dir = mkdtempSync(join(tmpdir(), prefix));
			tempDirs.push(dir);
			return dir;
		};

		afterEach(() => {
			for (const dir of tempDirs) {
				rmSync(dir, { recursive: true, force: true });
			}
			tempDirs = [];
		});

		it("resolves from PRISMALENS_DESKTOP_BACKEND when pointing to a dir holding dist/bin/prismalens.js", () => {
			const tempDir = createTempDir("pl-backend-");
			const binDir = join(tempDir, "dist", "bin");
			mkdirSync(binDir, { recursive: true });
			const jsPath = join(binDir, "prismalens.js");
			writeFileSync(jsPath, "// dummy backend entry");

			const result = resolveBackendMain({
				resourcesPath: "/ignored/resources",
				env: { PRISMALENS_DESKTOP_BACKEND: tempDir },
			});
			expect(result).toBe(jsPath);
		});

		it("resolves from resourcesPath when PRISMALENS_DESKTOP_BACKEND is unset and file exists", () => {
			const tempResources = createTempDir("pl-resources-");
			const binDir = join(
				tempResources,
				"prismalens.asar",
				"prismalens",
				"dist",
				"bin",
			);
			mkdirSync(binDir, { recursive: true });
			const jsPath = join(binDir, "prismalens.js");
			writeFileSync(jsPath, "// dummy packaged backend");

			const result = resolveBackendMain({
				resourcesPath: tempResources,
				env: {},
			});
			expect(result).toBe(jsPath);
		});

		it("throws naming the directory when missing", () => {
			const missingResources = "/nonexistent/test-resources-dir";
			expect(() =>
				resolveBackendMain({
					resourcesPath: missingResources,
					env: {},
				}),
			).toThrowError(
				`No packed prismalens at ${join(missingResources, "prismalens.asar", "prismalens")}.`,
			);

			const missingBackendDir = "/nonexistent/test-backend-env";
			expect(() =>
				resolveBackendMain({
					resourcesPath: "/ignored",
					env: { PRISMALENS_DESKTOP_BACKEND: missingBackendDir },
				}),
			).toThrowError(`No packed prismalens at ${missingBackendDir}.`);
		});
	});

	describe("waitForHealth", () => {
		it("resolves true once fetch returns ok after a few rejections", async () => {
			let calls = 0;
			const injectedFetch = vi.fn(async (url: string | URL | Request) => {
				calls += 1;
				if (calls < 3) {
					throw new Error("ECONNREFUSED");
				}
				return { ok: true } as Response;
			});

			const ok = await waitForHealth(
				"http://127.0.0.1:3001",
				1500,
				injectedFetch as unknown as typeof fetch,
			);
			expect(ok).toBe(true);
			expect(calls).toBe(3);
			expect(injectedFetch).toHaveBeenCalledWith(
				"http://127.0.0.1:3001/health",
				expect.objectContaining({ signal: expect.any(AbortSignal) }),
			);
		});

		it("resolves false when the deadline passes with nothing ok", async () => {
			const injectedFetch = vi.fn(async () => {
				throw new Error("ECONNREFUSED");
			});

			const ok = await waitForHealth(
				"http://127.0.0.1:3001",
				200,
				injectedFetch as unknown as typeof fetch,
			);
			expect(ok).toBe(false);
		});

		it("a request that never answers is aborted by the deadline", async () => {
			const injectedFetch = vi.fn(
				(_url: string | URL | Request, init?: RequestInit) =>
					new Promise<Response>((_resolve, reject) => {
						init?.signal?.addEventListener("abort", () =>
							reject(init.signal?.reason),
						);
					}),
			);

			const started = Date.now();
			const ok = await waitForHealth(
				"http://127.0.0.1:3001",
				200,
				injectedFetch as unknown as typeof fetch,
			);
			expect(ok).toBe(false);
			expect(Date.now() - started).toBeLessThan(1_500);
		});
	});

	describe("stopBackend", () => {
		const fakeChild = (connected: boolean) =>
			Object.assign(new EventEmitter(), {
				exitCode: null,
				signalCode: null,
				connected,
				kill: vi.fn(),
				send: vi.fn(),
			}) as unknown as ChildProcess;

		it("asks over IPC, the one stop Windows lets the backend handle", () => {
			vi.useFakeTimers();
			try {
				const child = fakeChild(true);
				stopBackend(child);
				expect(child.send).toHaveBeenCalledWith(
					"prismalens:stop",
					expect.any(Function),
				);
				expect(child.kill).not.toHaveBeenCalled();
				child.emit("exit", 0, null);
				vi.advanceTimersByTime(20_000);
				expect(child.kill).not.toHaveBeenCalled();
			} finally {
				vi.useRealTimers();
			}
		});

		it("signals when there is no channel, and kills one that outlives the backend's own deadline", () => {
			vi.useFakeTimers();
			try {
				const child = fakeChild(false);
				stopBackend(child);
				expect(child.kill).toHaveBeenCalledWith("SIGTERM");
				vi.advanceTimersByTime(11_000);
				expect(child.kill).not.toHaveBeenCalledWith("SIGKILL");
				vi.advanceTimersByTime(1_000);
				expect(child.kill).toHaveBeenCalledWith("SIGKILL");
			} finally {
				vi.useRealTimers();
			}
		});

		it("does not signal a child that has already exited", () => {
			const childWithExitCode = Object.assign(new EventEmitter(), {
				exitCode: 0,
				signalCode: null,
				kill: vi.fn(),
			}) as unknown as ChildProcess;

			stopBackend(childWithExitCode);
			expect(childWithExitCode.kill).not.toHaveBeenCalled();

			const childWithSignalCode = Object.assign(new EventEmitter(), {
				exitCode: null,
				signalCode: "SIGTERM",
				kill: vi.fn(),
			}) as unknown as ChildProcess;

			stopBackend(childWithSignalCode);
			expect(childWithSignalCode.kill).not.toHaveBeenCalled();
		});
	});
});
