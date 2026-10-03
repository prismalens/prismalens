// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import path from "node:path";

/** Build the default workspace path. */
export function defaultWorkspaceDir(
	home: string,
	env: NodeJS.ProcessEnv = process.env,
	pathImpl: { join: (...paths: string[]) => string } = path,
): string {
	return env.PRISMALENS_WORKSPACE_DIR ?? pathImpl.join(home, ".prismalens");
}
