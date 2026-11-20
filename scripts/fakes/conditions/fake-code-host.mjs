#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// The fake code host's reply mode (#1101 category 15), read by api-preload.mjs on each post:
//   ok (default), no-scope (the token lacks the write scope), locked (the conversation is locked),
//   rerun-drop (a re-run is taken, then the connection drops), files-fail (files answer 503).
//   node scripts/fakes/conditions/fake-code-host.mjs mode no-scope | posts | reruns
import fs from "node:fs";
import { join } from "node:path";
import { stateDir } from "./lib.mjs";

const dir = stateDir("fake-code-host");
fs.mkdirSync(dir, { recursive: true });
const [cmd, value] = process.argv.slice(2);
const MODES = ["ok", "no-scope", "locked", "rerun-drop", "files-fail"];
if (cmd === "mode" && MODES.includes(value ?? "")) {
	fs.writeFileSync(join(dir, "mode"), String(value));
	console.log(`fake code host: ${value}`);
} else if (cmd === "posts" || cmd === "reruns") {
	const file = join(dir, cmd === "posts" ? "posts.jsonl" : "reruns.jsonl");
	const lines = fs.existsSync(file)
		? fs.readFileSync(file, "utf8").split("\n").filter(Boolean)
		: [];
	console.log(
		JSON.stringify(
			{ count: lines.length, posts: lines.map((l) => JSON.parse(l)) },
			null,
			2,
		),
	);
} else {
	console.log(
		`Usage: fake-code-host.mjs mode <${MODES.join("|")}> | posts | reruns`,
	);
	process.exitCode = 1;
}
