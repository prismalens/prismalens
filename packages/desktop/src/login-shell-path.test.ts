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

	it("resolves the fixed PATH when SHELL points to a script in a temp dir", async () => {
		tempDir = mkdtempSync(join(tmpdir(), "pl-login-shell-"));
		const scriptPath = join(tempDir, "shell.sh");
		const fixedPath = "/custom/bin:/usr/local/bin:/usr/bin";
		writeFileSync(scriptPath, `#!/bin/sh\nprintf "%s" "${fixedPath}"\n`);
		chmodSync(scriptPath, 0o755);

		const result = await readLoginShellPath({
			...process.env,
			SHELL: scriptPath,
		});
		expect(result).toBe(fixedPath);
	});

	it("resolves undefined when SHELL points to /bin/false", async () => {
		const result = await readLoginShellPath({
			...process.env,
			SHELL: "/bin/false",
		});
		expect(result).toBeUndefined();
	});
});
