// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveServiceVersion } from "../../shared/utils/service-version.js";
import { AdmissionService } from "../lifecycle/admission.service.js";
import { restartExitCode } from "../lifecycle/restart-exit.js";
import type { PrismaService } from "../prisma/prisma.service.js";
import { AboutService } from "./about.service.js";
import { UpdateRefused, UpdateService } from "./update.service.js";

const NEXT = "99.0.0";
const CURRENT = resolveServiceVersion();

let workspace: string;
let dataDir: string;
let saved: NodeJS.ProcessEnv;
beforeEach(() => {
	workspace = mkdtempSync(join(tmpdir(), "pl-update-"));
	dataDir = join(workspace, "prismalens");
	saved = { ...process.env };
	process.env.PRISMALENS_WORKSPACE_DIR = workspace;
	// A fresh cache that already knows NEXT, so nothing asks GitHub.
	writeFileSync(
		join(workspace, "update-check.json"),
		JSON.stringify({ checkedAt: Date.now(), latest: NEXT }),
	);
	writeFileSync(
		join(workspace, "release-notes.json"),
		JSON.stringify({ version: NEXT, notes: "## New", publishedAt: "2026-11-01T00:00:00Z", fetchedAt: Date.now() }),
	);
});
afterEach(() => {
	process.env = saved;
	rmSync(workspace, { recursive: true, force: true });
	vi.useRealTimers();
});

/** A fake Prisma with the settings table and a running-run count. */
function fakePrisma(running: () => number) {
	const settings = new Map<string, string>();
	return {
		settings,
		prisma: {
			setting: {
				findUnique: async ({ where }: { where: { key: string } }) =>
					settings.has(where.key) ? { value: settings.get(where.key) } : null,
				upsert: async ({ where, create }: { where: { key: string }; create: { value: string } }) => {
					settings.set(where.key, create.value);
				},
			},
			investigation: { count: async () => running() },
		} as unknown as PrismaService,
	};
}

/** An installer child that prints the real script's steps, then exits with `code`. */
function fakeInstaller(code: number, onRun?: () => void) {
	return vi.fn(() => {
		const child = new EventEmitter() as EventEmitter & {
			stdout: PassThrough;
			stderr: PassThrough;
			kill: () => void;
			unref: () => void;
		};
		child.stdout = new PassThrough();
		child.stderr = new PassThrough();
		child.kill = () => {};
		child.unref = () => {};
		setImmediate(() => {
			child.stderr.write("› Verifying 40 MB against SHA256SUMS\n");
			child.stderr.write(`› Installing to ${dataDir}/runtime/${NEXT}\n`);
			if (code === 0) {
				const bin = join(dataDir, "runtime", NEXT, "bin");
				mkdirSync(bin, { recursive: true });
				for (const name of ["pl", "pl.cmd"]) writeFileSync(join(bin, name), "");
			} else child.stderr.write("✗ Checksum mismatch; nothing was installed\n");
			onRun?.();
			child.emit("exit", code);
		});
		return child;
	});
}

function service(opts: {
	channel?: "installer" | "npm";
	running?: () => number;
	spawn?: ReturnType<typeof fakeInstaller>;
}) {
	const { prisma, settings } = fakePrisma(opts.running ?? (() => 0));
	const admission = new AdmissionService();
	const drain = vi.fn();
	admission.attach({ drain, running: () => 0 });
	const about = new AboutService();
	const env: NodeJS.ProcessEnv = {
		...(opts.channel === "npm" ? {} : { PRISMALENS_INSTALL: "standalone" }),
		LOCALAPPDATA: workspace,
		XDG_DATA_HOME: workspace,
		PRISMALENS_PORT: "3999",
	};
	about.env = env;
	const s = new UpdateService(prisma, about, admission);
	s.env = env;
	s.shutdown = vi.fn();
	const handoff = vi.fn(() => ({ unref() {} }));
	const installer = opts.spawn ?? fakeInstaller(0);
	s.spawnImpl = ((file: string, ...rest: unknown[]) =>
		file === process.execPath
			? (handoff as (...a: unknown[]) => unknown)(file, ...rest)
			: (installer as (...a: unknown[]) => unknown)(file, ...rest)) as never;
	return { s, admission, drain, handoff, installer, settings };
}

async function settled(s: UpdateService) {
	await vi.waitFor(() =>
		expect(["restarting", "failed"]).toContain(s.getStatus().phase),
	);
	return s.getStatus();
}

describe("UpdateService.install refusals", () => {
	it("refuses a paired device with FORBIDDEN", async () => {
		const { s } = service({});
		await expect(s.install(NEXT, false)).rejects.toMatchObject({ code: "FORBIDDEN" });
	});

	it("refuses a copy that isn't the installer's", async () => {
		const { s } = service({ channel: "npm" });
		const about = await s.aboutFor(true);
		expect(about.update.install).toEqual({ available: false, blockedBy: "not_installer" });
		await expect(s.install(NEXT, true)).rejects.toBeInstanceOf(UpdateRefused);
	});

	it("refuses while a run is live, and says why on About", async () => {
		const { s, installer } = service({ running: () => 1 });
		expect((await s.aboutFor(true)).update.install).toEqual({ available: false, blockedBy: "busy" });
		await expect(s.install(NEXT, true)).rejects.toMatchObject({ code: "CONFLICT" });
		expect(installer).not.toHaveBeenCalled();
	});

	it("refuses a version other than the one the check found", async () => {
		const { s } = service({});
		await expect(s.install("98.0.0", true)).rejects.toMatchObject({ code: "BAD_REQUEST" });
	});

	it("refuses when the About toggle turned checks off", async () => {
		const { s } = service({});
		await s.setPrefs({ checkForUpdates: false }, true);
		await expect(s.install(NEXT, true)).rejects.toMatchObject({ code: "CONFLICT" });
		await expect(s.setPrefs({ autoInstall: "idle" }, false)).rejects.toMatchObject({ code: "FORBIDDEN" });
	});
});

describe("UpdateService.install", () => {
	it("drains, walks the phases, hands off and asks for a restart exit", async () => {
		const { s, admission, drain, handoff } = service({});
		const first = await s.install(NEXT, true);
		expect(first).toMatchObject({ phase: "downloading", version: NEXT, draining: true });
		expect(drain).toHaveBeenCalledWith(true);
		const end = await settled(s);
		expect(end.phase).toBe("restarting");
		expect(admission.draining).toBe(true);
		expect(handoff).toHaveBeenCalledOnce();
		const cfg = JSON.parse(readFileSync(join(workspace, "update-handoff.json"), "utf8"));
		expect(cfg).toMatchObject({ from: CURRENT, to: NEXT, mode: "terminal", pid: process.pid });
		expect(cfg.upArgs).toContain("--no-open");
		expect(cfg.healthUrl).toBe("http://127.0.0.1:3999/health");
		expect(restartExitCode()).toBe(0);
		expect(s.shutdown).toHaveBeenCalledOnce();
	});

	it("restores admission and keeps running when the installer fails", async () => {
		const { s, admission, drain } = service({ spawn: fakeInstaller(1) });
		await s.install(NEXT, true);
		const end = await settled(s);
		expect(end).toMatchObject({ phase: "failed", draining: false });
		expect(end.error).toContain("Checksum mismatch");
		expect(end.upgradeCommand).toMatch(/install.(sh|ps1)/);
		expect(admission.draining).toBe(false);
		expect(drain).toHaveBeenLastCalledWith(false);
		expect(s.shutdown).not.toHaveBeenCalled();
	});

	it("aborts when a run went live during the install, and restores admission", async () => {
		let live = 0;
		const { s, admission, handoff } = service({
			running: () => live,
			spawn: fakeInstaller(0, () => {
				live = 1;
			}),
		});
		await s.install(NEXT, true);
		const end = await settled(s);
		expect(end.phase).toBe("failed");
		expect(end.error).toContain("A run started during the install");
		expect(admission.draining).toBe(false);
		expect(handoff).not.toHaveBeenCalled();
		expect(s.shutdown).not.toHaveBeenCalled();
	});

	it("reports a handoff that failed after the old process exited", () => {
		const { s } = service({});
		writeFileSync(
			join(workspace, "update-result.json"),
			JSON.stringify({ from: CURRENT, to: NEXT, result: "failed", reason: "it never answered", at: "x" }),
		);
		expect(s.getStatus()).toMatchObject({ phase: "failed", version: NEXT, error: "it never answered" });
	});
});

describe("About with the update controls", () => {
	it("adds the notes, the install verdict and the preferences, defaulting to notify", async () => {
		const { s } = service({});
		const about = await s.aboutFor(true);
		expect(about.update).toMatchObject({
			latest: NEXT,
			available: true,
			notes: "## New",
			publishedAt: "2026-11-01T00:00:00Z",
			install: { available: true },
		});
		expect(about.autoInstall).toBe("notify");
		expect(about.checkForUpdates).toBe(true);
		expect(about.runtime?.node).toBe(process.version);
		expect(about.logsDir).toBe(join(workspace, "logs"));
		expect((await s.aboutFor(false)).update.install).toEqual({ available: false, blockedBy: "not_host" });
	});

	it("stops reporting a release once Check for updates is off", async () => {
		const { s } = service({});
		const about = await s.setPrefs({ checkForUpdates: false }, true);
		expect(about.update.available).toBe(false);
		expect(about.checkForUpdates).toBe(false);
	});
});

describe("autoInstallTick", () => {
	it("installs only with Install when idle on, and after 15 quiet minutes", async () => {
		const { s, installer } = service({});
		let now = Date.now();
		s.now = () => now;
		expect(await s.autoInstallTick()).toBe(false);
		await s.setPrefs({ autoInstall: "idle" }, true);
		expect(await s.autoInstallTick()).toBe(false);
		now += 16 * 60_000;
		expect(await s.autoInstallTick()).toBe(true);
		expect(installer).toHaveBeenCalledOnce();
		await settled(s);
	});

	it("restarts the quiet window whenever a run is live", async () => {
		let live = 1;
		const { s } = service({ running: () => live });
		await s.setPrefs({ autoInstall: "idle" }, true);
		let now = Date.now() + 60 * 60_000;
		s.now = () => now;
		expect(await s.autoInstallTick()).toBe(false);
		live = 0;
		now += 5 * 60_000;
		expect(await s.autoInstallTick()).toBe(false);
	});
});

describe("UpdateService edges", () => {
	it("runs the auto-install check on a timer and stops it on shutdown", () => {
		vi.useFakeTimers();
		const { s } = service({});
		const tick = vi.spyOn(s, "autoInstallTick").mockResolvedValue(false);
		s.onModuleInit();
		vi.advanceTimersByTime(61_000);
		expect(tick).toHaveBeenCalledOnce();
		s.onModuleDestroy();
		vi.advanceTimersByTime(120_000);
		expect(tick).toHaveBeenCalledOnce();
	});

	it("fails cleanly when the installer can't start or errors", async () => {
		const throws = vi.fn(() => {
			throw new Error("EACCES");
		});
		const a = service({ spawn: throws as never });
		await a.s.install(NEXT, true);
		expect((await settled(a.s)).error).toContain("Couldn't run the installer: EACCES");

		const erroring = vi.fn(() => {
			const child = new EventEmitter() as EventEmitter & { stdout: PassThrough; stderr: PassThrough; kill: () => void };
			child.stdout = new PassThrough();
			child.stderr = new PassThrough();
			child.kill = () => {};
			setImmediate(() => child.emit("error", new Error("spawn powershell ENOENT")));
			return child;
		});
		const b = service({ spawn: erroring as never });
		await b.s.install(NEXT, true);
		expect((await settled(b.s)).error).toContain("spawn powershell ENOENT");
		expect(b.admission.draining).toBe(false);
	});

	it("fails when the installer exits 0 but the runtime isn't there", async () => {
		const quiet = vi.fn(() => {
			const child = new EventEmitter() as EventEmitter & { stdout: PassThrough; stderr: PassThrough; kill: () => void };
			child.stdout = new PassThrough();
			child.stderr = new PassThrough();
			child.kill = () => {};
			setImmediate(() => child.emit("exit", 0));
			return child;
		});
		const { s } = service({ spawn: quiet as never });
		await s.install(NEXT, true);
		expect((await settled(s)).error).toContain("is missing");
	});

	it("under the installed service, exits with the code the manager restarts on", async () => {
		const { s } = service({});
		s.env.PRISMALENS_SERVICE = "1";
		s.platform = "linux";
		await s.install(NEXT, true);
		await settled(s);
		const cfg = JSON.parse(readFileSync(join(workspace, "update-handoff.json"), "utf8"));
		expect(cfg.mode).toBe("systemd");
		expect(restartExitCode()).toBe(75);
	});

	it("treats a user's own systemd unit as a terminal copy", async () => {
		const { s } = service({});
		s.env.INVOCATION_ID = "abc";
		s.platform = "linux";
		await s.install(NEXT, true);
		await settled(s);
		const cfg = JSON.parse(readFileSync(join(workspace, "update-handoff.json"), "utf8"));
		expect(cfg.mode).toBe("terminal");
		expect(restartExitCode()).toBe(0);
	});

	it("reads the installer's bin folder from its receipt", async () => {
		mkdirSync(dataDir, { recursive: true });
		writeFileSync(join(dataDir, "receipt"), `version=${CURRENT}\nbin_dir=/home/me/.local/bin\n`);
		const { s } = service({});
		await s.install(NEXT, true);
		await settled(s);
		const cfg = JSON.parse(readFileSync(join(workspace, "update-handoff.json"), "utf8"));
		expect(cfg.binDir).toBe("/home/me/.local/bin");
	});
});

describe("UpdateService concurrency", () => {
	it("starts one install when two arrive together", async () => {
		const { s, installer } = service({});
		const results = await Promise.allSettled([s.install(NEXT, true), s.install(NEXT, true)]);
		expect(results.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
		const refused = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
		expect(refused.reason).toMatchObject({ code: "CONFLICT" });
		await settled(s);
		expect(installer).toHaveBeenCalledOnce();
	});
});

describe("UpdateService keeps the running runtime", () => {
	it("refuses when the installer's receipt is ahead of the running copy", async () => {
		mkdirSync(dataDir, { recursive: true });
		writeFileSync(join(dataDir, "receipt"), "version=98.9.9\nbin_dir=/x\n");
		const { s, installer } = service({});
		await expect(s.install(NEXT, true)).rejects.toMatchObject({ code: "CONFLICT" });
		expect(installer).not.toHaveBeenCalled();
		await s.setPrefs({ autoInstall: "idle" }, true);
		s.now = () => Date.now() + 60 * 60_000;
		expect(await s.autoInstallTick()).toBe(false);
	});

	it("puts the pl wrappers back on the running version when an install fails after unpacking", async () => {
		const runtimeRoot = join(dataDir, "runtime");
		const bin = join(workspace, "bin");
		mkdirSync(join(runtimeRoot, CURRENT, "bin"), { recursive: true });
		mkdirSync(bin, { recursive: true });
		writeFileSync(join(dataDir, "receipt"), `version=${CURRENT}\nbin_dir=${bin}\n`);
		const unpackedNoPl = vi.fn(() => {
			const child = new EventEmitter() as EventEmitter & {
				stdout: PassThrough;
				stderr: PassThrough;
				kill: () => void;
			};
			child.stdout = new PassThrough();
			child.stderr = new PassThrough();
			child.kill = () => {};
			setImmediate(() => {
				// The installer unpacked NEXT and switched the wrappers, but its pl is missing.
				mkdirSync(join(runtimeRoot, NEXT), { recursive: true });
				writeFileSync(join(bin, "pl"), `#!/bin/sh\nexec "${join(runtimeRoot, NEXT, "bin", "pl")}" "$@"\n`);
				child.emit("exit", 0);
			});
			return child;
		});
		const { s } = service({ spawn: unpackedNoPl as never });
		await s.install(NEXT, true);
		expect((await settled(s)).phase).toBe("failed");
		expect(readFileSync(join(bin, "pl"), "utf8")).toContain(join(runtimeRoot, CURRENT, "bin"));
	});
});

