// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import authCmd from "./auth.js";
import consola from "consola";

describe("auth login", () => {
	let exitSpy: any;
	let errorSpy: any;
	let originalIsTTY: boolean | undefined;

	beforeEach(() => {
		exitSpy = vi.spyOn(process, "exit").mockImplementation((() => { throw new Error("process.exit"); }) as any);
		errorSpy = vi.spyOn(consola, "error").mockImplementation(() => {});
		originalIsTTY = process.stdin.isTTY;
	});

	afterEach(() => {
		if (originalIsTTY !== undefined) {
			process.stdin.isTTY = originalIsTTY;
		} else {
			delete process.stdin.isTTY;
		}
		vi.restoreAllMocks();
	});

	it("non-TTY login without --api-key exits 1", async () => {
		process.stdin.isTTY = false;

		// Note: authCmd.subCommands.login is a CommandDef
		const loginCmd = authCmd.subCommands!.login as any;

		await expect(loginCmd.run({
			args: { provider: "openai", "api-key": undefined },
			cmd: loginCmd,
			data: {},
		})).rejects.toThrow("process.exit");

		expect(errorSpy).toHaveBeenCalledWith(
			"--api-key is required in non-interactive mode",
		);
		expect(exitSpy).toHaveBeenCalledWith(1);
	});
});
