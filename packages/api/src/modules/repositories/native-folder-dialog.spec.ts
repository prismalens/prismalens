// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it, vi } from "vitest";
import {
	type DialogDeps,
	type DialogRun,
	folderDialogTool,
	pickNativeFolder,
	systemDialogDeps,
} from "./native-folder-dialog.js";

const ran = (over: Partial<DialogRun> = {}): DialogRun => ({
	code: 0,
	stdout: "",
	stderr: "",
	...over,
});

const deps = (
	over: Partial<DialogDeps> & { answer?: DialogRun } = {},
): DialogDeps & { run: ReturnType<typeof vi.fn> } => {
	const { answer, ...rest } = over;
	return {
		platform: "linux",
		env: { DISPLAY: ":0", HOME: "/home/me" },
		run: vi.fn(async () => answer ?? ran()),
		hasCommand: async (name: string) => name === "zenity",
		...rest,
	} as DialogDeps & { run: ReturnType<typeof vi.fn> };
};

describe("folderDialogTool", () => {
	it("runs Windows PowerShell single-threaded-apartment, asking Explorer's folder dialog through a topmost owner form", async () => {
		const tool = await folderDialogTool(deps({ platform: "win32", env: {} }));
		expect(tool?.command).toBe("powershell.exe");
		expect(tool?.args.slice(0, 5)).toEqual([
			"-NoProfile",
			"-NonInteractive",
			"-STA",
			"-ExecutionPolicy",
			"Bypass",
		]);
		const encoded = tool?.args[tool.args.indexOf("-EncodedCommand") + 1] ?? "";
		const script = Buffer.from(encoded, "base64").toString("utf16le");
		expect(script).toContain("$owner.TopMost = $true");
		expect(script).toContain("Pick($owner.Handle, 'Select a folder', $owner.Left, $owner.Top)");
		expect(script).toContain("dialog.SetOptions(options | 0x20 | 0x40 | 0x800)");
	});

	it("asks macOS for a folder through osascript", async () => {
		const tool = await folderDialogTool(deps({ platform: "darwin", env: {} }));
		expect(tool).toEqual({
			command: "osascript",
			args: ["-e", 'POSIX path of (choose folder with prompt "Select a folder")'],
		});
	});

	it("prefers zenity on Linux, then kdialog", async () => {
		expect(await folderDialogTool(deps())).toEqual({
			command: "zenity",
			args: ["--file-selection", "--directory", "--title=Select a folder"],
		});
		const kde = await folderDialogTool(
			deps({ hasCommand: async (name) => name === "kdialog" }),
		);
		expect(kde).toEqual({
			command: "kdialog",
			args: ["--getexistingdirectory", "/home/me", "--title", "Select a folder"],
		});
	});

	it("has no tool on Linux without a display, or without zenity and kdialog", async () => {
		expect(await folderDialogTool(deps({ env: {} }))).toBeNull();
		expect(
			await folderDialogTool(deps({ hasCommand: async () => false })),
		).toBeNull();
	});

	it("takes a Wayland-only session as a display", async () => {
		const tool = await folderDialogTool(
			deps({ env: { WAYLAND_DISPLAY: "wayland-0" } }),
		);
		expect(tool?.command).toBe("zenity");
	});
});

describe("pickNativeFolder", () => {
	it("answers the Windows path as printed", async () => {
		const d = deps({
			platform: "win32",
			answer: ran({ stdout: "C:\\Users\\me\\code" }),
		});
		expect(await pickNativeFolder(d)).toEqual({
			status: "picked",
			path: "C:\\Users\\me\\code",
		});
	});

	it("keeps a drive root's separator", async () => {
		const d = deps({ platform: "win32", answer: ran({ stdout: "C:\\" }) });
		expect(await pickNativeFolder(d)).toEqual({
			status: "picked",
			path: "C:\\",
		});
	});

	it("drops the trailing slash and newline osascript prints", async () => {
		const d = deps({
			platform: "darwin",
			answer: ran({ stdout: "/Users/me/code/\n" }),
		});
		expect(await pickNativeFolder(d)).toEqual({
			status: "picked",
			path: "/Users/me/code",
		});
	});

	it("is cancelled, with no path, when the dialog prints nothing", async () => {
		expect(await pickNativeFolder(deps({ answer: ran({ stdout: "" }) }))).toEqual(
			{ status: "cancelled" },
		);
	});

	it("is cancelled on exit 1 (zenity, kdialog) and on osascript's -128", async () => {
		expect(await pickNativeFolder(deps({ answer: ran({ code: 1 }) }))).toEqual({
			status: "cancelled",
		});
		const mac = deps({
			platform: "darwin",
			answer: ran({
				code: 2,
				stderr: "execution error: User canceled. (-128)",
			}),
		});
		expect(await pickNativeFolder(mac)).toEqual({ status: "cancelled" });
	});

	it("is unavailable, not an error, when no tool exists or the dialog cannot start", async () => {
		const none = deps({ hasCommand: async () => false });
		expect(await pickNativeFolder(none)).toEqual({ status: "unavailable" });
		expect(none.run).not.toHaveBeenCalled();
		expect(
			await pickNativeFolder(deps({ answer: ran({ code: null }) })),
		).toEqual({ status: "unavailable" });
		expect(await pickNativeFolder(deps({ answer: ran({ code: 5 }) }))).toEqual({
			status: "unavailable",
		});
	});

	it("opens one dialog for two calls made while it is open", async () => {
		let finish: (r: DialogRun) => void = () => undefined;
		const d = deps();
		d.run.mockImplementation(
			() => new Promise<DialogRun>((resolve) => (finish = resolve)),
		);
		const first = pickNativeFolder(d);
		const second = pickNativeFolder(d);
		await vi.waitFor(() => expect(d.run).toHaveBeenCalledTimes(1));
		finish(ran({ stdout: "/work\n" }));
		expect(await first).toEqual({ status: "picked", path: "/work" });
		expect(await second).toEqual({ status: "picked", path: "/work" });
		expect(d.run).toHaveBeenCalledTimes(1);
	});
});

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
