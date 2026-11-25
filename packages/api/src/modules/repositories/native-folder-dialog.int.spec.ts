// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it, vi } from "vitest";
import { systemDialogDeps } from "./native-folder-dialog.js";

vi.setConfig({ testTimeout: 5_000 }); // slowest test 86 ms; 3x, rounded up to the second, at least 5 s (#1154)

describe("systemDialogDeps", () => {
	it("returns the exit code and output of a process it ran", async () => {
		const out = await systemDialogDeps.run(process.execPath, [
			"-e",
			"process.stdout.write('/picked'); process.stderr.write('note'); process.exit(3)",
		]);
		expect(out).toEqual({ code: 3, stdout: "/picked", stderr: "note" });
	});

	it("reports a missing program as code null, not a throw", async () => {
		const out = await systemDialogDeps.run("pl-no-such-dialog-tool", []);
		expect(out.code).toBeNull();
	});

	it("finds a program on PATH and not an invented one", async () => {
		const name = process.platform === "win32" ? "node.exe" : "node";
		expect(await systemDialogDeps.hasCommand(name)).toBe(true);
		expect(await systemDialogDeps.hasCommand("pl-no-such-dialog-tool")).toBe(
			false,
		);
	});
});
