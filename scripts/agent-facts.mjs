#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Each agent's registry facts against the pins CI installs (#1101).
 *
 *   agent-facts.mjs check [--built <checkout>]
 *     exit 1 naming each fact whose `verifiedAt` is not its row's pins: the pull request
 *     check "agent facts not re-verified"
 *   agent-facts.mjs sync [--built <checkout>] [--body <file>]
 *     the pin bump's sync step (MOVED names a JSON file of the moved pins): moves each touched
 *     row's probed versions to its pins, since the bump's probe passed on them, and appends to
 *     `--body` the source facts left to re-read and each moved package's cancel, session and
 *     sub-agent hunks
 */
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const AGENTS = join(
	ROOT,
	"packages/@prismalens/agent-host/src/registry/agents.ts",
);
const json = (path) => JSON.parse(readFileSync(join(ROOT, path), "utf8"));

/** Where each pinned package's source lives, for the hunks a bump lists; absent, no public source. */
export const SOURCES = {
	"@agentclientprotocol/claude-agent-acp": {
		repo: "agentclientprotocol/claude-agent-acp",
		tag: (v) => `v${v}`,
	},
	"@agentclientprotocol/codex-acp": {
		repo: "agentclientprotocol/codex-acp",
		tag: (v) => `v${v}`,
	},
	"opencode-ai": { repo: "anomalyco/opencode", tag: (v) => `v${v}` },
	"@google/gemini-cli": {
		repo: "google-gemini/gemini-cli",
		tag: (v) => `v${v}`,
	},
	"@openai/codex": { repo: "openai/codex", tag: (v) => `rust-v${v}` },
};

/** A changed line about one of these is what a source fact rests on. */
export const WATCHED = /cancel|abort|interrupt|session|sub-?agent/i;
const SKIPPED =
	/(^|\/)(tests?|__tests__|fixtures?)\/|\.(test|spec)\.[cm]?[jt]sx?$|\.snap$|lock\.(json|yaml)$|\.lock$/;
const BODY_BUDGET = 40_000;

const channelPackage = (channel) => channel.npm ?? channel.uv[0];

/** The versions a row's facts must name: its CLI pin, and its adapter's pin when it has one. */
export function pinnedAt(row, pins, adapters) {
	if (!row.facts || !row.channel) return null;
	const cli = pins[channelPackage(row.channel)];
	if (!cli) return null;
	return {
		cli,
		adapter: row.adapterPackage ? (adapters[row.adapterPackage] ?? null) : null,
	};
}

/** Each row's facts not checked on its pins: `[{ id, facts: ["name (via, checked on …)"] }]`. */
export function stale(registry, pins, adapters, staleFacts, via) {
	return Object.values(registry).flatMap((row) => {
		const at = pinnedAt(row, pins, adapters);
		const facts = at ? staleFacts(row.facts, at, via) : [];
		return facts.length ? [{ id: row.id, facts, defs: row.facts }] : [];
	});
}

/** The source with each listed row's `PROBED_AT` line moved to its versions, and the ids it moved. */
export function moveProbed(source, rows) {
	const moved = [];
	let out = source;
	for (const [id, at] of Object.entries(rows)) {
		const key = /^[a-z]+$/.test(id) ? id : `"${id}"`;
		const line = new RegExp(
			`^(\\t${key.replace(/[-"]/g, "\\$&")}: )\\{ cli: "[^"]*", adapter: (?:"[^"]*"|null) \\},$`,
			"m",
		);
		if (!line.test(out)) throw new Error(`no PROBED_AT line for the ${id} row`);
		const next = out.replace(
			line,
			`$1{ cli: "${at.cli}", adapter: ${at.adapter ? `"${at.adapter}"` : "null"} },`,
		);
		if (next !== out) moved.push(id);
		out = next;
	}
	return { source: out, moved };
}

/** The hunks of a unified diff whose added or removed lines match `watched`. */
export function hunks(patch, watched = WATCHED) {
	return patch
		.split(/^(?=@@ )/m)
		.filter((h) => h.startsWith("@@ "))
		.filter((h) =>
			h
				.split("\n")
				.slice(1)
				.some((l) => /^[+-]/.test(l) && watched.test(l)),
		)
		.map((h) => h.trimEnd());
}

/** One moved package's watched hunks as Markdown, from a compare's `files`. */
export function diffSection(pkg, from, to, files, url) {
	const head = `#### \`${pkg}\` ${from} → ${to}: hunks touching cancel, session or sub-agent code`;
	if (!files)
		return `${head}\n\nNo public source to diff; read its release notes.`;
	const shown = files
		.filter((f) => f.patch && !SKIPPED.test(f.filename))
		.map((f) => ({ name: f.filename, hunks: hunks(f.patch) }))
		.filter((f) => f.hunks.length);
	const list = shown.map(
		(f) =>
			`<details><summary><code>${f.name}</code>: ${f.hunks.length} hunk${f.hunks.length === 1 ? "" : "s"}</summary>\n\n\`\`\`diff\n${f.hunks
				.map((h) => h.split("\n").slice(0, 60).join("\n"))
				.join("\n")}\n\`\`\`\n</details>`,
	);
	const capped =
		files.length >= 300
			? " GitHub lists 300 files at most; the rest are left out."
			: "";
	return [
		head,
		"",
		`${shown.length} of ${files.length} changed files match.${capped} Full diff: ${url}`,
		"",
		...list,
	].join("\n");
}

async function compare(repo, a, b) {
	const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;
	const res = await fetch(
		`https://api.github.com/repos/${repo}/compare/${a}...${b}`,
		{
			headers: {
				Accept: "application/vnd.github+json",
				"User-Agent": "agent-facts",
				...(token ? { Authorization: `Bearer ${token}` } : {}),
			},
		},
	);
	if (!res.ok)
		throw new Error(
			`GitHub compare ${repo} ${a}...${b} answered ${res.status}`,
		);
	return (await res.json()).files ?? [];
}

async function loadRegistry(checkout) {
	return import(
		pathToFileURL(
			join(checkout, "packages/@prismalens/config/dist/providers/harness.js"),
		).href
	);
}

function staleLines(rows) {
	return rows.flatMap(({ id, facts, defs }) =>
		facts.map((f) => {
			const name = f.split(" ")[0];
			const at = defs?.[name]?.where;
			return `- ${id}: ${f}${at ? `, read in \`${at}\`` : ""}`;
		}),
	);
}

async function main() {
	const { positionals, values } = parseArgs({
		allowPositionals: true,
		options: { built: { type: "string" }, body: { type: "string" } },
	});
	const [command] = positionals;
	const pins = json("scripts/agent-pins.json").pins;
	const adapters = json(
		"packages/@prismalens/agent-adapters/package.json",
	).devDependencies;
	const { HARNESS_REGISTRY, staleFacts } = await loadRegistry(
		values.built ?? ROOT,
	);

	if (command === "check") {
		const rows = stale(HARNESS_REGISTRY, pins, adapters, staleFacts);
		if (!rows.length) {
			console.log("every agent fact names its row's pins");
			return;
		}
		console.log(
			"Facts checked on other versions than the pins; re-read each and move its verifiedAt:",
		);
		for (const line of staleLines(rows)) console.log(line);
		process.exit(1);
	}
	if (command !== "sync") {
		console.error(
			"usage: agent-facts.mjs check | sync [--built <checkout>] [--body <file>]",
		);
		process.exit(2);
	}
	const moves = process.env.MOVED
		? JSON.parse(readFileSync(process.env.MOVED, "utf8"))
		: [];
	const movedPackages = new Set(moves.map((m) => m.package));
	const touched = Object.fromEntries(
		Object.values(HARNESS_REGISTRY).flatMap((row) => {
			const at = pinnedAt(row, pins, adapters);
			const hit =
				row.channel &&
				(movedPackages.has(channelPackage(row.channel)) ||
					movedPackages.has(row.adapterPackage));
			return at && hit ? [[row.id, at]] : [];
		}),
	);
	const { source, moved } = moveProbed(readFileSync(AGENTS, "utf8"), touched);
	writeFileSync(AGENTS, source);
	console.log(
		moved.length
			? `probed facts moved on ${moved.join(", ")}`
			: "no probed facts to move",
	);
	if (!values.body) return;
	const left = stale(HARNESS_REGISTRY, pins, adapters, staleFacts, "source");
	const parts = [
		"",
		"### Agent facts to re-read",
		"",
		left.length
			? "The probe passed on the new pins, so their probed facts moved. These source-read facts still name the old versions, and the `agent facts not re-verified` check stays red until each is read again and its `verifiedAt` moved in this PR:"
			: "No source-read fact rests on a moved pin.",
		"",
		...staleLines(left),
	];
	for (const m of moves) {
		const src = SOURCES[m.package];
		let section;
		try {
			section = src
				? diffSection(
						m.package,
						m.current,
						m.version,
						await compare(src.repo, src.tag(m.current), src.tag(m.version)),
						`https://github.com/${src.repo}/compare/${src.tag(m.current)}...${src.tag(m.version)}`,
					)
				: diffSection(m.package, m.current, m.version, null);
		} catch (e) {
			section = `#### \`${m.package}\` ${m.current} → ${m.version}\n\nNo diff: ${e.message}.`;
		}
		parts.push("", section);
	}
	let text = `${parts.join("\n")}\n`;
	if (text.length > BODY_BUDGET)
		text = `${text.slice(0, BODY_BUDGET)}\n\n(cut at ${BODY_BUDGET} characters; open the compare links)\n`;
	appendFileSync(values.body, text);
	console.log(`appended ${text.length} characters to ${values.body}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
