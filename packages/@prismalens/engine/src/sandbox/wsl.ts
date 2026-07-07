// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * WSL detection for `auto` sandbox selection (2026-07-07). srt's egress bridge is
 * unreliable under WSL in BOTH networking modes — mirrored blackholes every request
 * while the mux logs "bridges ready" (B.1.1, verified on real WSL2), and NAT was
 * verified probe-unhealthy on a real dev box (2026-07-07). So `auto` floors on WSL
 * without spending the spawn-y egress probe, as an EXPECTED degrade (calm log, not a
 * per-run warning). An explicit `--sandbox srt` is untouched — forcing enforcement on
 * a WSL setup where the bridge works remains a validated opt-in.
 */
import { readFile } from "node:fs/promises";

/** True when running inside Windows Subsystem for Linux (any networking mode). */
export async function detectWsl(): Promise<boolean> {
	if (process.platform !== "linux") return false;
	if (process.env.WSL_DISTRO_NAME) return true;
	const version = await readFile("/proc/version", "utf8").catch(() => "");
	return /microsoft/i.test(version);
}
