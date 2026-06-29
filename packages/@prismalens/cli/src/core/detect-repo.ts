/**
 * Auto-detect the repository under investigation from a working directory's git
 * remote (salvaged from the retired pl orchestrator). Returns `owner/repo`, or
 * `undefined` if not a git repo, no `origin`, or the URL can't be parsed.
 *
 * Uses node:child_process directly (no tinyexec dependency).
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const REPO_PATTERN =
	/(?:github\.com|gitlab\.com|bitbucket\.org)[/:](.+?)(?:\.git)?$/;

export async function detectRepo(
	cwd: string = process.cwd(),
): Promise<string | undefined> {
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
