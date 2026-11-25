// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// What makes a `*.spec.ts` small (#1154): the clock is fake, and a child process, a socket or a real
// SQLite query throws instead of running. A test that needs one is a `*.int.spec.ts`.
import childProcess from "node:child_process";
import { realpathSync } from "node:fs";
import http from "node:http";
import { createRequire, syncBuiltinESMExports } from "node:module";
import net from "node:net";
import { join } from "node:path";
import tls from "node:tls";
import { fileURLToPath } from "node:url";
import { beforeEach, vi } from "vitest";

/** The date every small test starts on; the moved-clock CI leg proves no test reads another. */
const SMALL_TEST_NOW = new Date("2026-11-24T12:00:00.000Z");

const refuse = (what: string) => (): never => {
	throw new Error(
		`A small test (*.spec.ts) must not use ${what}. Mock it, or rename the file *.int.spec.ts.`,
	);
};

// Property assignment on the CommonJS exports, then a sync so `import { spawn }` sees it too.
// A test that mocks the module with vi.mock replaces all of this.
function block(target: object, names: string[], what: string) {
	for (const name of names)
		(target as Record<string, unknown>)[name] = refuse(`${what} (${name})`);
}
block(
	childProcess,
	[
		"spawn",
		"spawnSync",
		"exec",
		"execSync",
		"execFile",
		"execFileSync",
		"fork",
	],
	"a child process",
);
block(net, ["connect", "createConnection"], "the network");
block(net.Socket.prototype, ["connect"], "the network");
block(net.Server.prototype, ["listen"], "the network");
block(http.Agent.prototype, ["createConnection"], "the network");
block(tls, ["connect"], "the network");
syncBuiltinESMExports();

// The SQLite driver is a CommonJS dependency of the database package, so it is patched where that
// package resolves it; a database that is never queried costs nothing and is allowed.
const fromDatabase = createRequire(
	join(
		realpathSync(
			fileURLToPath(
				new URL("./node_modules/@prismalens/database", import.meta.url),
			),
		),
		"package.json",
	),
);
const fromAdapter = createRequire(
	fromDatabase.resolve("@prisma/adapter-better-sqlite3"),
);
const Database = fromAdapter("better-sqlite3") as { prototype: object };
block(
	Database.prototype,
	["prepare", "exec", "pragma", "transaction"],
	"a SQLite database",
);

// Installed at import too, so a beforeAll that reads the clock sees the fake one.
vi.useFakeTimers({ now: SMALL_TEST_NOW });
beforeEach(() => {
	vi.useFakeTimers({ now: SMALL_TEST_NOW });
});
