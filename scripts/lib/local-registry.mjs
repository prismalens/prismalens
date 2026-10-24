// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// A Verdaccio registry on loopback for the release gate's upgrade checks (#920): the candidate
// tarball is published to it, and with `proxy` every other version of `prismalens` still comes
// from npmjs, so a real older release can be upgraded to a build that is not on npm yet.
import { writeFileSync } from "node:fs";
import net from "node:net";
import { join } from "node:path";
import crossSpawn from "cross-spawn";
import { killTree } from "./gate-portable.mjs";

const WIN = process.platform === "win32";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function freePort() {
	return new Promise((resolve, reject) => {
		const s = net.createServer();
		s.on("error", reject);
		s.listen(0, "127.0.0.1", () => {
			const { port } = s.address();
			s.close(() => resolve(port));
		});
	});
}

/**
 * @param {{ dir: string, env: NodeJS.ProcessEnv, proxy?: boolean }} options
 * @returns {Promise<{ registry: string, npmrc: string, pid: number | undefined, stop: () => void }>}
 */
export async function startLocalRegistry({ dir, env, proxy = false }) {
	const port = await freePort();
	const registry = `http://127.0.0.1:${port}/`;
	const config = join(dir, "verdaccio.yaml");
	writeFileSync(
		config,
		`storage: ${join(dir, "storage").replaceAll("\\", "/")}
uplinks:
  npmjs:
    url: https://registry.npmjs.org/
packages:
  'prismalens':
    access: $all
    publish: $anonymous${proxy ? "\n    proxy: npmjs" : ""}
  '**':
    access: $all
    proxy: npmjs
log: { type: stdout, format: pretty, level: warn }
`,
	);
	const child = crossSpawn(
		"npx",
		["-y", "verdaccio@6", "--config", config, "--listen", `127.0.0.1:${port}`],
		{ detached: !WIN, stdio: "ignore", env, windowsHide: true },
	);
	let up = false;
	for (let i = 0; i < 120 && !up; i++) {
		up = await fetch(`${registry}-/ping`)
			.then((r) => r.ok)
			.catch(() => false);
		if (!up) await sleep(500);
	}
	if (!up) {
		killTree(child.pid, "SIGKILL");
		throw new Error("verdaccio did not answer /-/ping");
	}
	const npmrc = join(dir, "npmrc");
	writeFileSync(
		npmrc,
		`registry=${registry}\n//127.0.0.1:${port}/:_authToken=gate-fake\n`,
	);
	return {
		registry,
		npmrc,
		pid: child.pid,
		stop: () => killTree(child.pid, "SIGKILL"),
	};
}
