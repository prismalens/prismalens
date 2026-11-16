// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { existsSync } from "node:fs";
import { lstat, readdir, statfs } from "node:fs/promises";
import { dirname, join } from "node:path";

/** What a folder holds on disk, links not followed; null when it can't be read. */
export async function folderBytes(dir: string): Promise<number | null> {
	let total = 0;
	const stack = [dir];
	try {
		while (stack.length) {
			const at = stack.pop() as string;
			const entries = await readdir(at, { withFileTypes: true });
			const sizes = await Promise.all(
				entries.map(async (e) => {
					const path = join(at, e.name);
					if (e.isDirectory()) {
						stack.push(path);
						return 0;
					}
					return e.isFile()
						? ((await lstat(path).catch(() => null))?.size ?? 0)
						: 0;
				}),
			);
			for (const s of sizes) total += s;
		}
	} catch {
		return total > 0 ? total : null;
	}
	return total;
}

/** Free space for the user on the disk that holds `dir`, or the nearest folder above it that exists. */
export async function freeBytesAt(dir: string): Promise<number | null> {
	let at = dir;
	while (!existsSync(at) && dirname(at) !== at) at = dirname(at);
	try {
		const s = await statfs(at);
		return s.bavail * s.bsize;
	} catch {
		return null;
	}
}
