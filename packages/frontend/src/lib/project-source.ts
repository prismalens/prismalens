// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type {
	BrowseFoldersResult,
	FolderEntry,
	ProjectKind,
} from "@prismalens/contracts";
import { Folder, FolderGit2, Globe, type LucideIcon } from "lucide-react";

/** The server's own test is `classifySource`; this only picks what the dialog shows. */
const URL_LIKE = /^(https?:\/\/|ssh:\/\/|git:\/\/|[\w.-]+@[\w.-]+:)/;

export const isGitUrl = (s: string) => URL_LIKE.test(s.trim());

export const KIND_WORD: Record<ProjectKind, string> = {
	folder: "Folder",
	repo: "Repo",
	remote: "Remote repo",
};
export const KIND_ICON: Record<ProjectKind, LucideIcon> = {
	folder: Folder,
	repo: FolderGit2,
	remote: Globe,
};

/** A typed path as the folder to list and the start of the name being typed in it. */
export function splitTyped(typed: string): {
	dir: string | null;
	prefix: string;
} {
	const t = typed.trim();
	if (!t) return { dir: null, prefix: "" };
	const cut = Math.max(t.lastIndexOf("/"), t.lastIndexOf("\\"));
	if (cut < 0) return { dir: t, prefix: "" };
	return { dir: t.slice(0, cut + 1), prefix: t.slice(cut + 1) };
}

/** The entries to show: hidden ones only when asked, and those starting with what was typed. */
export function shownEntries(
	entries: FolderEntry[],
	prefix: string,
	hidden: boolean,
): FolderEntry[] {
	const p = prefix.toLowerCase();
	return entries.filter(
		(e) =>
			(hidden || !e.hidden || p.startsWith(".")) &&
			e.name.toLowerCase().startsWith(p),
	);
}

/** What the typed source would add as, or null before there is anything to tell. */
export function typedKind(
	typed: string,
	listing: BrowseFoldersResult | undefined,
	prefix: string,
): ProjectKind | null {
	if (isGitUrl(typed)) return "remote";
	if (!listing?.ok || !typed.trim()) return null;
	if (!prefix) return listing.git ? "repo" : "folder";
	const exact = listing.entries.find((e) => e.name === prefix);
	if (!exact) return null;
	return exact.git || listing.git ? "repo" : "folder";
}

export const BROWSE_ERROR: Record<
	Extract<BrowseFoldersResult, { ok: false }>["error"],
	string
> = {
	denied: "No access here",
	missing: "No such folder",
	timeout: "Took too long",
	"not-folder": "Not a folder",
	"not-absolute": "Type a full path",
};

const RECENT_KEY = "pl.recentProjects";
const RECENT_MAX = 5;

export function recentSources(): string[] {
	try {
		const v: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
		return Array.isArray(v)
			? v.filter((s): s is string => typeof s === "string").slice(0, RECENT_MAX)
			: [];
	} catch {
		return [];
	}
}

export function rememberSource(source: string): void {
	try {
		const next = [source, ...recentSources().filter((s) => s !== source)];
		localStorage.setItem(RECENT_KEY, JSON.stringify(next.slice(0, RECENT_MAX)));
	} catch {}
}

/** A trailing separator is for listing; the source saved is the folder itself. */
export function sourceOf(typed: string): string {
	const t = typed.trim();
	return /^[A-Za-z]:[\\/]$|^\/$/.test(t) ? t : t.replace(/[\\/]+$/, "");
}
