// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Whether a service stop shut the API down once (#717), from the SIGTERM listener runs and
 * stop requests its preload logged. Through the launcher alone: one request, which raises
 * one synthetic SIGTERM. A cgroup stop: the real SIGTERM, and the launcher's request if it
 * arrived while the API still ran; when the request lands first, the real signal follows
 * its synthetic one, so two listener runs with one request is still one shutdown.
 */
export function stopsOnce(how, seen, asked) {
	if (how === "main") return seen === 1 && asked === 1;
	return (seen === 1 && asked <= 1) || (seen === 2 && asked === 1);
}
