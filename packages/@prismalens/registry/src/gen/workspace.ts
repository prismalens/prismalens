// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, posix, resolve } from "node:path";
import type { Manifest } from "../manifest.ts";
import { type Config, generate, loadConfig } from "./index.ts";

/** One import boundary: no file under `from` may import a specifier starting with any of `deny`. */
export interface Boundary {
	readonly from: string;
	readonly deny: readonly string[];
	readonly why: string;
}

/** `registry.workspace.json`: every host the CLI reads, and the checks that span them. Paths are repo-relative. */
export interface Workspace {
	/** Absolute repo root: the workspace file's folder. */
	readonly root: string;
	readonly hosts: readonly Config[];
	readonly boundaries: readonly Boundary[];
}

export function loadWorkspace(file: string): Workspace {
	const abs = resolve(file);
	const root = dirname(abs);
	const raw = JSON.parse(readFileSync(abs, "utf8")) as {
		hosts: string[];
		boundaries?: Boundary[];
	};
	return {
		root,
		hosts: raw.hosts.map((h) => loadConfig(join(root, h))),
		boundaries: raw.boundaries ?? [],
	};
}

/** The workspace a host config names, when it names one. */
export const workspaceOf = (cfg: Config): Workspace | undefined =>
	cfg.workspace ? loadWorkspace(join(cfg.root, cfg.workspace)) : undefined;

const SOURCE = /\.(?:[cm]?[jt]sx?)$/;
const SPECIFIER =
	/(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|^\s*import\s+)["']([^"']+)["']/gm;

/** Every source file under a repo-relative dir, skipping dependencies and build output. */
function walk(root: string, dir: string): string[] {
	const abs = join(root, dir);
	if (!existsSync(abs)) return [];
	return (readdirSync(abs, { recursive: true }) as string[])
		.map((f) => posix.join(dir, f.split("\\").join("/")))
		.filter(
			(f) =>
				SOURCE.test(f) &&
				!f.includes("/node_modules/") &&
				!f.includes("/dist/") &&
				!f.endsWith(".d.ts"),
		)
		.sort();
}

/** Each import that crosses a boundary, named by file and specifier. */
export function boundaryProblems(
	root: string,
	boundaries: readonly Boundary[],
): string[] {
	return boundaries.flatMap((b) =>
		walk(root, b.from).flatMap((f) => {
			const text = readFileSync(join(root, f), "utf8");
			return Array.from(text.matchAll(SPECIFIER), (m) => m[1] ?? "")
				.filter((s) => b.deny.some((d) => s === d || s.startsWith(`${d}/`)))
				.map((s) => `[workspace/boundary] ${f} imports ${s}. Fix: ${b.why}`);
		}),
	);
}

/** One view over every host's manifest, for the read commands; a kind declared by two hosts is a problem. */
export function mergeManifests(manifests: readonly Manifest[]): {
	manifest: Manifest;
	problems: string[];
} {
	const problems: string[] = [];
	const kinds: Record<string, Manifest["kinds"][string]> = {};
	const entries: Record<string, Manifest["entries"][string]> = {};
	const uses: Record<string, Manifest["uses"][string]> = {};
	for (const m of manifests) {
		for (const [k, v] of Object.entries(m.kinds)) {
			if (kinds[k])
				problems.push(
					`[workspace/kinds] kind "${k}" is declared by ${kinds[k].file} and ${v.file}. Fix: rename one; a kind belongs to one host.`,
				);
			kinds[k] = v;
		}
		Object.assign(entries, m.entries);
		Object.assign(uses, m.uses);
	}
	const first = manifests[0];
	return {
		manifest: {
			...(first ?? { version: 1, gallery: [] }),
			version: 1,
			kinds,
			entries,
			uses,
			gallery: manifests.flatMap((m) => m.gallery),
			closed: Object.assign({}, ...manifests.map((m) => m.closed ?? {})),
			objects: manifests.flatMap((m) => m.objects ?? []),
			forbidden: manifests.flatMap((m) => m.forbidden ?? []),
			cases: manifests.flatMap((m) => m.cases ?? []),
		},
		problems,
	};
}

/** Generates every host, then the checks that span hosts. */
export function generateWorkspace(
	ws: Workspace,
	opts: { writeLedger?: boolean } = {},
): { manifest: Manifest; problems: string[] } {
	const runs = ws.hosts.map((h) => generate(h, opts));
	const merged = mergeManifests(runs.map((r) => r.manifest));
	return {
		manifest: merged.manifest,
		problems: [
			...runs.flatMap((r) => r.problems),
			...merged.problems,
			...boundaryProblems(ws.root, ws.boundaries),
		],
	};
}
