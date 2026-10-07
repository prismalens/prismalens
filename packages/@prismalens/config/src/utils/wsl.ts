// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/** Running inside a WSL distro, by the variables WSL itself sets. */
export function isWsl(env: NodeJS.ProcessEnv = process.env): boolean {
	return Boolean(env.WSL_DISTRO_NAME || env.WSL_INTEROP);
}

/** A path on a mounted Windows drive (`/mnt/c/...`): under WSL, a Windows install. */
export function isWindowsMountPath(p: string): boolean {
	return /^\/mnt\/[a-zA-Z](\/|$)/.test(p);
}
