// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { McpServer } from "@modelcontextprotocol/server";
import { parse } from "yaml";
import { z } from "zod";

const run = promisify(execFile);

/** Characters of one runbook a tool result returns, as the other gateway tools cap theirs. */
export const RUNBOOK_CHARS = 32_000;
const GIT_BYTES = 4 * 1024 * 1024;

/** A repo bound to services, as the run recorded it: clone path and the commit it saw. */
export interface RunbookRepo {
	name: string;
	dir: string;
	head: string;
	subPath: string | null;
	services: string[];
}

export type RunbookMatch =
	| "runbooks/"
	| "docs/runbooks/"
	| "RUNBOOK*.md"
	| "catalog-info.yaml";

export interface RunbookEntry {
	title: string;
	/** `<repo>/<file>` for a file; the URL for a catalog-info link. */
	path: string;
	service: string;
	matchedBy: RunbookMatch;
	/** Present on a link, which is returned as written and never fetched. */
	link?: string;
}

/** What the tools read; the api answers from the run's recorded workspace. */
export interface RunbooksData {
	list(runId: string, service?: string): Promise<RunbookEntry[]>;
	read(runId: string, path: string, service: string): Promise<RunbookResult>;
}

export type RunbookResult =
	| { ok: true; path: string; markdown: string }
	| { ok: true; path: string; link: string }
	| { ok: false; error: string };

const SHA = /^[0-9a-f]{40,64}$/;
const MARKDOWN = /\.(md|markdown)$/i;

async function git(repo: RunbookRepo, args: string[]): Promise<string> {
	if (!SHA.test(repo.head)) throw new Error("the run recorded no commit");
	const { stdout } = await run("git", ["-C", repo.dir, ...args], {
		maxBuffer: GIT_BYTES,
		windowsHide: true,
	});
	return stdout;
}

function matchFile(file: string, prefix: string): RunbookMatch | null {
	if (!file.startsWith(prefix)) return null;
	const rel = file.slice(prefix.length);
	if (!MARKDOWN.test(rel)) return null;
	if (/^runbooks\/./i.test(rel)) return "runbooks/";
	if (/^docs\/runbooks\/./i.test(rel)) return "docs/runbooks/";
	if (/^RUNBOOK[^/]*$/i.test(rel)) return "RUNBOOK*.md";
	return null;
}

function titleOf(file: string): string {
	const base = file.split("/").pop() ?? file;
	return base.replace(MARKDOWN, "").replace(/[-_]+/g, " ").trim();
}

const CatalogLinks = z.object({
	metadata: z.object({
		links: z
			.array(
				z.object({
					url: z.string(),
					title: z.string().optional(),
					type: z.string().optional(),
				}),
			)
			.optional(),
	}),
});

/** Runbook links in a Backstage entity: `metadata.links` whose title or type names a runbook. Annotations are not read. */
export function catalogRunbookLinks(
	yamlText: string,
): { title: string; url: string }[] {
	const out: { title: string; url: string }[] = [];
	let docs: unknown[];
	try {
		docs = yamlText.split(/^---\s*$/m).map((d) => parse(d));
	} catch {
		return out;
	}
	for (const doc of docs) {
		const parsed = CatalogLinks.safeParse(doc);
		if (!parsed.success) continue;
		for (const l of parsed.data.metadata.links ?? []) {
			if (!/runbook|playbook/i.test(`${l.title ?? ""} ${l.type ?? ""}`))
				continue;
			if (!/^https?:\/\//i.test(l.url)) continue;
			out.push({ title: l.title ?? l.type ?? l.url, url: l.url });
		}
	}
	return out;
}

/** Runbooks in each repo at the commit the run saw, read through git so the workspace is never written. */
export async function listRunbooks(
	repos: RunbookRepo[],
	service?: string,
): Promise<RunbookEntry[]> {
	const out: RunbookEntry[] = [];
	for (const repo of repos) {
		if (service && !repo.services.includes(service)) continue;
		const svcs = service ? [service] : repo.services;
		const found: Omit<RunbookEntry, "service">[] = [];
		let files: string[];
		try {
			files = (
				await git(repo, ["ls-tree", "-r", "--name-only", "-z", repo.head])
			)
				.split("\0")
				.filter(Boolean);
		} catch {
			continue;
		}
		const prefix = repo.subPath ? `${repo.subPath.replace(/\/+$/, "")}/` : "";
		for (const file of files) {
			const matchedBy = matchFile(file, prefix) ?? matchFile(file, "");
			if (matchedBy)
				found.push({
					title: titleOf(file),
					path: `${repo.name}/${file}`,
					matchedBy,
				});
		}
		for (const catalog of new Set([
			`${prefix}catalog-info.yaml`,
			"catalog-info.yaml",
		])) {
			if (!files.includes(catalog)) continue;
			try {
				const text = await git(repo, ["show", `${repo.head}:${catalog}`]);
				for (const l of catalogRunbookLinks(text))
					found.push({
						title: l.title,
						path: l.url,
						matchedBy: "catalog-info.yaml",
						link: l.url,
					});
			} catch {
				// An unreadable catalog file only loses its links.
			}
		}
		for (const svc of svcs)
			for (const f of found) out.push({ ...f, service: svc });
	}
	return out;
}

/** Only a path the list returned is read: no traversal, no other file in the repo. */
export async function readRunbook(
	repos: RunbookRepo[],
	path: string,
	service: string,
): Promise<RunbookResult> {
	const entry = (await listRunbooks(repos, service)).find(
		(e) => e.path === path,
	);
	if (!entry)
		return {
			ok: false,
			error: `"${path}" is not a runbook runbooks_list returned for service "${service}"`,
		};
	if (entry.link) return { ok: true, path, link: entry.link };
	const repo = repos.find(
		(r) => path.startsWith(`${r.name}/`) && r.services.includes(service),
	) as RunbookRepo;
	const file = path.slice(repo.name.length + 1);
	let markdown = await git(repo, ["show", `${repo.head}:${file}`]);
	if (markdown.length > RUNBOOK_CHARS)
		markdown = `${markdown.slice(0, RUNBOOK_CHARS)}\n…[truncated at ${RUNBOOK_CHARS} characters]`;
	return { ok: true, path, markdown };
}

const json = (value: unknown, isError = false) => ({
	content: [{ type: "text" as const, text: JSON.stringify(value, null, 1) }],
	...(isError ? { isError: true } : {}),
});

/** The read-only runbook tools (#848): knowledge found in the repos bound to services. */
export function registerRunbookTools(
	server: McpServer,
	data: RunbooksData,
	runId: string,
): void {
	const annotations = { readOnlyHint: true, openWorldHint: false } as const;
	server.registerTool(
		"runbooks_list",
		{
			title: "Runbooks in the bound repos",
			description:
				"Runbooks found in the repositories bound to services, read at the commit this run saw: markdown under runbooks/ and docs/runbooks/, RUNBOOK*.md, and runbook links in catalog-info.yaml (links are returned as links, never fetched). Optionally for one service.",
			inputSchema: z.object({
				service: z.string().trim().min(1).max(200).optional(),
			}),
			annotations,
		},
		async ({ service }) => {
			const runbooks = await data.list(runId, service);
			return json(
				runbooks.length
					? { runbooks }
					: { status: "not-configured", runbooks: [] },
			);
		},
	);
	server.registerTool(
		"runbooks_read",
		{
			title: "Read a runbook",
			description: `The markdown of a runbook runbooks_list returned, cut at ${RUNBOOK_CHARS} characters. Pass its path and service exactly as listed.`,
			inputSchema: z.object({
				path: z.string().trim().min(1).max(1_000),
				service: z.string().trim().min(1).max(200),
			}),
			annotations,
		},
		async ({ path, service }) => {
			const r = await data.read(runId, path, service);
			return json(r, !r.ok);
		},
	);
}
