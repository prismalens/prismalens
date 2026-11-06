// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { EventEmitter } from "node:events";
import { join, resolve } from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const spawned: { cmd: string; args: string[]; opts: Record<string, unknown> }[] = [];
let fail = false;
vi.mock("cross-spawn", () => ({
	default: (cmd: string, args: string[], opts: Record<string, unknown>) => {
		spawned.push({ cmd, args, opts });
		const child = Object.assign(new EventEmitter(), { unref: vi.fn() });
		queueMicrotask(() =>
			fail ? child.emit("error", new Error("ENOENT")) : child.emit("spawn"),
		);
		return child;
	},
}));

const { detectEditors, editorCommand, findOnPath, insideRoot, launch } = await import(
	"./editors.js"
);

beforeEach(() => {
	spawned.length = 0;
	fail = false;
});

describe("editor argument arrays (#1024 decision 7)", () => {
	const file = "/w/repo/src/a.ts";
	it.each([
		["vscode", ["--goto", `${file}:12`]],
		["cursor", ["--goto", `${file}:12`]],
		["zed", [`${file}:12`]],
		["jetbrains", ["--line", "12", file]],
		["sublime", [`${file}:12`]],
	] as const)("opens %s at a line", (id, args) => {
		expect(editorCommand(id, file, 12, { platform: "linux", command: "/bin/x" })).toEqual([
			"/bin/x",
			args,
		]);
	});

	it("opens a folder with no line flag", () => {
		expect(editorCommand("vscode", "/w/repo", undefined, { platform: "linux", command: "code" })[1]).toEqual(["/w/repo"]);
		expect(editorCommand("jetbrains", "/w/repo", undefined, { platform: "linux", command: "idea" })[1]).toEqual(["/w/repo"]);
	});

	it.each([
		["win32", "explorer.exe"],
		["darwin", "open"],
		["linux", "xdg-open"],
	] as const)("uses the system default on %s", (platform, cmd) => {
		expect(editorCommand("system", file, 3, { platform })).toEqual([cmd, [file]]);
	});

	it("refuses an editor it did not find", () => {
		expect(() => editorCommand("zed", file, 1, { platform: "linux" })).toThrow(/not installed/);
	});
});

describe("finding editors on PATH", () => {
	it("tries each PATHEXT extension on Windows", () => {
		const have = new Set([join("C:\\bin", "code.CMD"), join("C:\\tools", "subl.EXE")]);
		const env = { platform: "win32" as const, PATH: "C:\\bin;C:\\tools", PATHEXT: ".EXE;.CMD" };
		expect(findOnPath("code", env, (p) => have.has(p))).toBe(join("C:\\bin", "code.CMD"));
		expect(detectEditors(env, (p) => have.has(p)).map((e) => e.id)).toEqual([
			"vscode",
			"sublime",
		]);
	});

	it("reads a POSIX PATH with no extensions, first editor binary winning", () => {
		const have = new Set([join("/usr/bin", "zeditor"), join("/opt/bin", "webstorm")]);
		const env = { platform: "linux" as const, PATH: "/usr/bin:/opt/bin" };
		expect(detectEditors(env, (p) => have.has(p))).toEqual([
			{ id: "zed", label: "Zed", command: join("/usr/bin", "zeditor") },
			{ id: "jetbrains", label: "JetBrains", command: join("/opt/bin", "webstorm") },
		]);
		expect(findOnPath("code", { platform: "darwin" }, () => true)).toBeNull();
	});

	it("reads the real PATH without throwing", () => {
		expect(Array.isArray(detectEditors())).toBe(true);
	});
});

describe("paths stay in the workspace", () => {
	it("keeps a relative path inside and refuses one that leaves", () => {
		expect(insideRoot("/w/repo", "src/a.ts")).toBe(resolve("/w/repo", "src/a.ts"));
		expect(insideRoot("/w/repo")).toBe(resolve("/w/repo"));
		expect(insideRoot("/w/repo", "../other/a.ts")).toBeNull();
		expect(insideRoot("/w/repo", resolve("/etc/passwd"))).toBeNull();
	});
});

describe("launch", () => {
	it("spawns detached with an argument array and no shell", async () => {
		expect(await launch("code", ["--goto", "a b.ts:3"])).toBe(true);
		expect(spawned[0]).toMatchObject({
			cmd: "code",
			args: ["--goto", "a b.ts:3"],
			opts: { detached: true, stdio: "ignore" },
		});
		expect(spawned[0]?.opts.shell).toBeUndefined();
	});

	it("reports a spawn that failed", async () => {
		fail = true;
		expect(await launch("nope", [])).toBe(false);
	});
});

describe("RunWorkspacesService.openInEditor", async () => {
	const { mkdtempSync, rmSync, writeFileSync } = await import("node:fs");
	const { tmpdir } = await import("node:os");
	const { RunWorkspacesService } = await import("./run-workspaces.service.js");
	const cwd = mkdtempSync(join(tmpdir(), "pl-editor-"));
	writeFileSync(join(cwd, "a.ts"), "x\n");
	const RUN = "11111111-1111-4111-8111-111111111111";
	const svc = (workspace: unknown, editor = "system") =>
		new RunWorkspacesService({
			investigation: {
				findUnique: async ({ where }: { where: { id: string } }) =>
					where.id === RUN
						? { workspace: workspace ? JSON.stringify(workspace) : null }
						: null,
			},
			setting: {
				findUnique: async () => ({ value: JSON.stringify({ prStatus: true, editor }) }),
			},
		} as never);
	const ws = { layout: "folder", cwd, repos: [] };
	afterAll(() => rmSync(cwd, { recursive: true, force: true }));

	it("opens a file in the workspace with the setting's editor", async () => {
		expect(await svc(ws).openInEditor({ id: RUN, path: "a.ts", line: 2 })).toEqual({
			opened: true,
			editor: "system",
		});
		expect(spawned.at(-1)?.args).toEqual([join(cwd, "a.ts")]);
	});

	it("refuses a path outside it, a missing file, no workspace and an editor not installed", async () => {
		await expect(svc(ws).openInEditor({ id: RUN, path: "../x" })).rejects.toThrow(
			/No such file/,
		);
		await expect(svc(ws).openInEditor({ id: RUN, path: "nope.ts" })).rejects.toThrow(
			/No such file/,
		);
		await expect(svc(null).openInEditor({ id: RUN })).rejects.toThrow(/no workspace/);
		await expect(
			svc(ws).openInEditor({ id: "22222222-2222-4222-8222-222222222222" }),
		).rejects.toThrow(/no workspace/);
		if (!detectEditors().some((e) => e.id === "zed"))
			await expect(svc(ws, "zed").openInEditor({ id: RUN })).rejects.toThrow(
				/not installed/,
			);
	});

	it("never opens a file a junction or link inside the workspace points outside it", async () => {
		const { mkdirSync, symlinkSync } = await import("node:fs");
		const outside = mkdtempSync(join(tmpdir(), "pl-editor-out-"));
		try {
			mkdirSync(join(outside, "d"));
			writeFileSync(join(outside, "d", "secret.txt"), "x\n");
			// A junction needs no privilege on Windows; a failure here is a broken fixture.
			symlinkSync(join(outside, "d"), join(cwd, "escape"), "junction");
			const before = spawned.length;
			await expect(
				svc(ws).openInEditor({ id: RUN, path: "escape/secret.txt" }),
			).rejects.toThrow(/No such file/);
			await expect(svc(ws).openInEditor({ id: RUN, path: "escape" })).rejects.toThrow(
				/No such file/,
			);
			expect(spawned.length).toBe(before);
		} finally {
			rmSync(join(cwd, "escape"), { recursive: true, force: true });
			rmSync(outside, { recursive: true, force: true });
		}
	});

	it("says when the editor did not start", async () => {
		fail = true;
		expect((await svc(ws).openInEditor({ id: RUN })).opened).toBe(false);
	});
});
