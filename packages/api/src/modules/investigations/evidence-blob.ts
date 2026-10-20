// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * A file a run read, out of the git objects of the source it cloned (the
 * local folder repo or the URL's bare mirror), at the commit it recorded.
 * Never a workspace: those are deleted when the run ends (#637 N3).
 */
import { existsSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import {
	CommitShaSchema,
	EVIDENCE_BLOB_MAX_BYTES,
	type EvidenceBlob,
	isSafeRepoPath,
	type RunWorkspace,
} from "@prismalens/contracts";
import { gitEnv } from "../../core/harness/git-env.js";
import {
	GIT_PROBE_TIMEOUT_MS,
	spawnGit,
} from "../../core/harness/git-spawn.js";
import { mirrorPathFor } from "../../core/harness/repo-source.service.js";

/** The request names something this run never recorded, or no path at all. */
export class EvidenceRequestRefused extends Error {}

const OID = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;
const READ_TIMEOUT_MS = 30_000;

/** Where a recorded repo's objects live now; null when that source is gone. */
export function objectDirFor(
	repo: RunWorkspace["repos"][number],
	mirrorRoot?: string,
): string | null {
	if (repo.sourceKind === "folder") {
		return isAbsolute(repo.url) && existsSync(repo.url) ? repo.url : null;
	}
	const mirror = mirrorPathFor(repo.url, mirrorRoot);
	return existsSync(join(mirror, "HEAD")) ? mirror : null;
}

function git(args: string[], cwd: string, timeoutMs = READ_TIMEOUT_MS) {
	return spawnGit(["--no-replace-objects", ...args], {
		cwd,
		timeoutMs,
		env: {
			...gitEnv({ source: "none" }),
			// A path is a name, never a glob: `*` in it matches only `*`.
			GIT_LITERAL_PATHSPECS: "1",
		},
	});
}

/**
 * `sha` must be a head this run recorded and `path` a tracked entry of that
 * commit's tree. Git resolves the path tree by tree and a symlink is a blob,
 * so nothing is ever followed out of the commit.
 */
export async function readEvidenceBlob(
	workspace: RunWorkspace | null,
	sha: string,
	path: string,
	opts: { mirrorRoot?: string } = {},
): Promise<EvidenceBlob> {
	if (!CommitShaSchema.safeParse(sha).success || !isSafeRepoPath(path))
		throw new EvidenceRequestRefused("Not a commit and path this run can read");
	const repo = workspace?.repos.find((r) => r.head === sha);
	if (!repo)
		throw new EvidenceRequestRefused("This run did not record that commit");
	const at = { repo: repo.name, sha, path };
	const dir = objectDirFor(repo, opts.mirrorRoot);
	if (!dir) return { state: "unavailable", ...at, reason: "source-removed" };
	try {
		await git(["rev-parse", "--git-dir"], dir, GIT_PROBE_TIMEOUT_MS);
	} catch {
		return { state: "unavailable", ...at, reason: "source-removed" };
	}
	try {
		await git(["cat-file", "-e", `${sha}^{commit}`], dir);
	} catch {
		return { state: "unavailable", ...at, reason: "commit-gone" };
	}
	const { stdout } = await git(
		["ls-tree", "-z", "--full-tree", sha, "--", path],
		dir,
	);
	const entry = stdout
		.split("\0")
		.map((line) => /^(\d{6}) (\w+) ([0-9a-f]+)\t([\s\S]*)$/.exec(line))
		.find((m) => m?.[4] === path);
	if (!entry) return { state: "unavailable", ...at, reason: "not-retained" };
	const [, mode, type, oid] = entry as unknown as [
		string,
		string,
		string,
		string,
	];
	if (type !== "blob" || !OID.test(oid))
		return { state: "unavailable", ...at, reason: "not-a-file" };
	const size = Number((await git(["cat-file", "-s", oid], dir)).stdout.trim());
	const kind = mode === "120000" ? "symlink" : "file";
	if (size > EVIDENCE_BLOB_MAX_BYTES)
		return {
			state: "ok",
			...at,
			kind,
			size,
			content: null,
			omitted: "too-large",
		};
	const { stdout: content } = await git(["cat-file", "blob", oid], dir);
	if (content.slice(0, 8000).includes("\0"))
		return { state: "ok", ...at, kind, size, content: null, omitted: "binary" };
	return { state: "ok", ...at, kind, size, content, omitted: null };
}
