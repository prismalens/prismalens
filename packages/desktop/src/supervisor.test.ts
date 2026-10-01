// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { WorkspaceLockState } from "@prismalens/config";
import { createServer } from "node:net";
import { describe, expect, it } from "vitest";
import {
	backendSpawn,
	pairOperatorSpawn,
	appendTail,
	backendUrl,
	planLaunch,
	portFree,
	portTakenDialog,
	resetWorkspaceSpawn,
	serviceStartCommands,
	stopDialog,
} from "./supervisor.js";

describe("supervisor", () => {
	describe("resetWorkspaceSpawn", () => {
		it("runs `pl reset --yes` on the launcher's workspace, as Node", () => {
			expect(
				resetWorkspaceSpawn({
					execPath: "/app/PrismaLens",
					backendMain: "/app/resources/backend/cli.js",
					workspaceDir: "/home/u/.prismalens",
					env: { PATH: "/usr/bin" },
				}),
			).toEqual({
				command: "/app/PrismaLens",
				args: [
					"/app/resources/backend/cli.js",
					"reset",
					"--yes",
					"--workspace",
					"/home/u/.prismalens",
				],
				env: { PATH: "/usr/bin", ELECTRON_RUN_AS_NODE: "1" },
			});
		});
	});

	describe("planLaunch", () => {
		const owner = { pid: 4321, port: 3005, startedAt: "2026-09-22T12:00:00.000Z" };
		const service = { unitPath: "/u", workspace: "/w", port: 7000, host: "0.0.0.0" };
		const base = {
			lock: { kind: "free" } as WorkspaceLockState,
			service: null,
			ownsWorkspace: false,
			storedPort: 6473,
			protocol: "http" as const,
		};

		it("attaches at the lock's host and port when it is held", () => {
			expect(
				planLaunch({
					...base,
					lock: { kind: "held", owner: { ...owner, host: "192.168.1.5" } },
					service,
					ownsWorkspace: true,
				}),
			).toEqual({
				kind: "attach",
				pid: 4321,
				target: { protocol: "http", host: "192.168.1.5", port: 3005 },
			});
		});

		it("attaches over loopback when the lock names a wildcard or no host", () => {
			for (const host of [undefined, "0.0.0.0", "::"]) {
				const plan = planLaunch({
					...base,
					protocol: "https",
					lock: { kind: "held", owner: { ...owner, host } },
				});
				expect(plan).toMatchObject({
					kind: "attach",
					target: { protocol: "https", host: "127.0.0.1", port: 3005 },
				});
			}
		});

		it("starts an installed service that owns the workspace", () => {
			expect(planLaunch({ ...base, service, ownsWorkspace: true })).toEqual({
				kind: "service",
				target: { protocol: "http", host: "127.0.0.1", port: 7000 },
			});
		});

		it("spawns on the stored port otherwise, whatever the lock's other states", () => {
			const locks: WorkspaceLockState[] = [
				{ kind: "free" },
				{ kind: "stale", owner },
				{ kind: "unreadable", ageMs: 1 },
				{ kind: "undecidable", reason: "EACCES" },
			];
			for (const lock of locks) {
				expect(planLaunch({ ...base, lock, service, ownsWorkspace: false })).toEqual({
					kind: "spawn",
					target: { protocol: "http", host: "127.0.0.1", port: 6473 },
				});
			}
		});
	});

	describe("serviceStartCommands", () => {
		it("starts and never enables", () => {
			const all = [
				...serviceStartCommands("systemd", "/u", 501),
				...serviceStartCommands("launchd", "/p.plist", 501),
			].flatMap((s) => s.argv);
			expect(all).not.toContain("enable");
			expect(serviceStartCommands("systemd", "/u", 501)[0]?.argv).toEqual([
				"systemctl", "--user", "start", "prismalens.service",
			]);
			expect(serviceStartCommands("launchd", "/p.plist", 501).at(-1)?.argv).toEqual([
				"launchctl", "kickstart", "gui/501/io.prismalens.server",
			]);
		});
	});

	describe("stopDialog", () => {
		it("offers Start it here or Quit when an attached backend goes away", () => {
			const d = stopDialog({ owned: false, code: null, stderrTail: [] });
			expect(d.kind).toBe("attached-gone");
			expect(d.message).toBe("PrismaLens stopped");
			expect(d.buttons).toEqual(["Start it here", "Quit"]);
		});

		it("names a newer database and offers the download", () => {
			const line = "Error: this database was written by a newer PrismaLens (0.6.0).";
			const d = stopDialog({ owned: true, code: 1, stderrTail: ["boot", line] });
			expect(d.kind).toBe("newer-database");
			expect(d.detail).toBe(line);
			expect(d.buttons).toEqual(["Download update", "Quit"]);
		});

		it("shows the exit code and the last stderr lines for any other exit", () => {
			const d = stopDialog({ owned: true, code: 3, stderrTail: ["a", "b"] });
			expect(d.kind).toBe("crashed");
			expect(d.message).toContain("exit code 3");
			expect(d.detail).toBe("a\nb");
			expect(d.buttons).toEqual(["Restart", "Quit"]);
		});
	});

	describe("portTakenDialog", () => {
		it("names the port and what holds it", () => {
			const other = portTakenDialog({ port: 6473, holderInstanceId: null, instanceFile: "/w/instance.json" });
			expect(other.message).toBe("Port 6473 is in use by another program");
			expect(other.detail).toContain("/w/instance.json");
			const pl = portTakenDialog({ port: 6473, holderInstanceId: "abc", instanceFile: "/w/instance.json" });
			expect(pl.message).toContain("another PrismaLens workspace (instance abc)");
		});
	});

	describe("appendTail", () => {
		it("keeps the last lines across chunks", () => {
			let tail: string[] = [];
			tail = appendTail(tail, "one\ntwo\n", 3);
			tail = appendTail(tail, "three\r\nfour\n", 3);
			expect(tail).toEqual(["two", "three", "four"]);
		});
	});

	describe("pairOperatorSpawn", () => {
		it("runs `pair --operator` on the workspace under the same binary, as Node", () => {
			const plan = pairOperatorSpawn({
				execPath: "/path/to/electron",
				backendMain: "/path/to/prismalens.js",
				workspaceDir: "/home/u/.prismalens",
				env: { PATH: "/usr/bin" },
			});
			expect(plan.command).toBe("/path/to/electron");
			expect(plan.args).toEqual([
				"/path/to/prismalens.js",
				"pair",
				"--operator",
				"--workspace",
				"/home/u/.prismalens",
			]);
			expect(plan.env.ELECTRON_RUN_AS_NODE).toBe("1");
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
				"--no-open",
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
				"--no-open",
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
				"--no-open",
				"--workspace",
				"/data/custom-workspace",
			]);
		});

		it("carries ELECTRON_RUN_AS_NODE '1' and PRISMALENS_RUN_MODE 'electron'", () => {
			const spawn = backendSpawn({
				execPath: "/path/to/electron",
				backendMain: "/path/to/prismalens.js",
				port: 3001,
				env: { CUSTOM_ENV: "hello" },
			});
			expect(spawn.env.ELECTRON_RUN_AS_NODE).toBe("1");
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

	describe("portFree", () => {
		it("is false for a port something is listening on", async () => {
			const server = createServer();
			await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
			const address = server.address();
			const port = typeof address === "object" && address ? address.port : 0;
			expect(await portFree(port)).toBe(false);
			await new Promise((r) => server.close(r));
			expect(await portFree(port)).toBe(true);
		});
	});

	describe("backendUrl", () => {
		it("formats protocol, host and port, bracketing IPv6", () => {
			expect(backendUrl({ protocol: "http", host: "127.0.0.1", port: 6473 })).toBe(
				"http://127.0.0.1:6473",
			);
			expect(backendUrl({ protocol: "https", host: "::1", port: 443 })).toBe(
				"https://[::1]:443",
			);
		});
	});
});
