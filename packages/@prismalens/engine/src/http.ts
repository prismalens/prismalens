// Shared fetch with exponential backoff on transient errors (429/5xx + network).
// Free-tier model endpoints frequently return 429/503 under load; a busy moment should
// not abort an investigation.

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const RETRYABLE = new Set([429, 500, 502, 503, 504]);

export async function fetchWithRetry(url: string, init: RequestInit, attempts = 4): Promise<Response> {
	for (let i = 0; ; i++) {
		try {
			const res = await fetch(url, init);
			if (RETRYABLE.has(res.status) && i < attempts - 1) {
				const wait = 500 * 2 ** i;
				console.warn(`[engine] ${res.status} transient — retrying in ${wait}ms`);
				await sleep(wait);
				continue;
			}
			return res;
		} catch (err) {
			if (i >= attempts - 1) throw err;
			const wait = 500 * 2 ** i;
			console.warn(`[engine] network error — retrying in ${wait}ms`);
			await sleep(wait);
		}
	}
}

/** Replace an API key wherever it appears in a string (defense for error bodies/logs). */
export function sanitize(s: string, key: string): string {
	return key ? s.split(key).join("[REDACTED]") : s;
}
