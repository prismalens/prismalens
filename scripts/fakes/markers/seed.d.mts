// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/** The env var naming `harness`'s config folder, which the markers go in. */
export function configVar(harness: string): string | undefined;
/** Every root folder `scratchEnv` points into the run's home. */
export function rootKeys(): string[];
/** `env` with every root in a scratch home made now, the agent's config folder copied in. */
export function scratchEnv(
	harness: string,
	env: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv;
/** The agent's config folder from `env`; refused unless it is inside a home `scratchEnv` made. */
export function scratchRoot(harness: string, env: NodeJS.ProcessEnv): string;
/** Writes that stay in `root`, refusing a linked file or a path whose real location leaves it. */
export function homeFs(
	root: string,
	o?: { between?: (path: string) => void },
): {
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
