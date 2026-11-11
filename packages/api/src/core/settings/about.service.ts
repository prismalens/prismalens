// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Settings → About (#717). The server refreshes the update check itself, so an
 * install run as a service or opened from another device still learns about a
 * release; `pl up`'s terminal notice only reaches an interactive terminal.
 */

import { readdirSync } from "node:fs";
import { release as osRelease, type as osType } from "node:os";
import { join } from "node:path";
import { Injectable } from "@nestjs/common";
import {
	effectiveUpdateChannel,
	getAppDataDir,
	installChannel,
	installedService,
	isNewer,
	isStale,
	isUpdateChannel,
	leavingNightlyNote,
	nightlyBlockedBy,
	RELEASES_URL,
	readCache,
	refreshUpdateCache,
	type UpdateChannel,
	uninstallCommand,
	updateCheckDisabledBy,
	upgradeCommand,
} from "@prismalens/config";
import type { About } from "@prismalens/contracts";
import {
	resolveServiceBuild,
	resolveServiceVersion,
} from "../../shared/utils/service-version.js";

/** Where `pl up` writes its logs: `PRISMALENS_LOG_FILE_LOCATION`, else the workspace's `logs`. */
export function resolveLogDir(
	env: NodeJS.ProcessEnv,
	workspaceDir: string,
): string {
	return env.PRISMALENS_LOG_FILE_LOCATION || join(workspaceDir, "logs");
}

/** The newest `prismalens.db.bak-*`; the names sort by the time they were made. */
export function latestBackup(workspaceDir: string): string | null {
	try {
		const backups = readdirSync(workspaceDir)
			.filter((name) => name.startsWith("prismalens.db.bak-"))
			.sort();
		return backups.at(-1) ?? null;
	} catch {
		return null;
	}
}

@Injectable()
export class AboutService {
	private readonly version = resolveServiceVersion();
	private readonly build = resolveServiceBuild();
	/** One refresh at a time, for one channel: the cache file holds one channel's answer. */
	private refreshing: { channel: UpdateChannel; done: Promise<void> } | null =
		null;

	// Fields rather than constructor parameters: Nest would try to inject them. Tests set them.
	env: NodeJS.ProcessEnv = process.env;
	fetchImpl: typeof fetch = fetch;
	now: () => number = Date.now;

	/** Joins a pending refresh for `channel`; a pending one for the other channel is let finish first. */
	private async refresh(
		workspaceDir: string,
		channel: UpdateChannel,
	): Promise<void> {
		while (this.refreshing && this.refreshing.channel !== channel)
			await this.refreshing.done;
		if (!this.refreshing) {
			const done: Promise<void> = refreshUpdateCache(
				workspaceDir,
				this.fetchImpl,
				this.now(),
				channel,
			).finally(() => {
				if (this.refreshing?.done === done) this.refreshing = null;
			});
			this.refreshing = { channel, done };
		}
		await this.refreshing.done;
	}

	/**
	 * `checkEnabled` is About's "Check for updates" row; `force` is Check now,
	 * which asks GitHub whatever the cache's age.
	 */
	async get(
		opts: { checkEnabled?: boolean; force?: boolean } = {},
	): Promise<About> {
		const workspaceDir = getAppDataDir();
		const channel = installChannel(this.env);
		const disabledBy = updateCheckDisabledBy(this.env);
		const checking = !disabledBy && opts.checkEnabled !== false;
		const updateChannel = effectiveUpdateChannel(
			workspaceDir,
			channel,
			this.env,
		);

		if (
			checking &&
			(opts.force ||
				isStale(readCache(workspaceDir, updateChannel), this.now()))
		) {
			await this.refresh(workspaceDir, updateChannel);
		}

		const cache = checking ? readCache(workspaceDir, updateChannel) : null;
		const latest = cache?.latest ?? null;
		const available = latest !== null && isNewer(latest, this.version);
		const envChannel = this.env.PRISMALENS_UPDATE_CHANNEL?.trim().toLowerCase();
		return {
			version: this.version,
			channel,
			build: this.build,
			workspaceDir,
			latestBackup: latestBackup(workspaceDir),
			update: {
				latest,
				available,
				checkedAt: cache ? new Date(cache.checkedAt).toISOString() : null,
				disabledBy,
				releaseNotesUrl: latest ? `${RELEASES_URL}/tag/v${latest}` : null,
			},
			upgradeCommand: upgradeCommand(
				channel,
				process.platform,
				undefined,
				updateChannel,
			),
			uninstallCommand: installedService()
				? `pl service uninstall && ${uninstallCommand(channel)}`
				: uninstallCommand(channel),
			logsDir: resolveLogDir(this.env, workspaceDir),
			runtime: {
				node: process.version,
				os: `${osType()} ${osRelease()}`,
				arch: process.arch,
			},
			checkForUpdates: opts.checkEnabled !== false,
			updateChannel: {
				current: updateChannel,
				fromEnv: isUpdateChannel(envChannel),
				nightlyBlockedBy: nightlyBlockedBy(channel),
				leavingNightly:
					updateChannel === "stable"
						? leavingNightlyNote(this.version, latest)
						: null,
			},
		};
	}
}
