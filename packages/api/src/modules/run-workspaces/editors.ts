// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Open in editor (#1024 decision 7): each editor gets an argument array and no
 * shell. On Windows an editor's executable is found through PATH and PATHEXT.
 */
import { statSync } from "node:fs";
import { realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import type { Editor, EditorId } from "@prismalens/contracts";
import spawn from "cross-spawn";

interface EditorSpec {
	id: EditorId;
	label: string;
	/** Executables tried in order; the first on PATH wins. */
	bins: string[];
	args: (target: string, line?: number) => string[];
}

const goto = (target: string, line?: number) =>
	line ? ["--goto", `${target}:${line}`] : [target];
const suffix = (target: string, line?: number) =>
	line ? [`${target}:${line}`] : [target];

export const EDITORS: readonly EditorSpec[] = [
	{ id: "vscode", label: "VS Code", bins: ["code"], args: goto },
	{ id: "cursor", label: "Cursor", bins: ["cursor"], args: goto },
	{ id: "zed", label: "Zed", bins: ["zed", "zeditor"], args: suffix },
	{
		id: "jetbrains",
		label: "JetBrains",
		bins: [
			"idea",
			"webstorm",
			"pycharm",
			"goland",
			"phpstorm",
			"rider",
			"clion",
		],
		args: (target, line) =>
			line ? ["--line", String(line), target] : [target],
	},
	{ id: "sublime", label: "Sublime Text", bins: ["subl"], args: suffix },
];

export interface PathEnv {
	platform: NodeJS.Platform;
	PATH?: string;
	PATHEXT?: string;
}

function isFile(path: string): boolean {
	try {
		return statSync(path).isFile();
	} catch {
		return false;
	}
}

/** The executable `bin` resolves to on PATH; Windows also tries each PATHEXT extension. */
export function findOnPath(
	bin: string,
	env: PathEnv = {
		platform: process.platform,
		PATH: process.env.PATH ?? process.env.Path,
		PATHEXT: process.env.PATHEXT,
	},
	exists: (path: string) => boolean = isFile,
): string | null {
	const win = env.platform === "win32";
	const exts = win
		? (env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean)
		: [""];
	for (const dir of (env.PATH ?? "").split(win ? ";" : ":").filter(Boolean))
		for (const ext of exts) {
			const candidate = join(dir, bin + ext);
			if (exists(candidate)) return candidate;
		}
	return null;
}

export function detectEditors(
	env?: PathEnv,
	exists?: (path: string) => boolean,
): Editor[] {
	const out: Editor[] = [];
	for (const e of EDITORS)
		for (const bin of e.bins) {
			const command = findOnPath(bin, env, exists);
			if (command) {
				out.push({ id: e.id, label: e.label, command });
				break;
			}
		}
	return out;
}

/** The file or folder inside `root`; null for a path that leaves it. */
export function insideRoot(root: string, path?: string): string | null {
	if (!path) return resolve(root);
	if (isAbsolute(path)) return null;
	const target = resolve(root, path);
	const rel = relative(resolve(root), target);
	if (rel.startsWith("..") || isAbsolute(rel)) return null;
	return target;
}

/**
 * {@link insideRoot}, then the same check on the real paths, so a junction or link inside
 * `root` that points outside it is refused; null too when the target does not exist.
 */
export async function existingInsideRoot(
	root: string,
	path?: string,
): Promise<string | null> {
	const target = insideRoot(root, path);
	if (!target) return null;
	try {
		const [real, realRoot] = await Promise.all([
			realpath(target),
			realpath(root),
		]);
		return real === realRoot || real.startsWith(realRoot + sep) ? target : null;
	} catch {
		return null;
	}
}

/** The command and arguments that open `target`: an editor's own, or the system's default app. */
export function editorCommand(
	editor: EditorId | "system",
	target: string,
	line: number | undefined,
	opts: { platform: NodeJS.Platform; command?: string },
): [string, string[]] {
	if (editor !== "system") {
		const spec = EDITORS.find((e) => e.id === editor);
		if (!spec || !opts.command) throw new Error(`${editor} is not installed`);
		return [opts.command, spec.args(target, line)];
	}
	if (opts.platform === "win32") return ["explorer.exe", [target]];
	if (opts.platform === "darwin") return ["open", [target]];
	return ["xdg-open", [target]];
}

/** Starts the editor detached; true once it spawned. */
export function launch(command: string, args: string[]): Promise<boolean> {
	return new Promise((done) => {
		try {
			const child = spawn(command, args, {
				detached: true,
				stdio: "ignore",
				windowsHide: true,
			});
			child.once("error", () => done(false));
			child.once("spawn", () => {
				child.unref();
				done(true);
			});
		} catch {
			done(false);
		}
	});
}
