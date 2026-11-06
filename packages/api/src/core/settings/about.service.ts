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
	getAppDataDir,
	installChannel,
	installedService,
	isNewer,
	isStale,
	RELEASES_URL,
	readCache,
	refreshUpdateCache,
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
	private refreshing: Promise<void> | null = null;

	// Fields rather than constructor parameters: Nest would try to inject them. Tests set them.
	env: NodeJS.ProcessEnv = process.env;
	fetchImpl: typeof fetch = fetch;
	now: () => number = Date.now;

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

		if (
			checking &&
			(opts.force || isStale(readCache(workspaceDir), this.now()))
		) {
			this.refreshing ??= refreshUpdateCache(
				workspaceDir,
				this.fetchImpl,
				this.now(),
			).finally(() => {
				this.refreshing = null;
			});
			await this.refreshing;
		}

		const cache = checking ? readCache(workspaceDir) : null;
		const latest = cache?.latest ?? null;
		const available = latest !== null && isNewer(latest, this.version);
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
			upgradeCommand: upgradeCommand(channel),
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
		};
	}
}
