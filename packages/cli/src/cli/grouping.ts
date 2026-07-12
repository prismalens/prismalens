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
	}
	const windows = new Map<string, WindowState>();

	// Running investigations
	interface RunningState {
		runId: string;
		writeQueue: Promise<unknown>;
	}
	const running = new Map<string, RunningState>();

	// Global registry of all dedupe keys currently in flight (in a window or running).
	// Used for fingerprint-level suppression across groups/re-pages (#137).
	interface ActiveAlert {
		phase: "window" | "running";
		groupKey: string;
		runId?: string;
	}
	const activeAlerts = new Map<string, ActiveAlert>();

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

				// 1. Fingerprint-level suppression (Issue #137)
				// If this exact fingerprint is already in-flight anywhere, attach the re-page
				// to its existing investigation and suppress dispatch.
				if (activeAlerts.has(dedupeKey)) {
					const active = activeAlerts.get(dedupeKey);
					if (active && active.phase === "running" && active.runId) {
						const state = running.get(active.groupKey);
						/* v8 ignore next */
						if (state) {
							// Note the re-page on the existing run
							state.writeQueue = state.writeQueue
								.then(() =>
									options.sessions.appendGroupAlert(state.runId, alert),
								)
								/* v8 ignore start */
								.catch((err) => {
									options.log(
										`Failed to attach re-page to group ${active.groupKey} (run ${state.runId}): ${err}`,
									);
								});
							/* v8 ignore stop */
						}
					}
					// If phase === "window", it's buffered; no action needed.
					continue;
				}

				// 2. Group-level attachment (AC2)
				// If the group is already running, attach this NEW alert (different dedupeKey) to it.
				if (running.has(groupKey)) {
					const state = running.get(groupKey);
					/* v8 ignore next */
					if (state) {
						// Note: we don't need seenKeys here because activeAlerts handles exact dupes above.
						activeAlerts.set(dedupeKey, {
							phase: "running",
							groupKey,
							runId: state.runId,
						});
						state.writeQueue = state.writeQueue
							.then(() => options.sessions.appendGroupAlert(state.runId, alert))
							/* v8 ignore start */
							.catch((err) => {
								options.log(
									`Failed to attach late alert to group ${groupKey} (run ${state.runId}): ${err}`,
								);
							});
						/* v8 ignore stop */
					}
					continue;
				}

				if (windows.has(groupKey)) {
					const state = windows.get(groupKey);
					/* v8 ignore next */
					if (state) {
						activeAlerts.set(dedupeKey, { phase: "window", groupKey });
						state.alerts.push(alert);
					}
					continue;
				}

				// IDLE -> WINDOW_OPEN
				const state: WindowState = {
					alerts: [alert],
					timer: setTimeout(() => {
						// timer fires -> RUNNING
						const alertsToRun = state.alerts;
						windows.delete(groupKey);

						const runId = randomUUID();

						// Move all these dedupe keys to the running phase
						for (const a of alertsToRun) {
							activeAlerts.set(deriveDedupeKey(a), {
								phase: "running",
								groupKey,
								runId,
							});
						}

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
									// Clean up global fingerprint registry for this run
									for (const a of alertsToRun) {
										activeAlerts.delete(deriveDedupeKey(a));
									}
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
				activeAlerts.set(dedupeKey, { phase: "window", groupKey });
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
