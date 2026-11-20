// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

/**
 * Writes JSON files as `biome check` wants them: a nightly PR force-pushes these files,
 * so a hand-formatted copy would be overwritten by the next night (#1173).
 */
export function writeJsonFormatted(entries) {
	for (const [path, data] of entries)
		writeFileSync(path, `${JSON.stringify(data, null, "\t")}\n`);
	execFileSync(
		process.execPath,
		[
			require.resolve("@biomejs/biome/bin/biome"),
			"format",
			"--write",
			...entries.map(([path]) => path),
		],
		{ stdio: ["ignore", "ignore", "inherit"] },
	);
}
