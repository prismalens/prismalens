// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type { Plugin } from "vite";

/**
 * Rewrites `import { X } from "lucide-react"` to `lucide-react/icons/<file>` per icon. The
 * barrel imports every icon statically, so a first paint that imports one icon through it
 * gets every icon the app uses anywhere in its chunk (#1101 category 12).
 */
export function iconImports(): Plugin {
	let files: Map<string, string> | null = null;
	const iconFiles = () => {
		if (files) return files;
		const require = createRequire(import.meta.url);
		const pkg = require.resolve("lucide-react/package.json");
		const barrel = readFileSync(
			join(dirname(pkg), "dist/esm/lucide-react.mjs"),
			"utf8",
		);
		const found = new Map<string, string>();
		Array.from(
			barrel.matchAll(
				/export \{([^}]*)\} from '\.\/icons\/([a-z0-9-]+)\.mjs';/g,
			),
		).forEach((m) => {
			Array.from((m[1] ?? "").matchAll(/default as (\w+)/g)).forEach((n) => {
				found.set(n[1] as string, m[2] as string);
			});
		});
		files = found;
		return found;
	};
	return {
		name: "prismalens:icon-imports",
		enforce: "pre",
		transform(code, id) {
			if (
				!/[\\/]src[\\/][^?]*\.tsx?(\?.*)?$/.test(id) ||
				!code.includes("lucide-react")
			)
				return null;
			const map = iconFiles();
			const out = code.replace(
				/import\s+(type\s+)?\{([^}]*)\}\s+from\s+["']lucide-react["'];?/g,
				(whole, typeOnly: string | undefined, list: string) => {
					if (typeOnly) return whole;
					const kept: string[] = [];
					const direct: string[] = [];
					for (const raw of list.split(",")) {
						const spec = raw.trim();
						if (!spec) continue;
						const [name, local] = spec.split(/\s+as\s+/) as [string, string?];
						const file = !name.startsWith("type ") && map.get(name);
						if (file)
							direct.push(
								`import ${local ?? name} from "lucide-react/icons/${file}";`,
							);
						else kept.push(spec);
					}
					return [
						...(kept.length
							? [`import { ${kept.join(", ")} } from "lucide-react";`]
							: []),
						...direct,
					].join("\n");
				},
			);
			const reexported = out.replace(
				/export\s+\{([^}]*)\}\s+from\s+["']lucide-react["'];?/g,
				(whole, list: string) => {
					const lines: string[] = [];
					for (const raw of list.split(",")) {
						const spec = raw.trim();
						if (!spec) continue;
						const [name, as] = spec.split(/\s+as\s+/) as [string, string?];
						const file = map.get(name);
						if (!file) return whole;
						lines.push(
							`export { default as ${as ?? name} } from "lucide-react/icons/${file}";`,
						);
					}
					return lines.join("\n");
				},
			);
			return reexported === code ? null : { code: reexported, map: null };
		},
	};
}
