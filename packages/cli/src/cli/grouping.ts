// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { createHash, randomUUID } from "node:crypto";
import { alertFlapWindowMs, pickServiceLabel } from "@prismalens/config";
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
	/** #231 R4 flap window. Defaults to the one global knob
	 *  (`PRISMALENS_ALERT_FLAP_WINDOW_MINUTES`); tests inject their own. */
	flapWindowMs?: number;
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
		dedupeKeys: Set<string>;
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

	// #231 R4: dedupeKey -> the run it last completed under, and when. A refire
	// after completion still starts a NEW run; this only lets that run record
	// `previousRunId`. Entries older than the flap window are pruned on read.
	const flapWindowMs = options.flapWindowMs ?? alertFlapWindowMs();
	const completedRuns = new Map<
		string,
		{ runId: string; completedAtMs: number }
	>();

	function noteCompleted(runId: string, dedupeKeys: Set<string>): void {
		const completedAtMs = Date.now();
		for (const key of dedupeKeys) {
			completedRuns.set(key, { runId, completedAtMs });
		}
	}

	/** The most recent in-window predecessor across this group's dedupe keys. */
	function resolvePreviousRunId(
		dedupeKeys: Iterable<string>,
	): string | undefined {
		const now = Date.now();
		let best: { runId: string; completedAtMs: number } | undefined;
		for (const key of dedupeKeys) {
			const prior = completedRuns.get(key);
			if (!prior) continue;
			if (now - prior.completedAtMs > flapWindowMs) {
				completedRuns.delete(key);
				continue;
			}
			if (!best || prior.completedAtMs > best.completedAtMs) best = prior;
		}
		return best?.runId;
	}

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
									options.sessions.appendGroupAlert(state.runId!, alert),
								)
								/* v8 ignore start */
								.catch((err) => {
									options.log(
										`Failed to attach re-page to group ${active.groupKey} (run ${state.runId}): ${err}`,
									);
								});
							/* v8 ignore stop */
						} else {
							options.log(
								`Suppression lookup hit but run vanished for dedupeKey ${dedupeKey}`,
							);
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
						state.dedupeKeys.add(dedupeKey);
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
						const dedupeKeys = new Set<string>();

						// Move all these dedupe keys to the running phase
						for (const a of alertsToRun) {
							const dkey = deriveDedupeKey(a);
							activeAlerts.set(dkey, {
								phase: "running",
								groupKey,
								runId,
							});
							dedupeKeys.add(dkey);
						}

						// synchronously set up the record
						const previousRunId = resolvePreviousRunId(dedupeKeys);
						const rec: GroupRecord = {
							groupKey,
							formedBy: "window",
							alerts: alertsToRun,
							lateAlerts: [],
							...(previousRunId && { previousRunId }),
						};
						if (previousRunId) {
							options.log(
								`Run ${runId} refires group ${groupKey} within the flap window; linked to previous run ${previousRunId}`,
							);
						}

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
							dedupeKeys,
						});

						writePromise
							.then(async () => {
								// Shutdown may land between the timer firing and the write
								// resolving; don't start a new investigation while closing.
								if (shuttingDown) {
									running.delete(groupKey);
									for (const key of dedupeKeys) {
										activeAlerts.delete(key);
									}
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
									for (const key of dedupeKeys) {
										activeAlerts.delete(key);
									}
									noteCompleted(runId, dedupeKeys);
								}
							})
							.catch((err) => {
								options.log(
									`Investigation for group ${groupKey} failed: ${err}`,
								);
								running.delete(groupKey);
								for (const key of dedupeKeys) {
									activeAlerts.delete(key);
								}
								noteCompleted(runId, dedupeKeys);
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
			activeAlerts.clear();
			if (dropped > 0) {
				options.log(`Shutdown: dropped ${dropped} pending grouping windows`);
			}
		},
	};
}
