// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	chmodSync,
	existsSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readLoginShellPath } from "./login-shell-path.js";

describe("readLoginShellPath", () => {
	let tempDir: string | undefined;

	afterEach(() => {
		if (tempDir) {
			rmSync(tempDir, { recursive: true, force: true });
			tempDir = undefined;
		}
	});

	it("on win32 resolves undefined without spawning", async () => {
		const originalPlatform = process.platform;
		try {
			Object.defineProperty(process, "platform", {
				value: "win32",
				configurable: true,
			});

			tempDir = mkdtempSync(join(tmpdir(), "pl-win32-test-"));
			const canary = join(tempDir, "canary");
			const scriptPath = join(tempDir, "shell.sh");
			writeFileSync(scriptPath, `#!/bin/sh\ntouch "${canary}"\n`);
			chmodSync(scriptPath, 0o755);

			const result = await readLoginShellPath({
				...process.env,
				SHELL: scriptPath,
			});
			expect(result).toBeUndefined();
			expect(existsSync(canary)).toBe(false);
		} finally {
			Object.defineProperty(process, "platform", {
				value: originalPlatform,
				configurable: true,
			});
		}
	});

	/** A fake login shell: runs the `-c` command it is given with a fixed PATH, after `banner`. */
	function fakeShell(fixedPath: string, banner: string): string {
		tempDir = mkdtempSync(join(tmpdir(), "pl-login-shell-"));
		const scriptPath = join(tempDir, "shell.sh");
		writeFileSync(
			scriptPath,
			`#!/bin/sh\ntouch "${join(tempDir, "ran")}"\nprintf "%s" "${banner}"\nPATH="${fixedPath}"\neval "$2"\nprintf "done\\n"\n`,
		);
		chmodSync(scriptPath, 0o755);
		return scriptPath;
	}

	// Windows has no login shell to ask: the PATH is undefined and the fake never runs (#1154).
	const posix = process.platform !== "win32";
	function expectShellPath(result: string | undefined, fixedPath: string) {
		expect(result).toBe(posix ? fixedPath : undefined);
		expect(existsSync(join(tempDir as string, "ran"))).toBe(posix);
	}

	it("resolves the PATH the login shell reports", async () => {
		const fixedPath = "/custom/bin:/usr/local/bin:/usr/bin";
		const result = await readLoginShellPath({
			...process.env,
			SHELL: fakeShell(fixedPath, ""),
		});
		expectShellPath(result, fixedPath);
	});

	it("ignores what an interactive shell prints around the PATH", async () => {
		const fixedPath = "/custom/bin:/usr/bin";
		const result = await readLoginShellPath({
			...process.env,
			SHELL: fakeShell(fixedPath, "Welcome to your shell\\n"),
		});
		expectShellPath(result, fixedPath);
	});

	it("resolves undefined when the shell prints no marked PATH", async () => {
		tempDir = mkdtempSync(join(tmpdir(), "pl-login-shell-"));
		const scriptPath = join(tempDir, "shell.sh");
		writeFileSync(scriptPath, `#!/bin/sh\nprintf "%s" "/usr/bin"\n`);
		chmodSync(scriptPath, 0o755);
		const result = await readLoginShellPath({
			...process.env,
			SHELL: scriptPath,
		});
		expect(result).toBeUndefined();
	});

	it("resolves undefined when SHELL points to /bin/false", async () => {
		const result = await readLoginShellPath({
			...process.env,
			SHELL: "/bin/false",
		});
		expect(result).toBeUndefined();
	});
});
