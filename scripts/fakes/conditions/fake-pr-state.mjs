// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// The scriptable fake code host's PRs (#1179 §11.1): one JSON file per PR under
// `<state>/fake-code-host/prs/`, written by fake-code-host.mjs and served by api-preload.mjs.
// An item the CLI writes has no timestamp; the API stamps it with its own clock on first serve.
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import { join } from "node:path";
import { stateDir } from "./lib.mjs";

export const HOST_DIR = stateDir("fake-code-host");
export const PRS_DIR = join(HOST_DIR, "prs");

/** `acme/subs#7` -> its file. */
export function prFile(/** @type {string} */ ref) {
	const m = /^([^/\s]+)\/([^#\s]+)#(\d+)$/.exec(ref);
	if (!m) throw new Error(`Expected owner/repo#n, got ${ref}`);
	return {
		owner: m[1],
		repo: `${m[1]}/${m[2]}`,
		number: Number(m[3]),
		file: join(PRS_DIR, `${m[1]}__${m[2]}__${m[3]}.json`),
	};
}

/** @returns {any | null} */
export function loadPr(/** @type {string} */ file) {
	try {
		return JSON.parse(fs.readFileSync(file, "utf8"));
	} catch {
		return null;
	}
}

/** Written to a temp file and renamed, so the API never reads half a PR. */
export function savePr(/** @type {string} */ file, /** @type {any} */ pr) {
	fs.mkdirSync(PRS_DIR, { recursive: true });
	const tmp = `${file}.${process.pid}.${randomBytes(3).toString("hex")}.tmp`;
	fs.writeFileSync(tmp, JSON.stringify(pr, null, 1));
	fs.renameSync(tmp, file);
}

export const sha1 = (/** @type {string} */ s) =>
	createHash("sha1").update(s).digest("hex");

export const newSha = () => randomBytes(20).toString("hex");

/** A fresh PR: open, one head, nothing on it yet. */
export function initPr(
	/** @type {{ repo: string, number: number }} */ at,
	/** @type {{ head?: string, ref?: string }} */ opts,
) {
	return {
		repo: at.repo,
		number: at.number,
		title: `Change ${at.number}`,
		state: "open",
		draft: false,
		merged_at: null,
		conflicts: false,
		head: {
			sha: opts.head ?? newSha(),
			ref: opts.ref ?? `feat/pr-${at.number}`,
		},
		base: "main",
		nextId: 1000,
		comments: [],
		reviewComments: [],
		reviews: [],
		events: [],
		checkRuns: [],
		statuses: [],
		threads: [],
		pushes: [],
	};
}
