// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The agent's own account and update lines for Settings → Agents (#1180): Sign out,
 * Change account and Update, each staged in the user's terminal, and the newer npm
 * release, read once a day under About's Check for updates.
 */
import { execFile } from "node:child_process";
import { realpathSync } from "node:fs";
import { Injectable, Logger } from "@nestjs/common";
import {
	type AgentReleaseCache,
	isNewer,
	refreshAgentReleases,
} from "@prismalens/config";
import {
	agentCommand,
	type CommandOpts,
	type FoundChannel,
	HARNESS_REGISTRY,
	type HarnessId,
	installChannelOf,
	updateRoute,
} from "@prismalens/config/harness";
import { resolveOnPath } from "@prismalens/config/harness-selection";
import * as clock from "../clock.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { updatePrefs } from "../settings/update.service.js";

const RELEASES_KEY = "AGENT_RELEASES";
const EXEC_TIMEOUT_MS = 5_000;

/** What Settings shows beside an agent's Sign in; each null when it has none here. */
export interface AgentCommands {
	update: { command: string } | { line: string } | null;
	newerRelease: string | null;
	signOut: { command: string } | null;
	switchAccount: { command: string } | null;
}

/** The Settings rows these lines read; values are never read. */
export interface CommandSettings {
	binaryPaths?: Partial<Record<HarnessId, string>>;
	configDirs?: Partial<Record<HarnessId, string>>;
	envNames?: Partial<Record<HarnessId, string[]>>;
}

@Injectable()
export class AgentUpdatesService {
	private readonly logger = new Logger(AgentUpdatesService.name);
	private prefixes: Promise<{
		npmPrefix: string | null;
		brewPrefix: string | null;
	}> | null = null;
	private refreshing: Promise<void> | null = null;

	// Fields rather than constructor parameters: Nest would try to inject them. Tests set them.
	platform: NodeJS.Platform = process.platform;
	env: NodeJS.ProcessEnv = process.env;
	fetchImpl: typeof fetch = fetch;
	now: () => number = clock.now;
	/** One command's trimmed stdout, or null when it fails. */
	run: (cmd: string, args: string[]) => Promise<string | null> = (cmd, args) =>
		new Promise((resolve) => {
			execFile(
				cmd,
				args,
				{
					timeout: EXEC_TIMEOUT_MS,
					shell: this.platform === "win32",
					windowsHide: true,
				},
				(err, stdout) => resolve(err ? null : stdout.trim() || null),
			);
		});
	realPath: (path: string) => string = (path) => {
		try {
			return realpathSync.native(path);
		} catch {
			return path;
		}
	};

	constructor(private readonly prisma: PrismaService) {}

	/** npm's and Homebrew's prefixes, asked once per process. */
	private where() {
		this.prefixes ??= Promise.all([
			this.run("npm", ["prefix", "-g"]),
			this.platform === "win32"
				? Promise.resolve(null)
				: this.run("brew", ["--prefix"]),
		]).then(([npmPrefix, brewPrefix]) => ({ npmPrefix, brewPrefix }));
		return this.prefixes;
	}

	/** The channel the agent's CLI came from: its set binary path, else the first on PATH. */
	async channelOf(id: HarnessId, s: CommandSettings): Promise<FoundChannel> {
		const row = HARNESS_REGISTRY[id];
		const path =
			s.binaryPaths?.[id] ??
			resolveOnPath(row.companionBinary ?? row.binary, this.env.PATH ?? "");
		if (!path) return null;
		return installChannelOf(
			{ path, realPath: this.realPath(path) },
			await this.where(),
			row.brew,
			this.platform,
		);
	}

	/**
	 * The lines for one installed agent. Sign out and Change account follow Sign in's rule:
	 * a stored value moves where it logs in, so none is staged (#1171).
	 */
	async commandsFor(
		id: HarnessId,
		s: CommandSettings,
		installedVersion: string | null,
		releases: AgentReleaseCache,
	): Promise<AgentCommands> {
		const row = HARNESS_REGISTRY[id];
		const opts: CommandOpts = {
			...(s.binaryPaths?.[id] ? { binaryPath: s.binaryPaths[id] } : {}),
			...(s.configDirs?.[id] ? { configDir: s.configDirs[id] } : {}),
			platform: this.platform,
		};
		const stored = new Set(s.envNames?.[id]?.map((n) => n.toUpperCase()));
		const movesLogin = !!row.loginEnvKeys?.some((k) =>
			stored.has(k.toUpperCase()),
		);
		const staged = (args: readonly string[] | undefined) => {
			if (movesLogin || !args) return null;
			const command = agentCommand(row, args, opts);
			return command ? { command } : null;
		};
		const npmPackage =
			row.channel && "npm" in row.channel ? row.channel.npm : null;
		const found =
			row.updateArgs && !npmPackage ? null : await this.channelOf(id, s);
		const latest = npmPackage ? (releases[npmPackage]?.latest ?? null) : null;
		return {
			update: row.commandSetByUser ? null : updateRoute(row, found, opts),
			newerRelease:
				found === "npm" &&
				latest &&
				installedVersion &&
				isNewer(latest, installedVersion)
					? latest
					: null,
			signOut: staged(row.signOutArgs),
			switchAccount: staged(row.switchAccountArgs),
		};
	}

	/** The stored npm releases; a stale read refreshes them behind the caller, never twice at once. */
	async releases(installed: readonly HarnessId[]): Promise<AgentReleaseCache> {
		const cache = await this.stored();
		const packages = installed.flatMap((id) => {
			const c = HARNESS_REGISTRY[id].channel;
			return c && "npm" in c ? [c.npm] : [];
		});
		this.refreshing ??= this.refresh(packages, cache)
			.catch((err: unknown) =>
				this.logger.warn(`Could not refresh agent releases: ${String(err)}`),
			)
			.finally(() => {
				this.refreshing = null;
			});
		return cache;
	}

	/** Waits for a refresh in flight; tests and a forced check use it. */
	settled(): Promise<void> {
		return this.refreshing ?? Promise.resolve();
	}

	private async refresh(
		packages: string[],
		cache: AgentReleaseCache,
	): Promise<void> {
		const enabled = (await updatePrefs(this.prisma)).checkForUpdates;
		const next = await refreshAgentReleases(packages, cache, {
			enabled,
			now: this.now(),
			fetchImpl: this.fetchImpl,
		});
		if (next === cache || JSON.stringify(next) === JSON.stringify(cache))
			return;
		const value = JSON.stringify(next);
		await this.prisma.setting
			.upsert({
				where: { key: RELEASES_KEY },
				update: { value, type: "json" },
				create: { key: RELEASES_KEY, value, type: "json", category: "ai" },
			})
			.catch((err: unknown) =>
				this.logger.warn(`Could not store agent releases: ${String(err)}`),
			);
	}

	private async stored(): Promise<AgentReleaseCache> {
		const row = await this.prisma.setting.findUnique({
			where: { key: RELEASES_KEY },
		});
		if (!row) return {};
		try {
			const raw: unknown = JSON.parse(row.value);
			if (!raw || typeof raw !== "object") return {};
			const out: AgentReleaseCache = {};
			for (const [pkg, v] of Object.entries(raw)) {
				const e = v as { checkedAt?: unknown; latest?: unknown };
				if (typeof e?.checkedAt !== "number") continue;
				out[pkg] = {
					checkedAt: e.checkedAt,
					latest: typeof e.latest === "string" ? e.latest : null,
				};
			}
			return out;
		} catch {
			return {};
		}
	}
}
