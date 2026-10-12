// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Keeps the gate's `pl service` out of the operator's ~/.config (#831): the unit sits in the sandbox,
 * the user manager reaches it by a $XDG_RUNTIME_DIR link whose drop-in caps memory (the unit runs
 * outside the caller's scope), and a `systemctl` shim sends enable and disable to --runtime.
 */
import {
	mkdirSync,
	readlinkSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";

export const UNIT = "prismalens.service";
export const UNIT_MEMORY_MAX = "1536M";

/** The `systemctl` that PATH finds first: --runtime on enable and disable, else the real one. */
export function systemctlShim(systemctl) {
	const real = `'${systemctl.replaceAll("'", "'\\''")}'`;
	return `#!/bin/sh
case " $* " in
*" enable "*|*" disable "*) exec ${real} "$@" --runtime ;;
esac
exec ${real} "$@"
`;
}

function linkTarget(path) {
	try {
		return readlinkSync(path);
	} catch {
		return null;
	}
}

export function isolateService({ configHome, runtimeDir, tools, systemctl }) {
	const unitPath = join(configHome, "systemd", "user", UNIT);
	const unitDir = join(runtimeDir, "systemd", "user");
	const link = join(unitDir, UNIT);
	const dropIns = join(unitDir, `${UNIT}.d`);
	mkdirSync(dropIns, { recursive: true });
	// The runtime dir is shared: another check's link is never replaced (#834 review).
	try {
		symlinkSync(unitPath, link);
	} catch (err) {
		if (err?.code !== "EEXIST") throw err;
		throw new Error(
			`${link} exists: another gate check holds the service. Remove it only if none runs.`,
		);
	}
	writeFileSync(
		join(dropIns, "50-gate-memory.conf"),
		`[Service]\nMemoryMax=${UNIT_MEMORY_MAX}\nMemorySwapMax=0\n`,
	);
	writeFileSync(join(tools, "systemctl"), systemctlShim(systemctl), {
		mode: 0o755,
	});
	return {
		unitPath,
		remove() {
			if (linkTarget(link) !== unitPath) return;
			rmSync(link, { force: true });
			rmSync(dropIns, { recursive: true, force: true });
			rmSync(join(unitDir, "default.target.wants", UNIT), { force: true });
		},
	};
}
