#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// The control process `pnpm sim up` leaves running (#1101): serves the sheet on loopback with
// a button per trigger, and fires each scheduled trigger once, so nobody types a command.
//   node scripts/sim/control.mjs <sim>/sheet.json   (SIM_CONTROL_PORT, PRISMALENS_SIM_DIR)
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { fireAtS, renderHtml, runLine } from "./lib.mjs";

const sheet = JSON.parse(readFileSync(process.argv[2] ?? "", "utf8"));
const dir = process.env.PRISMALENS_SIM_DIR ?? ".";
/** @type {Record<string, string>} */
const fired = {};

function fire(/** @type {string} */ id) {
	const row = sheet.rows.find((/** @type {{ id: string }} */ r) => r.id === id);
	if (!row?.trigger) return `no trigger for ${id}`;
	const r = runLine(
		row.trigger.run.replaceAll("{url}", sheet.url),
		process.env,
		join(dir, "logs", `trigger-${id}.log`),
	);
	fired[id] =
		`${new Date().toISOString()}: ${r.ok ? "fired" : "failed"} in ${Math.round(r.ms / 1000)} s`;
	return fired[id];
}

for (const row of sheet.rows)
	if (row.trigger?.on === "schedule")
		setTimeout(() => fire(row.id), fireAtS(row.trigger) * 1000);

createServer((req, res) => {
	const m = req.url?.match(/^\/fire\/([^/?]+)/);
	if (req.method === "POST" && m) {
		fire(decodeURIComponent(m[1] ?? ""));
		res.writeHead(303, { location: "/" }).end();
		return;
	}
	res
		.writeHead(200, { "content-type": "text/html; charset=utf-8" })
		.end(renderHtml(sheet, fired));
}).listen(Number(process.env.SIM_CONTROL_PORT), "127.0.0.1");
