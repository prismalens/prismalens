// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Plugin } from "vite";

export const NOTICES_FILE = "THIRD_PARTY_NOTICES.txt";

const NODE_MODULES = "/node_modules/";
const LICENSE_FILE = /^(licen[cs]e|copying)(\.|-|$)/i;

/** The package directory a bundled file came from, or undefined for first-party code. */
export function packageDirOf(path: string): string | undefined {
	const clean = path.replace(/\\/g, "/").replace(/^\0/, "").split("?")[0];
	const at = clean.lastIndexOf(NODE_MODULES);
	if (at === -1) return undefined;
	const parts = clean.slice(at + NODE_MODULES.length).split("/");
	const name = parts[0]?.startsWith("@") ? `${parts[0]}/${parts[1]}` : parts[0];
	return name ? clean.slice(0, at + NODE_MODULES.length) + name : undefined;
}

interface Notice {
	name: string;
	version: string;
	license: string;
	text: string;
}

function readNotice(dir: string): Notice {
	const manifest = JSON.parse(readFileSync(`${dir}/package.json`, "utf8"));
	const file = readdirSync(dir).find((f) => LICENSE_FILE.test(f));
	const license =
		typeof manifest.license === "string" ? manifest.license : "UNKNOWN";
	if (!file && license === "UNKNOWN") {
		throw new Error(`${dir} declares no licence and ships no licence file`);
	}
	return {
		name: manifest.name,
		version: manifest.version,
		license,
		text: file
			? readFileSync(`${dir}/${file}`, "utf8").trim()
			: `(The package ships no licence file; its package.json declares ${license}.)`,
	};
}

export function renderNotices(notices: Notice[]): string {
	const header = [
		"Third-party notices",
		"",
		"The PrismaLens web dashboard bundles the third-party software listed",
		"below. Each entry gives the package, its version, its licence and the",
		"licence text it ships with. Packages that npm installs next to PrismaLens",
		"carry their own licence files and are not listed here.",
	].join("\n");
	const entries = notices.map(
		(n) =>
			`${"=".repeat(72)}\n${n.name}@${n.version} (${n.license})\n\n${n.text}`,
	);
	return `${[header, ...entries].join("\n\n")}\n`;
}

/**
 * Lists what the client bundle actually contains, from the modules and assets
 * Vite emitted, so build-only packages never appear. Fonts pulled in by a CSS
 * `@import` are seen through their emitted font files.
 */
export function thirdPartyNotices(): Plugin {
	let root = process.cwd();
	return {
		name: "prismalens:third-party-notices",
		apply: "build",
		configResolved(config) {
			root = config.root;
		},
		generateBundle(_options, bundle) {
			if (this.environment.name !== "client") return;
			const dirs = new Set<string>();
			for (const output of Object.values(bundle)) {
				const sources =
					output.type === "chunk"
						? output.moduleIds
						: output.originalFileNames.map((f) => resolve(root, f));
				for (const source of sources) {
					const dir = packageDirOf(source);
					if (dir) dirs.add(dir);
				}
			}
			const notices = Array.from(dirs, readNotice).sort((a, b) =>
				a.name.localeCompare(b.name),
			);
			this.emitFile({
				type: "asset",
				fileName: NOTICES_FILE,
				source: renderNotices(notices),
			});
		},
	};
}
