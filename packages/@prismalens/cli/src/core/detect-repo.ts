/**
 * Resolve the repository label under investigation. Precedence: an explicit
 * config `repo` value (owner/name) wins; else git origin auto-detect from the
 * working directory; else `undefined`.
 *
 * Uses node:child_process directly (no tinyexec dependency).
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const REPO_PATTERN =
	/(?:github\.com|gitlab\.com|bitbucket\.org)[/:](.+?)(?:\.git)?$/;

async function detectRepo(cwd: string): Promise<string | undefined> {
	try {
		const { stdout } = await execFileAsync(
			"git",
			["remote", "get-url", "origin"],
			{ cwd },
		);
		return stdout.trim().match(REPO_PATTERN)?.[1];
	} catch {
		return undefined;
	}
}

/** Session repo label: an explicit config `repo` (owner/name) wins; else git
 * auto-detect from cwd; else none. */
export async function resolveRepoSlug(
	configRepo: string | undefined,
	cwd: string = process.cwd(),
): Promise<string | undefined> {
	return configRepo ?? (await detectRepo(cwd));
}
