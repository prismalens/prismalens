// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The Part A refusal-gate assertion sequence, shared by `scripts/packed-smoke.sh`
 * and `scripts/cross-os-app-boot.mjs` (issue #551).
 *
 * Both scripts boot the packed `pl up` artifact and assert the same product
 * behaviour: on a machine with no runnable harness, POST
 * /api/incidents/:id/investigate is refused server-side with a 412 whose payload
 * matches the locally computed harness verdict, and no investigation child is
 * forked. That sequence was written out twice and drifted twice inside a single
 * PR (#531), so it lives here now and has one home.
 *
 * WHAT MAY NOT MOVE IN HERE. This module imports NOTHING, and must not — not
 * even @prismalens/config. Both CI jobs sparse-checkout only their own script
 * plus this file (.github/workflows/ci.yml, .github/workflows/cross-os-smoke.yml),
 * so neither caller's checkout has a node_modules a bare specifier could resolve
 * through. Each caller already has working, environment-specific code to reach
 * the INSTALLED package's own copy of the harness gate; the caller resolves the
 * verdict and passes it in. The assertion sequence over that verdict is the part
 * that is shared, and it is the only part that has ever been intended to match.
 *
 * THIS PATH IS NAMED IN THREE PLACES, and all three must keep naming it: both
 * jobs' `sparse-checkout` lists, and cross-os-smoke.yml's `on.pull_request.paths`
 * / `on.push.paths`. Drop it from a sparse list and the job fails loudly; drop it
 * from the paths triggers and the cross-OS jobs simply never run for a change to
 * this file, which is the failure that says nothing at all.
 */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * `InvestigationRun` is error-path-only; `InvestigationProcessor` is the
 * unconditional child-start context. Matching either is what makes "no child
 * forked" mean it, rather than meaning "the child did not happen to fail".
 */
const FORK_CONTEXT =
	/"context"\s*:\s*"(?:InvestigationRun|InvestigationProcessor)"/;

/**
 * @param {object} args
 * @param {(path: string, init?: object) => Promise<Response>} args.json
 *   Same-origin JSON fetch, already carrying the Origin header Better Auth wants.
 * @param {string} args.cookie Session cookie header value from sign-in.
 * @param {() => Promise<{ runnable: boolean, failure?: string, reason?: string }>} args.resolveExpected
 *   Returns the locally computed `resolveHarnessSelection({ provider: null,
 *   apiKey: "", model: null, harness: "auto" })` verdict, reached by the caller
 *   from the INSTALLED package. Called only once a refusal response is in hand,
 *   so a caller that reaches the harness gate lazily is not forced to load it on
 *   a path that never gets that far.
 * @param {() => string} args.readLog Full boot log as text.
 * @param {() => number} args.getLogOffset Current boot-log length in bytes.
 * @param {(name: string, detail?: string) => void} args.ok
 * @param {(name: string, detail: string) => void} args.bad
 * @param {string} args.incidentTitle Title for the throwaway probe incident.
 * @param {() => void} [args.sample] Called before each log read. The cross-OS
 *   caller drains a sampled buffer here; the packed caller has a file on disk and
 *   passes nothing.
 * @returns {Promise<{ partBLogOffset: number }>} Byte offset for Part B to read
 *   the log from, so Part B's diagnostics cannot match Part A's output.
 */
export async function assertRefusalGate({
	json,
	cookie,
	resolveExpected,
	readLog,
	getLogOffset,
	ok,
	bad,
	incidentTitle,
	sample = () => {},
}) {
	sample();
	if (!cookie) {
		bad("refusal", "no session — cannot trigger an investigation");
		return { partBLogOffset: 0 };
	}

	const created = await json("/api/incidents", {
		method: "POST",
		headers: { cookie },
		body: JSON.stringify({ title: incidentTitle, severity: "low" }),
	});
	const createdBody = await created.text();
	if (!created.ok) {
		bad(
			"POST /api/incidents (unconfigured)",
			`status ${created.status}: ${createdBody.slice(0, 200)}`,
		);
		return { partBLogOffset: 0 };
	}

	let incidentId = null;
	try {
		incidentId = JSON.parse(createdBody).id ?? null;
	} catch {
		incidentId = null;
	}
	if (!incidentId) {
		bad(
			"POST /api/incidents (unconfigured)",
			`2xx with no usable id in the body: ${createdBody.slice(0, 200)}`,
		);
		return { partBLogOffset: 0 };
	}

	const refused = await json(`/api/incidents/${incidentId}/investigate`, {
		method: "POST",
		headers: { cookie },
		body: "{}",
	});
	const refusedBody = await refused.text();
	let refusedJson = null;
	try {
		refusedJson = JSON.parse(refusedBody);
	} catch {
		refusedJson = null;
	}

	const expected = await resolveExpected();

	if (expected.runnable) {
		// Not a product failure: this machine can run an investigation, so the
		// refusal under test was never reachable. Say that, rather than reporting
		// the invented regressions it looks like from here.
		bad(
			"clean-machine refusal",
			"harness gate reports machine is runnable — clean-machine precondition failed (check PATH and credentials)",
		);
	} else if (
		refused.status === 412 &&
		refusedJson?.code === "PRECONDITION_FAILED" &&
		refusedJson?.data?.failure === expected.failure &&
		refusedJson?.data?.reason === expected.reason
	) {
		ok(
			"unrunnable investigation refused",
			`status 412, failure=${refusedJson.data.failure}`,
		);

		// Only meaningful once a refusal genuinely happened (#531 review): on a
		// clean-machine precondition failure, or an unexpected response shape,
		// nothing was refused, so a forked child there is not this regression.
		await sleep(2000);
		sample();
		if (FORK_CONTEXT.test(readLog())) {
			bad(
				"refusal fork gate",
				"investigation child forked despite 412 refusal",
			);
		} else {
			ok("no child forked on unrunnable investigation");
		}
	} else {
		bad(
			"POST /api/incidents/:id/investigate refusal",
			`status ${refused.status}: ${refusedBody.slice(0, 200)}`,
		);
	}

	return { partBLogOffset: getLogOffset() };
}
