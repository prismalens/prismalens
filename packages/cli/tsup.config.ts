// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { defineConfig } from "tsup";

/**
 * The CLI is the ONLY published package (issue #193): the first-party
 * `@prismalens/*` closure (engine, config, contracts) is bundled INTO this
 * tarball, so those three are devDependencies and their third-party runtime
 * deps are hoisted into this package's `dependencies`.
 *
 * `noExternal: [/^@prismalens\//]` inlines only first-party code; every other
 * import (the AI SDKs, the Claude Agent SDK, citty, …) stays external and is
 * resolved at runtime from the CLI's own `dependencies`.
 *
 * The command bodies in `src/cli/*` are listed as their own entries so the
 * bin's lazy `import(`../src/cli/${name}.js`)` resolves to a real emitted file
 * at `dist/src/cli/<name>.js`; code-splitting hoists the shared bundled engine
 * into common chunks instead of duplicating it per command.
 *
 * `removeNodeProtocol: false` — tsup's default rewrites `node:sqlite` to bare
 * `sqlite`, which is NOT a valid builtin specifier (the newer builtins only
 * resolve under the `node:` prefix). That silently tripped the engine's
 * "requires Node >= 22.13" fallback at runtime.
 */
export default defineConfig({
	entry: ["bin/prismalens.ts", "src/cli/*.ts", "!src/cli/*.test.ts"],
	format: ["esm"],
	target: "node22",
	platform: "node",
	splitting: true,
	clean: true,
	dts: false,
	sourcemap: false,
	removeNodeProtocol: false,
	noExternal: [/^@prismalens\//],
});
