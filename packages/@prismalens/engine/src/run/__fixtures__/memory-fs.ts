// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { dirname, resolve } from "node:path";
import type { ConfigFs } from "../agent-config.js";

/** A `ConfigFs` over absolute path -> text; every parent of a file is a folder. */
export function memoryFs(files: Record<string, string>): ConfigFs {
	const byPath = new Map(
		Object.entries(files).map(([p, t]) => [resolve(p), t]),
	);
	const children = new Map<string, Set<string>>();
	for (const p of byPath.keys())
		for (
			let child = p, dir = dirname(p);
			dir !== child;
			child = dir, dir = dirname(dir)
		) {
			if (child !== p) {
				const set = children.get(dir) ?? new Set();
				set.add(child.slice(dir.length).replace(/^[\\/]/, ""));
				children.set(dir, set);
			} else if (!children.has(dir)) children.set(dir, new Set());
		}
	return {
		text: (p) => byPath.get(resolve(p)) ?? null,
		dirs: (p) => {
			const set = children.get(resolve(p));
			return set ? [...set] : null;
		},
	};
}
