// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Install and restart from the app (#724) and About's update controls
 * (#1024 E). Host only, installer copies only, idle only; an install drains
 * dispatch first, and anything that goes wrong before the exit restores it.
 */

import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { stripVTControlCharacters } from "node:util";
import {
	Injectable,
	Logger,
	type OnModuleDestroy,
	type OnModuleInit,
	Optional,
} from "@nestjs/common";
import {
	autoInstallBlockedBy,
	getAppDataDir,
	installChannel,
	installerArgv,
	installerDataDir,
	installerEnv,
	isNewer,
	RESTART_EXIT_CODE,
	readCache,
	releaseNotesFor,
	resolvePort,
	underServiceManager,
	updateCheckDisabledBy,
	upgradeCommand,
} from "@prismalens/config";
import type {
	About,
	UpdateAutoInstall,
	UpdateInstallAvailability,
	UpdateInstallStatus,
	UpdatePrefs,
} from "@prismalens/contracts";
import { resolveServiceVersion } from "../../shared/utils/service-version.js";
import { AdmissionService } from "../lifecycle/admission.service.js";
import { requestRestartExit } from "../lifecycle/restart-exit.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { AboutService, resolveLogDir } from "./about.service.js";
import {
	type HandoffConfig,
	RESULT_FILE,
	readHandoffResult,
	switchWrappers,
} from "./update-handoff.js";

const PREFS_KEY = "update.prefs";
const INSTALL_TIMEOUT_MS = 10 * 60 * 1000;
const HEALTH_DEADLINE_MS = 120_000;
const AUTO_CHECK_MS = 60_000;

/** A refusal the controller maps to an HTTP status. */
export class UpdateRefused extends Error {
	constructor(
		readonly code: "FORBIDDEN" | "CONFLICT" | "BAD_REQUEST",
		message: string,
	) {
		super(message);
	}
}

interface StoredPrefs {
	autoInstall: UpdateAutoInstall;
	checkForUpdates: boolean;
}

const DEFAULT_PREFS: StoredPrefs = {
	autoInstall: "notify",
	checkForUpdates: true,
};

@Injectable()
export class UpdateService implements OnModuleInit, OnModuleDestroy {
	private readonly logger = new Logger(UpdateService.name);
	private readonly version = resolveServiceVersion();
	private status: Omit<UpdateInstallStatus, "draining" | "upgradeCommand"> = {
		phase: "idle",
		version: this.version,
	};
	private quietSince = Date.now();
	private timer: NodeJS.Timeout | undefined;

	// Fields rather than constructor parameters: Nest would try to inject them. Tests set them.
	env: NodeJS.ProcessEnv = process.env;
	platform: NodeJS.Platform = process.platform;
	fetchImpl: typeof fetch = fetch;
	now: () => number = Date.now;
	spawnImpl: typeof spawn = spawn;
	/** Starts Nest's ordinary shutdown; the lock hook then exits with the restart code. */
	shutdown: () => void = () => {
		setTimeout(() => process.emit("SIGTERM", "SIGTERM"), 500).unref();
	};
	/** The detached handoff; its own file, run by this Node after the API is gone. */
	handoffScript = fileURLToPath(
		new URL("./update-handoff.js", import.meta.url),
	);

	constructor(
		private readonly prisma: PrismaService,
		private readonly about: AboutService,
		@Optional() private readonly admission?: AdmissionService,
	) {}

	onModuleInit(): void {
		this.timer = setInterval(() => void this.autoInstallTick(), AUTO_CHECK_MS);
		this.timer.unref();
	}

	onModuleDestroy(): void {
		clearInterval(this.timer);
	}

	async prefs(): Promise<StoredPrefs> {
		const row = await this.prisma.setting.findUnique({
			where: { key: PREFS_KEY },
		});
		if (!row) return DEFAULT_PREFS;
		try {
			const raw = JSON.parse(row.value) as Partial<StoredPrefs>;
			return {
				autoInstall: raw.autoInstall === "idle" ? "idle" : "notify",
				checkForUpdates: raw.checkForUpdates !== false,
			};
		} catch {
			return DEFAULT_PREFS;
		}
	}

	async setPrefs(input: UpdatePrefs, host: boolean): Promise<About> {
		if (!host)
			throw new UpdateRefused(
				"FORBIDDEN",
				"Only this machine's own browser can change updates.",
			);
		const next = { ...(await this.prefs()), ...input };
		const value = JSON.stringify(next);
		await this.prisma.setting.upsert({
			where: { key: PREFS_KEY },
			update: { value, type: "json" },
			create: { key: PREFS_KEY, value, type: "json", category: "general" },
		});
		return this.aboutFor(host);
	}

	/** A run is live: one this loop holds, or a row still marked running. */
	private async live(): Promise<boolean> {
		if ((this.admission?.running() ?? 0) > 0) return true;
		const running = await this.prisma.investigation.count({
			where: { status: "running" },
		});
		return running > 0;
	}

	private inProgress(): boolean {
		return ["downloading", "verifying", "installing", "restarting"].includes(
			this.status.phase,
		);
	}

	private async availability(
		host: boolean,
	): Promise<UpdateInstallAvailability> {
		if (installChannel(this.env) !== "installer")
			return { available: false, blockedBy: "not_installer" };
		if (!host) return { available: false, blockedBy: "not_host" };
		if (!(await this.prefs()).checkForUpdates)
			return { available: false, blockedBy: "disabled" };
		if (this.inProgress() || (await this.live()))
			return { available: false, blockedBy: "busy" };
		return { available: true };
	}

	/** About, with the release notes, the install verdict for this caller and the preferences. */
	async aboutFor(host: boolean, force = false): Promise<About> {
		const prefs = await this.prefs();
		const about = await this.about.get({
			checkEnabled: prefs.checkForUpdates,
			force,
		});
		const notes =
			about.update.available && about.update.latest
				? await releaseNotesFor(
						getAppDataDir(),
						about.update.latest,
						this.fetchImpl,
						this.now(),
					)
				: null;
		return {
			...about,
			update: {
				...about.update,
				notes: notes?.notes ?? null,
				publishedAt: notes?.publishedAt ?? null,
				install: await this.availability(host),
			},
			autoInstall: prefs.autoInstall,
		};
	}

	getStatus(): UpdateInstallStatus {
		const channel = installChannel(this.env);
		const base = {
			...this.status,
			draining: this.admission?.draining ?? false,
			upgradeCommand: upgradeCommand(channel, this.platform),
		};
		if (this.status.phase !== "idle") return base;
		// A handoff that failed after the old process exited left its verdict here.
		const result = readHandoffResult(getAppDataDir());
		if (result?.result === "failed" && isNewer(result.to, this.version))
			return {
				...base,
				phase: "failed",
				version: result.to,
				error: result.reason,
			};
		return base;
	}

	/** The button's path (#724): the caller's checks, then the same install the timer uses. */
	async install(version: string, host: boolean): Promise<UpdateInstallStatus> {
		const verdict = await this.availability(host);
		if (!verdict.available) {
			const message = {
				not_installer:
					"Only an installer copy installs from here; run the upgrade command instead.",
				not_host: "Only this machine's own browser can install an update.",
				disabled: "Update checks are off.",
				busy: "A run is live or an install is under way; try again once it ends.",
			}[verdict.blockedBy ?? "busy"];
			throw new UpdateRefused(
				verdict.blockedBy === "not_host" ? "FORBIDDEN" : "CONFLICT",
				message,
			);
		}
		const latest = readCache(getAppDataDir())?.latest ?? null;
		if (latest !== version || !isNewer(version, this.version))
			throw new UpdateRefused(
				"BAD_REQUEST",
				`${version} isn't the newer release this copy last saw.`,
			);
		const ahead = this.receiptAhead();
		if (ahead)
			throw new UpdateRefused(
				"CONFLICT",
				`The installer last installed ${ahead}, but this copy runs ${this.version}. Restart PrismaLens, or run the upgrade command from a terminal.`,
			);
		if (!this.start(version))
			throw new UpdateRefused("CONFLICT", "An install is already under way.");
		return this.getStatus();
	}

	/** Checks and claims in one synchronous step: the awaits before it let a second caller in. */
	private start(version: string): boolean {
		if (this.inProgress()) return false;
		this.admission?.drain();
		this.status = { phase: "downloading", version };
		void this.runInstall(version);
		return true;
	}

	/** Every failure before the exit puts the `pl` wrappers back on the running version. */
	private fail(version: string, error: string): void {
		const runtimeRoot = join(
			installerDataDir(this.env, this.platform),
			"runtime",
		);
		const binDir = this.binDir();
		if (
			binDir &&
			version !== this.version &&
			existsSync(join(runtimeRoot, version))
		) {
			const back = switchWrappers(
				binDir,
				runtimeRoot,
				version,
				this.version,
				join(runtimeRoot, ".."),
			);
			if (back) error = `${error} (${back})`;
		}
		this.admission?.restore();
		this.status = { phase: "failed", version, error };
		this.logger.warn(`Update to ${version} failed: ${error}`);
	}

	private async runInstall(version: string): Promise<void> {
		const startedAt = this.now();
		const result = await this.runInstaller(version).catch(
			(e: Error) => e.message,
		);
		if (result !== null) return this.fail(version, result);

		const runtimeRoot = join(
			installerDataDir(this.env, this.platform),
			"runtime",
		);
		const pl = join(
			runtimeRoot,
			version,
			"bin",
			this.platform === "win32" ? "pl.cmd" : "pl",
		);
		if (!existsSync(pl))
			return this.fail(version, `The installer finished but ${pl} is missing.`);

		// Admission was drained, so only work that bypassed dispatch can be live now.
		if (await this.live())
			return this.fail(
				version,
				`A run started during the install, so PrismaLens kept running ${this.version}.`,
			);

		this.status = { phase: "restarting", version };
		const workspaceDir = getAppDataDir();
		const managed = underServiceManager(this.env);
		const cfg: HandoffConfig = {
			pid: process.pid,
			mode: managed
				? this.platform === "darwin"
					? "launchd"
					: "systemd"
				: "terminal",
			from: this.version,
			to: version,
			healthUrl: this.healthUrl(),
			workspaceDir,
			startedAt,
			deadlineMs: HEALTH_DEADLINE_MS,
			logPath: join(
				resolveLogDir(this.env, workspaceDir),
				"update-restart.log",
			),
			binDir: this.binDir() ?? join(runtimeRoot, "..", "bin"),
			runtimeRoot,
			upArgs: this.upArgs(),
			platform: this.platform,
			uid: process.getuid?.() ?? 0,
		};
		const cfgPath = join(workspaceDir, "update-handoff.json");
		try {
			writeFileSync(join(workspaceDir, RESULT_FILE), "{}\n");
			writeFileSync(cfgPath, JSON.stringify(cfg));
			const child = this.spawnImpl(
				process.execPath,
				[this.handoffScript, cfgPath],
				{
					detached: true,
					stdio: "ignore",
					windowsHide: true,
				},
			);
			child.unref();
		} catch (e) {
			return this.fail(
				version,
				`Couldn't start the restart: ${(e as Error).message}`,
			);
		}
		this.logger.log(`Installed ${version}; restarting into it`);
		requestRestartExit(managed ? RESTART_EXIT_CODE : 0);
		this.shutdown();
	}

	/** The installer for `version`, with its progress lines mapped to phases; null on success. */
	private runInstaller(version: string): Promise<string | null> {
		const argv = installerArgv(
			version,
			this.platform,
			this.env.PRISMALENS_INSTALLER_SCRIPT,
		);
		return new Promise((resolve) => {
			let child: ChildProcess;
			try {
				child = this.spawnImpl(argv[0], argv.slice(1), {
					env: {
						...installerEnv(this.env, this.platform),
						PRISMALENS_VERSION: version,
					},
					stdio: ["ignore", "pipe", "pipe"],
					windowsHide: true,
				});
			} catch (e) {
				resolve(`Couldn't run the installer: ${(e as Error).message}`);
				return;
			}
			let last = "";
			const read = (chunk: Buffer) => {
				for (const line of chunk.toString("utf8").split(/\r?\n/)) {
					const text = stripVTControlCharacters(line).trim();
					if (!text) continue;
					last = text;
					if (/verifying/i.test(text) && this.status.phase === "downloading")
						this.status = { phase: "verifying", version };
					if (/installing to/i.test(text))
						this.status = { phase: "installing", version };
				}
			};
			child.stdout?.on("data", read);
			child.stderr?.on("data", read);
			const timer = setTimeout(() => {
				child.kill();
				resolve("The installer took longer than 10 minutes and was stopped.");
			}, INSTALL_TIMEOUT_MS);
			timer.unref?.();
			child.on("error", (e) => {
				clearTimeout(timer);
				resolve(`Couldn't run the installer: ${e.message}`);
			});
			child.on("exit", (code) => {
				clearTimeout(timer);
				resolve(
					code === 0 ? null : last || `The installer exited with code ${code}.`,
				);
			});
		});
	}

	private receipt(key: string): string | null {
		try {
			const receipt = readFileSync(
				join(installerDataDir(this.env, this.platform), "receipt"),
				"utf8",
			);
			return (
				new RegExp(`^${key}=(.+)$`, "m").exec(receipt)?.[1]?.trim() ?? null
			);
		} catch {
			return null;
		}
	}

	private binDir(): string | null {
		return this.receipt("bin_dir");
	}

	/**
	 * The installer keeps only the new runtime and the receipt's, so a receipt
	 * ahead of the running copy would let it delete the runtime this process runs from.
	 */
	private receiptAhead(): string | null {
		const recorded = this.receipt("version");
		return recorded && recorded !== this.version ? recorded : null;
	}

	private healthUrl(): string {
		const port = resolvePort(this.env, getAppDataDir());
		const host =
			this.env.PRISMALENS_HOST && this.env.PRISMALENS_HOST !== "0.0.0.0"
				? this.env.PRISMALENS_HOST
				: "127.0.0.1";
		return `http://${host.includes(":") ? `[${host}]` : host}:${port}/health`;
	}

	/** `pl up`'s own arguments, opened without a browser: the old page reloads itself. */
	private upArgs(): string[] {
		const args = process.argv.slice(2);
		const up =
			args[0] === "up"
				? args
				: ["up", ...args.filter((a) => a.startsWith("--"))];
		return up.includes("--no-open") ? up : [...up, "--no-open"];
	}

	/** About's "Install automatically when idle": the same install, once quiet for 15 minutes. */
	async autoInstallTick(): Promise<boolean> {
		const now = this.now();
		if (await this.live().catch(() => true)) {
			this.quietSince = now;
			return false;
		}
		const prefs = await this.prefs();
		const cache = readCache(getAppDataDir());
		const latest = cache?.latest ?? null;
		const blocked = autoInstallBlockedBy({
			preference: prefs.autoInstall,
			channel: installChannel(this.env),
			available: latest !== null && isNewer(latest, this.version),
			checkDisabled:
				!prefs.checkForUpdates || updateCheckDisabledBy(this.env) !== null,
			live: false,
			quietSince: this.quietSince,
			installing: this.inProgress() || this.status.phase === "failed",
			now,
		});
		if (blocked !== null || latest === null) return false;
		this.logger.log(
			`Installing ${latest} automatically; nothing has run for 15 minutes`,
		);
		if (this.receiptAhead()) return false;
		return this.start(latest);
	}
}
