#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Replay one #336 fixture against a packed tarball and capture the run (#465).
 *
 * Clones the fixture's repo at its pinned commit, installs the tarball into a
 * clean prefix, boots `pl up` on an empty workspace, pairs, maps a service to
 * the clone, creates the fixture's incident by hand (symptom only) and
 * investigates it. Checks what can be checked without a human:
 *   - every path the report cites exists at the pinned commit;
 *   - a null incident (`nullIncident: true`) names no confirmed culprit.
 * Whether the culprit is plausible stays the operator's call: the capture's
 * `verdict.md` holds the question with the card beside the report.
 *
 * Usage: replay-fixture.mjs <fixture.json> <dir-with-tarball>
 * Env:   PRISMALENS_TARBALL   exact tarball path instead of the dir
 *        REPLAY_OUT           capture dir (default: a fresh mkdtemp, kept)
 *        REPLAY_PORT          default 3104
 *        REPLAY_HARNESS       harness to pin (default: auto)
 *        PRISMALENS_HARNESS_MODEL  model id set on that harness
 * Runs whatever harness is on PATH with its own sign-in; point HOME and the
 * agent's config dir somewhere disposable before running it unattended.
 */

import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
	createWriteStream,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { reportCitedPaths } from "./lib/cited-paths.mjs";

const PORT = process.env.REPLAY_PORT ?? "3104";
const BASE = `http://127.0.0.1:${PORT}`;
const RUN_TIMEOUT_MS = 20 * 60 * 1000;

const [fixturePath, tarballDir] = process.argv.slice(2);
if (!fixturePath) {
	console.error("usage: replay-fixture.mjs <fixture.json> <dir-with-tarball>");
	process.exit(2);
}
const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
const out = resolve(
	process.env.REPLAY_OUT ??
		mkdtempSync(join(tmpdir(), `replay-${fixture.name}-`)),
);
mkdirSync(out, { recursive: true });
const save = (name, value) =>
	writeFileSync(
		join(out, name),
		typeof value === "string"
			? value
			: `${JSON.stringify(value, null, "\t")}\n`,
	);

let child;
process.on("exit", () => child?.kill("SIGKILL"));

function findTarball() {
	if (process.env.PRISMALENS_TARBALL)
		return resolve(process.env.PRISMALENS_TARBALL);
	if (!tarballDir)
		throw new Error("no tarball: pass a dir or set PRISMALENS_TARBALL");
	const found = readdirSync(tarballDir).find((f) =>
		/^prismalens-[0-9].*\.tgz$/.test(f),
	);
	if (!found) throw new Error(`no prismalens-*.tgz in ${tarballDir}`);
	return resolve(tarballDir, found);
}

function run(cmd, args, opts = {}) {
	return execFileSync(cmd, args, { encoding: "utf8", ...opts });
}

/** A partial clone checked out at the pin: prometheus is too big for a full one. */
function clonePin(dir) {
	run("git", [
		"clone",
		"--quiet",
		"--filter=blob:none",
		"--no-checkout",
		fixture.upstream,
		dir,
	]);
	run("git", ["-C", dir, "checkout", "--quiet", fixture.commitInvestigated]);
	return run("git", ["-C", dir, "rev-parse", "HEAD"]).trim();
}

async function pollUntil(read, done, timeoutMs, everyMs = 2000) {
	const start = Date.now();
	for (;;) {
		const value = await read();
		if (done(value)) return value;
		if (Date.now() - start >= timeoutMs) return undefined;
		await new Promise((r) => setTimeout(r, everyMs));
	}
}

async function main() {
	const tgz = findTarball();
	const sha256 = createHash("sha256").update(readFileSync(tgz)).digest("hex");
	save("tarball.json", { file: basename(tgz), sha256 });

	const repo = join(out, "repo");
	const head = clonePin(repo);
	if (head !== fixture.commitInvestigated) {
		throw new Error(
			`clone is at ${head}, fixture pins ${fixture.commitInvestigated}`,
		);
	}
	save("pin.json", {
		upstream: fixture.upstream,
		commitInvestigated: head,
		fixCommit: fixture.fixCommit,
		os: run("uname", ["-srm"]).trim(),
		date: new Date().toISOString(),
	});

	const prefix = join(out, "install");
	const workspace = join(out, "workspace");
	mkdirSync(workspace, { recursive: true });
	run(
		"npm",
		[
			"install",
			"--prefix",
			prefix,
			"--no-audit",
			"--no-fund",
			"--loglevel=error",
			tgz,
		],
		{
			stdio: "inherit",
		},
	);
	const bin = join(prefix, "node_modules", ".bin", "pl");
	save(
		"doctor.txt",
		run(bin, ["doctor"], {
			env: { ...process.env, PRISMALENS_WORKSPACE_DIR: workspace },
		}),
	);

	let bootLog = "";
	const log = createWriteStream(join(out, "pl-up.log"));
	child = spawn(bin, ["up", "--no-open"], {
		stdio: ["ignore", "pipe", "pipe"],
		env: {
			...process.env,
			PRISMALENS_WORKSPACE_DIR: workspace,
			PRISMALENS_LOG_CONSOLE: "verbose",
			PRISMALENS_HOST: "127.0.0.1",
			PRISMALENS_PORT: PORT,
			...(process.env.REPLAY_HARNESS
				? { PRISMALENS_HARNESS: process.env.REPLAY_HARNESS }
				: {}),
		},
	});
	for (const s of [child.stdout, child.stderr]) {
		s.on("data", (d) => {
			bootLog += d;
			log.write(d);
		});
	}
	const ready = await pollUntil(
		() => /PrismaLens API running/.test(bootLog),
		Boolean,
		120_000,
		300,
	);
	if (!ready)
		throw new Error(`pl up not ready in 120s:\n${bootLog.slice(-3000)}`);

	const pairOut = run(bin, ["pair", "--workspace", workspace]);
	const pairToken = pairOut.match(/\/pair#([^\s#]+)/)?.[1] ?? "";
	let cookie = "";
	const api = async (path, init = {}) => {
		const res = await fetch(BASE + path, {
			signal: AbortSignal.timeout(15_000),
			...init,
			headers: {
				"content-type": "application/json",
				origin: BASE,
				cookie,
				...(init.headers ?? {}),
			},
		});
		const body = await res.json().catch(() => null);
		if (!res.ok)
			throw new Error(
				`${init.method ?? "GET"} ${path}: ${res.status} ${JSON.stringify(body)?.slice(0, 300)}`,
			);
		return { res, body };
	};
	const redeemed = await api("/api/pairing/redeem", {
		method: "POST",
		body: JSON.stringify({ token: pairToken, name: "replay" }),
	});
	cookie =
		(redeemed.res.headers.getSetCookie?.() ?? [])
			.find((c) => c.startsWith("prismalens.device="))
			?.split(";")[0] ?? "";
	if (!cookie) throw new Error("pairing returned no device cookie");

	const model = process.env.PRISMALENS_HARNESS_MODEL;
	if (model) {
		await api("/api/settings/harness", {
			method: "PATCH",
			body: JSON.stringify({
				harness: process.env.REPLAY_HARNESS ?? "auto",
				model,
			}),
		});
	}
	const { body: service } = await api("/api/services", {
		method: "POST",
		body: JSON.stringify({ name: fixture.name }),
	});
	await api("/api/repositories/source", {
		method: "POST",
		body: JSON.stringify({ serviceId: service.id, source: repo }),
	});
	const { body: incident } = await api("/api/incidents", {
		method: "POST",
		body: JSON.stringify({ ...fixture.incident, serviceId: service.id }),
	});
	save("incident.json", { ...fixture.incident, incidentId: incident.id });
	const { body: started } = await api(
		`/api/incidents/${incident.id}/investigate`,
		{ method: "POST" },
	);

	const finished = await pollUntil(
		async () =>
			(await api(`/api/investigations/${started.investigationId}`)).body,
		(b) => b && !["pending", "running"].includes((b.investigation ?? b).status),
		RUN_TIMEOUT_MS,
	);
	const investigation = finished?.investigation ?? finished;
	save("investigation.json", investigation ?? { status: "timeout" });
	if (!investigation)
		throw new Error(
			`investigation did not finish in ${RUN_TIMEOUT_MS / 60000} min`,
		);
	save("fidelity.json", investigation.report?.fidelity ?? null);

	const failures = [];
	if (investigation.status !== "completed" || !investigation.report) {
		failures.push(
			`run ended ${investigation.status}: ${investigation.error ?? "no report"}`,
		);
	}
	const cited = [...reportCitedPaths(investigation.report)];
	const missing = cited.filter((p) => {
		try {
			run(
				"git",
				["-C", repo, "cat-file", "-e", `${head}:${p.replace(/^\/+/, "")}`],
				{ stdio: "ignore" },
			);
			return false;
		} catch {
			return true;
		}
	});
	if (cited.length === 0) failures.push("report cites no file");
	if (missing.length > 0)
		failures.push(`cited paths missing at ${head}: ${missing.join(", ")}`);
	const confirmed = (investigation.report?.hypotheses ?? []).filter(
		(h) => h.status === "confirmed",
	);
	if (fixture.nullIncident && confirmed.length > 0) {
		failures.push(
			`null incident, yet ${confirmed.length} confirmed hypothesis(es)`,
		);
	}
	const culpritCited = cited.filter((p) => fixture.culpritFiles.includes(p));
	save("checks.json", {
		cited,
		missing,
		culpritCited,
		confirmed: confirmed.length,
		failures,
	});
	save(
		"verdict.md",
		[
			`# ${fixture.name} — replay verdict`,
			"",
			`Card: ${fixture.source}. Culprit files: ${fixture.culpritFiles.join(", ")}.`,
			`Cited real files: ${missing.length === 0 && cited.length > 0 ? "PASS" : "FAIL"} (${cited.length} cited, ${culpritCited.length} in the culprit set).`,
			fixture.nullIncident
				? `No confident garbage: ${confirmed.length === 0 ? "PASS" : "FAIL"}.`
				: "No confident garbage: operator's call.",
			"Named a plausible culprit: operator's call. Top hypothesis:",
			"",
			`> ${investigation.report?.hypotheses?.[0]?.statement ?? "(none)"}`,
			"",
		].join("\n"),
	);

	console.log(`[replay] capture: ${out}`);
	if (failures.length > 0) throw new Error(failures.join("; "));
	console.log(
		`REPLAY OK ${fixture.name}: ${cited.length} cited, all at ${head.slice(0, 8)}`,
	);
}

main().then(
	() => process.exit(0),
	(error) => {
		console.error(`REPLAY FAIL ${fixture.name}: ${error?.message ?? error}`);
		process.exit(1);
	},
);
