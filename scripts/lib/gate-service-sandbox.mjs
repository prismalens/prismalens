// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Keeps the gate's `pl service` out of the operator's ~/.config (#831): the unit sits in the sandbox,
 * the user manager reaches it by a $XDG_RUNTIME_DIR link whose drop-in caps memory (the unit runs
 * outside the caller's scope), and a `systemctl` shim sends enable and disable to --runtime.
 */
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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

export function isolateService({ configHome, runtimeDir, tools, systemctl }) {
	const unitPath = join(configHome, "systemd", "user", UNIT);
	const unitDir = join(runtimeDir, "systemd", "user");
	const link = join(unitDir, UNIT);
	const dropIns = join(unitDir, `${UNIT}.d`);
	mkdirSync(dropIns, { recursive: true });
	rmSync(link, { force: true });
	symlinkSync(unitPath, link);
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
			rmSync(link, { force: true });
			rmSync(dropIns, { recursive: true, force: true });
			rmSync(join(unitDir, "default.target.wants", UNIT), { force: true });
		},
	};
}
