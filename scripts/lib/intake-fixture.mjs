// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * A small git repo holding the one bug the packed-intake alert describes, so
 * the investigation has a bounded tree to read. The checkout is ~2000 files and
 * a free model reading it ran 3 to 15+ minutes before it wrote a report (#876).
 */
const FILES = {
	"package.json": JSON.stringify(
		{
			name: "alert-sink",
			private: true,
			type: "module",
			scripts: { start: "node src/server.js" },
		},
		null,
		2,
	),
	"README.md":
		"# alert-sink\n\nReceives Prometheus Alertmanager webhooks on POST /api/webhooks/prometheus.\nThe bearer token is read from the file named by TOKEN_FILE.\n",
	"src/server.js": `import { createServer } from "node:http";
import { handlePrometheus } from "./webhook.js";

createServer(async (req, res) => {
	if (req.method === "POST" && req.url === "/api/webhooks/prometheus") {
		return handlePrometheus(req, res);
	}
	res.writeHead(404).end();
}).listen(Number(process.env.PORT ?? 3000));
`,
	"src/webhook.js": `import { loadToken } from "./token.js";

export async function handlePrometheus(req, res) {
	try {
		const expected = loadToken();
		if (req.headers.authorization !== \`Bearer \${expected}\`) {
			return res.writeHead(401).end();
		}
		res.writeHead(202).end();
	} catch (err) {
		res.writeHead(500).end(String(err));
	}
}
`,
	"src/token.js": `import { readFileSync } from "node:fs";

export function loadToken() {
	const file = process.env.TOKEN_FILE;
	if (!file) throw new Error("TOKEN_FILE is not set");
	const token = readFileSync(file, "utf8").trim();
	if (token === "") throw new Error("token file is empty");
	return token;
}
`,
};

export function makeIntakeFixtureRepo(dir) {
	for (const [rel, body] of Object.entries(FILES)) {
		const abs = join(dir, rel);
		mkdirSync(join(abs, ".."), { recursive: true });
		writeFileSync(abs, body);
	}
	const git = (...args) =>
		execFileSync("git", args, { cwd: dir, stdio: "pipe" });
	git("init", "-q", "-b", "main");
	git("add", "-A");
	git(
		"-c",
		"user.name=fixture",
		"-c",
		"user.email=fixture@example.invalid",
		"commit",
		"-q",
		"-m",
		"alert-sink: webhook receiver",
	);
	return dir;
}
