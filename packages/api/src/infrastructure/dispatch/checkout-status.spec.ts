// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkoutStatus, readGit } from "./checkout-status.js";

function tempRepo(): string {
	const dir = mkdtempSync(join(tmpdir(), "pl-checkout-status-"));
	execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
	execFileSync("git", ["config", "user.email", "t@example.com"], { cwd: dir });
	execFileSync("git", ["config", "user.name", "t"], { cwd: dir });
	writeFileSync(join(dir, "a.txt"), "hello\n");
	execFileSync("git", ["add", "."], { cwd: dir });
	execFileSync("git", ["commit", "-q", "-m", "initial"], { cwd: dir });
	return dir;
}

describe("checkoutStatus off the event loop (#1066)", () => {
	it("returns a Promise and yields to the event loop before resolving", async () => {
		const repoDir = tempRepo();
		try {
			let ranBefore = false;
			const promise = checkoutStatus(repoDir);
			expect(promise).toBeInstanceOf(Promise);
			setImmediate(() => {
				ranBefore = true;
			});
			const status = await promise;
			expect(ranBefore).toBe(true);
			status.close();
		} finally {
			rmSync(repoDir, { recursive: true, force: true });
		}
	}, 30_000);

	it("readGit rejects on non-zero exit", async () => {
		const repoDir = tempRepo();
		try {
			await expect(
				readGit(["no-such-subcommand"], { cwd: repoDir, env: process.env }),
			).rejects.toThrow();
		} finally {
			rmSync(repoDir, { recursive: true, force: true });
		}
	}, 30_000);
});
