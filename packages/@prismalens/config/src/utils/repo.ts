// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Extract service label from an alert object (service, namespace, or job).
 */
export function pickServiceLabel(
	alert: Record<string, unknown> | undefined,
): string | undefined {
	if (!alert) return undefined;
	const labels = (alert.labels ?? {}) as Record<string, unknown>;
	const pick = labels.service ?? labels.namespace ?? labels.job;
	return typeof pick === "string" && pick ? pick : undefined;
}

/**
 * Per-alert repo/cwd resolution: alert's service label → config.services[name].repo
 * → config.repos[repoRef].local_path, else repoRef if existing local checkout.
 */
export function resolveRepoPath(
	alert: Record<string, unknown>,
	config: {
		services?: Record<string, { repo?: string }>;
		repos?: Record<string, { local_path?: string | null }>;
	},
): string {
	const name = pickServiceLabel(alert);
	if (!name) {
		throw new Error(
			"Listen dispatch refused: alert is missing a service label (cannot resolve an investigation workspace).",
		);
	}
	const repoRef = config.services?.[name]?.repo;
	if (!repoRef) {
		throw new Error(
			`Listen dispatch refused: service "${name}" has no mapped repo in config (cannot resolve an investigation workspace).`,
		);
	}
	const localPath = config.repos?.[repoRef]?.local_path;
	if (localPath) return resolve(localPath);
	if (existsSync(repoRef)) return resolve(repoRef);
	throw new Error(
		`Listen dispatch refused: repo "${repoRef}" (mapped from service "${name}") does not exist locally (cannot resolve an investigation workspace).`,
	);
}
