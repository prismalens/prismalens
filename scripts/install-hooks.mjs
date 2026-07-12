// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

function installHooks() {
	let gitCommonDir;
	try {
		gitCommonDir = execSync("git rev-parse --git-common-dir", {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
		}).trim();
	} catch (_error) {
		console.warn(
			"WARN: Not in a git repository or git is not installed. Skipping hook installation.",
		);
		process.exit(0);
	}

	const hooksDir = path.join(gitCommonDir, "hooks");
	const preCommitHookPath = path.join(hooksDir, "pre-commit");

	// The hook is convenience automation; CI spdx:check is the enforcement backstop.
	// Unguarded failure would block commits on branches that predate --fix-staged.
	// So we use || true to prevent blocking commits.
	const hookLine = "pnpm -s spdx:fix-staged 2>/dev/null || true";

	try {
		if (!fs.existsSync(hooksDir)) {
			fs.mkdirSync(hooksDir, { recursive: true });
		}

		if (!fs.existsSync(preCommitHookPath)) {
			fs.writeFileSync(preCommitHookPath, `#!/bin/sh\n\n${hookLine}\n`);
			console.log("Created new pre-commit hook.");
		} else {
			const currentContent = fs.readFileSync(preCommitHookPath, "utf8");
			// Idempotency check: legacy placement anywhere in the file is tolerated.
			if (!currentContent.includes(hookLine)) {
				let newContent = "";
				if (currentContent.startsWith("#!")) {
					const firstNewline = currentContent.indexOf("\n");
					if (firstNewline !== -1) {
						newContent =
							currentContent.slice(0, firstNewline + 1) +
							hookLine +
							"\n" +
							currentContent.slice(firstNewline + 1);
					} else {
						newContent = `${currentContent}\n${hookLine}\n`;
					}
				} else {
					newContent = `#!/bin/sh\n${hookLine}\n${currentContent}`;
				}
				fs.writeFileSync(preCommitHookPath, newContent);
				console.log("Inserted spdx hook into existing pre-commit hook.");
			} else {
				console.log(
					"spdx hook already present in pre-commit hook. Doing nothing.",
				);
			}
		}

		// Enforce executable bit on every path (create, insert, and no-op)
		fs.chmodSync(preCommitHookPath, 0o755);
	} catch (error) {
		console.warn(
			`WARN: Failed to write to hooks directory (${hooksDir}). It may be unwritable. Skipping hook installation.`,
		);
		console.warn(`Error details: ${error.message}`);
		process.exit(0);
	}
}

installHooks();
