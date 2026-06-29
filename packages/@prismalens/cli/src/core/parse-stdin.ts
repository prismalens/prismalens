/**
 * Read JSON from piped stdin (salvaged from the retired pl orchestrator). Used to
 * accept a webhook-shaped alert payload piped into `prismalens investigate`.
 *
 * Returns `undefined` if:
 *  - stdin is a TTY (interactive terminal, no pipe), or
 *  - the piped data is empty or not valid JSON.
 */
import consola from "consola";

export async function parseStdin(): Promise<
	Record<string, unknown> | undefined
> {
	if (process.stdin.isTTY) return undefined;

	const chunks: Buffer[] = [];
	for await (const chunk of process.stdin) {
		chunks.push(chunk as Buffer);
	}

	const raw = Buffer.concat(chunks).toString("utf-8").trim();
	if (!raw) return undefined;

	try {
		return JSON.parse(raw) as Record<string, unknown>;
	} catch {
		consola.warn("Invalid JSON on stdin, ignoring");
		return undefined;
	}
}
