// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

export function tarballVersion(tgz: string): string;

/** The mirror and launchers for `releases`, built from the app tarball `tgz`. */
export function prepareLauncher(options: {
	tgz: string;
	work: string;
	releases: { version: string; launcher?: boolean; app?: string }[];
}): {
	root: string;
	baseUrl: string;
	launchers: Record<string, string>;
	archives: Record<string, string>;
};
