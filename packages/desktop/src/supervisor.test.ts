// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { WorkspaceLockState } from "@prismalens/config";
import { describe, expect, it } from "vitest";
import {
	backendSpawn,
	backendUrl,
	pickFreePort,
	planLaunch,
} from "./supervisor.js";

describe("supervisor", () => {
	describe("planLaunch", () => {
		it("attaches with port and pid when lock is held", () => {
			const lock: WorkspaceLockState = {
				kind: "held",
				owner: {
					pid: 4321,
					port: 3005,
					startedAt: "2026-09-22T12:00:00.000Z",
				},
			};
			expect(planLaunch(lock, 3001)).toEqual({
				kind: "attach",
				port: 3005,
				pid: 4321,
			});
		});

		it("spawns on the requested port when lock is free, stale, unreadable, or undecidable", () => {
			const freeLock: WorkspaceLockState = { kind: "free" };
			expect(planLaunch(freeLock, 3001)).toEqual({
				kind: "spawn",
				port: 3001,
			});

			const staleLock: WorkspaceLockState = {
				kind: "stale",
				owner: {
					pid: 9999,
					port: 4000,
					startedAt: "2026-09-22T10:00:00.000Z",
				},
			};
			expect(planLaunch(staleLock, 3001)).toEqual({
				kind: "spawn",
				port: 3001,
			});

			const unreadableLock: WorkspaceLockState = {
				kind: "unreadable",
				ageMs: 5_000,
			};
			expect(planLaunch(unreadableLock, 3001)).toEqual({
				kind: "spawn",
				port: 3001,
			});

			const undecidableLock: WorkspaceLockState = {
				kind: "undecidable",
				reason: "EACCES",
			};
			expect(planLaunch(undecidableLock, 3001)).toEqual({
				kind: "spawn",
				port: 3001,
			});
		});
	});

	describe("backendSpawn", () => {
		it("uses execPath as command and standard args without workspace", () => {
			const spawn = backendSpawn({
				execPath: "/path/to/electron",
				backendMain: "/path/to/prismalens.js",
				port: 3001,
				env: { PATH: "/usr/bin" },
			});
			expect(spawn.command).toBe("/path/to/electron");
			expect(spawn.args).toEqual([
				"/path/to/prismalens.js",
				"up",
				"--port",
				"3001",
				"--host",
				"127.0.0.1",
			]);
		});

		it("appends --workspace only when given", () => {
			const withoutWs = backendSpawn({
				execPath: "/path/to/electron",
				backendMain: "/path/to/prismalens.js",
				port: 3001,
				env: { PATH: "/usr/bin" },
			});
			expect(withoutWs.args).toEqual([
				"/path/to/prismalens.js",
				"up",
				"--port",
				"3001",
				"--host",
				"127.0.0.1",
			]);

			const withWs = backendSpawn({
				execPath: "/path/to/electron",
				backendMain: "/path/to/prismalens.js",
				port: 3001,
				workspaceDir: "/data/custom-workspace",
				env: { PATH: "/usr/bin" },
			});
			expect(withWs.args).toEqual([
				"/path/to/prismalens.js",
				"up",
				"--port",
				"3001",
				"--host",
				"127.0.0.1",
				"--workspace",
				"/data/custom-workspace",
			]);
		});

		it("carries ELECTRON_RUN_AS_NODE '1', PRISMALENS_PLACEMENT 'laptop', and PRISMALENS_RUN_MODE 'electron'", () => {
			const spawn = backendSpawn({
				execPath: "/path/to/electron",
				backendMain: "/path/to/prismalens.js",
				port: 3001,
				env: { CUSTOM_ENV: "hello" },
			});
			expect(spawn.env.ELECTRON_RUN_AS_NODE).toBe("1");
			expect(spawn.env.PRISMALENS_PLACEMENT).toBe("laptop");
			expect(spawn.env.PRISMALENS_RUN_MODE).toBe("electron");
			expect(spawn.env.CUSTOM_ENV).toBe("hello");
		});

		it("replaces PATH with loginShellPath when given and leaves input PATH otherwise", () => {
			const withLoginShell = backendSpawn({
				execPath: "/path/to/electron",
				backendMain: "/path/to/prismalens.js",
				port: 3001,
				env: { PATH: "/default/bin" },
				loginShellPath: "/login/shell/bin:/usr/bin",
			});
			expect(withLoginShell.env.PATH).toBe("/login/shell/bin:/usr/bin");

			const withoutLoginShell = backendSpawn({
				execPath: "/path/to/electron",
				backendMain: "/path/to/prismalens.js",
				port: 3001,
				env: { PATH: "/default/bin" },
			});
			expect(withoutLoginShell.env.PATH).toBe("/default/bin");
		});

		it("does not mutate the input env object", () => {
			const inputEnv: NodeJS.ProcessEnv = {
				PATH: "/usr/bin",
				EXISTING: "value",
			};
			const snapshot = { ...inputEnv };
			backendSpawn({
				execPath: "/path/to/electron",
				backendMain: "/path/to/prismalens.js",
				port: 3001,
				workspaceDir: "/data/ws",
				env: inputEnv,
				loginShellPath: "/shell/bin",
			});
			expect(inputEnv).toEqual(snapshot);
		});
	});

	describe("pickFreePort", () => {
		it("resolves a port in 1024..65535, and two calls in a row can differ", async () => {
			const port1 = await pickFreePort();
			const port2 = await pickFreePort();
			expect(port1).toBeGreaterThanOrEqual(1024);
			expect(port1).toBeLessThanOrEqual(65535);
			expect(port2).toBeGreaterThanOrEqual(1024);
			expect(port2).toBeLessThanOrEqual(65535);
		});
	});

	describe("backendUrl", () => {
		it("formats loopback URL with the given port", () => {
			expect(backendUrl(3001)).toBe("http://127.0.0.1:3001");
		});
	});
});
