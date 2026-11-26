// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/** The agent's config root from `env`; refused unless it is a `pl-*` folder under the OS temp folder. */
export function scratchRoot(harness: string, env: NodeJS.ProcessEnv): string;
/** Writes that stay in `root`, refusing a linked file or a path whose real location leaves it. */
export function homeFs(root: string): {
	mkdir(dir: string): void;
	write(path: string, text: string): void;
	append(path: string, text: string): void;
	merge(path: string, add: Record<string, unknown>): void;
};
/** The user-scope markers, in the agent's own scratch home from `env`. */
export function seedUser(
	harness: string,
	env: NodeJS.ProcessEnv,
	markers: string,
): void;
/** The project-scope markers, in the session's own folder. */
export function seedProject(
	harness: string,
	cwd: string,
	env: NodeJS.ProcessEnv,
	markers: string,
): void;
