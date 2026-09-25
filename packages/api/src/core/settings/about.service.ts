// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Settings → About (#717). The server refreshes the update check itself, so an
 * install run as a service or opened from another device still learns about a
 * release; `pl up`'s terminal notice only reaches an interactive terminal.
 */

import { readdirSync } from "node:fs";
import { Injectable } from "@nestjs/common";
import {
	fetchLatestVersion,
	getAppDataDir,
	installChannel,
	isNewer,
	isStale,
	RELEASES_URL,
	readCache,
	releaseReady,
	uninstallCommand,
	updateCheckDisabledBy,
	upgradeCommand,
	writeCache,
} from "@prismalens/config";
import type { About } from "@prismalens/contracts";
import { resolveServiceVersion } from "../../shared/utils/service-version.js";
import { build } from "../telemetry/telemetry.service.js";

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
	private refreshing: Promise<void> | null = null;

	// Fields rather than constructor parameters: Nest would try to inject them. Tests set them.
	env: NodeJS.ProcessEnv = process.env;
	fetchImpl: typeof fetch = fetch;
	now: () => number = Date.now;

	async get(): Promise<About> {
		const workspaceDir = getAppDataDir();
		const channel = installChannel(this.env);
		const disabledBy = updateCheckDisabledBy(this.env);

		if (!disabledBy && isStale(readCache(workspaceDir), this.now())) {
			this.refreshing ??= this.refresh(workspaceDir).finally(() => {
				this.refreshing = null;
			});
			await this.refreshing;
		}

		const cache = disabledBy ? null : readCache(workspaceDir);
		const latest = cache?.latest ?? null;
		const available = latest !== null && isNewer(latest, this.version);
		return {
			version: this.version,
			channel,
			build: build(this.env),
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
			uninstallCommand: uninstallCommand(channel),
		};
	}

	/** Same rule as the CLI: a release counts once its downloads are attached. */
	private async refresh(workspaceDir: string): Promise<void> {
		const latest = await fetchLatestVersion(this.fetchImpl);
		if (latest && !(await releaseReady(latest, this.fetchImpl))) return;
		writeCache(workspaceDir, { checkedAt: this.now(), latest });
	}
}
