// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { createHash, randomUUID } from "node:crypto";
import { pickServiceLabel } from "../core/run-investigation.js";
import type { GroupRecord, SessionManager } from "../core/session.js";

export interface GroupingPort {
	newGroupCount(
		firing: Record<string, unknown>[],
		payload: Record<string, unknown>,
	): number;
	pendingGroups(): number;
	admit(
		firing: Record<string, unknown>[],
		payload: Record<string, unknown>,
	): void;
	shutdown(): void;
	isShuttingDown(): boolean;
}

export interface GroupingOptions {
	windowMs: number;
	sessions: SessionManager;
	runInvestigation: (
		runId: string,
		alerts: Record<string, unknown>[],
	) => Promise<void>;
	log: (msg: string) => void;
}

export function deriveGroupKey(
	alert: Record<string, unknown>,
	payload: Record<string, unknown>,
): string {
	if (typeof payload.groupKey === "string" && payload.groupKey) {
		return payload.groupKey;
	}
	if (payload.groupLabels && typeof payload.groupLabels === "object") {
		const labels = payload.groupLabels as Record<string, string>;
		const keys = Object.keys(labels);
		if (keys.length > 0) {
			const sorted = keys
				.sort()
				.map((k) => `${k}=${labels[k]}`)
				.join(",");
			return createHash("sha256").update(sorted).digest("hex");
		}
	}
	const serviceLabel = pickServiceLabel(alert);
	const alertname =
		(alert.labels as Record<string, string> | undefined)?.alertname || "";
	if (serviceLabel) {
		return `${alertname}\0${serviceLabel}`;
	}
	const alertLabels = alert.labels as Record<string, string> | undefined;
	if (alertLabels && Object.keys(alertLabels).length > 0) {
		const sorted = Object.keys(alertLabels)
			.sort()
			.map((k) => `${k}=${alertLabels[k]}`)
			.join(",");
		return createHash("sha256").update(sorted).digest("hex");
	}
	return "default";
}

export function deriveDedupeKey(alert: Record<string, unknown>): string {
	if (typeof alert.fingerprint === "string" && alert.fingerprint) {
		return alert.fingerprint;
	}
	const alertLabels = alert.labels as Record<string, string> | undefined;
	const alertname = alertLabels?.alertname || "";
	const sorted = alertLabels
		? Object.keys(alertLabels)
				.sort()
				.map((k) => `${k}=${alertLabels[k]}`)
				.join(",")
		: "";
	const hash = createHash("sha256").update(sorted).digest("hex");
	const startsAt = (alert.startsAt as string) || "";
	return `${alertname}${hash}${startsAt}`;
}

export function createGroupingLayer(options: GroupingOptions): GroupingPort {
	let shuttingDown = false;

	// Active windows
	interface WindowState {
		timer: NodeJS.Timeout;
		alerts: Record<string, unknown>[];
		seenKeys: Set<string>;
	}
	const windows = new Map<string, WindowState>();

	// Running investigations
	interface RunningState {
		runId: string;
		seenKeys: Set<string>;
		writeQueue: Promise<unknown>;
	}
	const running = new Map<string, RunningState>();

	return {
		isShuttingDown() {
			return shuttingDown;
		},

		newGroupCount(firing, payload) {
			const keys = new Set<string>();
			for (const alert of firing) {
				const key = deriveGroupKey(alert, payload);
				if (!windows.has(key) && !running.has(key)) {
					keys.add(key);
				}
			}
			return keys.size;
		},

		pendingGroups() {
			return windows.size + running.size;
		},

		admit(firing, payload) {
			if (shuttingDown) {
				options.log("Dropped alert: grouping layer is shutting down");
				return;
			}
			for (const alert of firing) {
				const groupKey = deriveGroupKey(alert, payload);
				const dedupeKey = deriveDedupeKey(alert);

				if (running.has(groupKey)) {
					const state = running.get(groupKey);
					if (state && !state.seenKeys.has(dedupeKey)) {
						state.seenKeys.add(dedupeKey);
						// ATTACH
						state.writeQueue = state.writeQueue
							.then(() => options.sessions.appendGroupAlert(state.runId, alert))
							.catch((err) => {
								options.log(
									`Failed to attach late alert to group ${groupKey} (run ${state.runId}): ${err}`,
								);
							});
					}
					continue;
				}

				if (windows.has(groupKey)) {
					const state = windows.get(groupKey);
					if (state && !state.seenKeys.has(dedupeKey)) {
						state.seenKeys.add(dedupeKey);
						state.alerts.push(alert);
					}
					continue;
				}

				// IDLE -> WINDOW_OPEN
				const state: WindowState = {
					alerts: [alert],
					seenKeys: new Set([dedupeKey]),
					timer: setTimeout(() => {
						// timer fires -> RUNNING
						const alertsToRun = state.alerts;
						const seenKeys = state.seenKeys;
						windows.delete(groupKey);

						const runId = randomUUID();

						// synchronously set up the record
						const rec: GroupRecord = {
							groupKey,
							formedBy: "window",
							alerts: alertsToRun,
							lateAlerts: [],
						};

						const writePromise = Promise.resolve()
							.then(() => options.sessions.writeGroupRecord(runId, rec))
							.catch((err) => {
								options.log(
									`Failed to write group record for group ${groupKey} (run ${runId}): ${err} — investigation will proceed without it`,
								);
							});
						running.set(groupKey, {
							runId,
							seenKeys,
							writeQueue: writePromise,
						});

						writePromise
							.then(async () => {
								// Shutdown may land between the timer firing and the write
								// resolving; don't start a new investigation while closing.
								if (shuttingDown) {
									running.delete(groupKey);
									return;
								}
								try {
									await options.runInvestigation(runId, alertsToRun);
								} catch (err) {
									options.log(
										`Investigation for group ${groupKey} failed: ${err}`,
									);
								} finally {
									running.delete(groupKey);
								}
							})
							.catch((err) => {
								options.log(
									`Investigation for group ${groupKey} failed: ${err}`,
								);
								running.delete(groupKey);
							});
					}, options.windowMs),
				};
				windows.set(groupKey, state);
			}
		},

		shutdown() {
			shuttingDown = true;
			let dropped = 0;
			for (const state of windows.values()) {
				clearTimeout(state.timer);
				dropped++;
			}
			windows.clear();
			if (dropped > 0) {
				options.log(`Shutdown: dropped ${dropped} pending grouping windows`);
			}
		},
	};
}
