// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// A test that spends more than a share of its own timeout on the fast runner times out on a slower
// one (#1085). With VITEST_TIMEOUT_BUDGET set (e.g. 0.4), a test over that share fails the run.

/** Tests over `share` of their timeout, slowest share first. */
export function overBudget(results, share) {
	return results
		.filter((r) => r.state === "passed" && r.timeout > 0)
		.map((r) => ({ ...r, used: r.duration / r.timeout }))
		.filter((r) => r.used > share)
		.sort((a, b) => b.used - a.used);
}

export const budgetLine = (r) =>
	`${Math.round(r.duration)} ms of ${r.timeout} ms (${Math.round(r.used * 100)}%): ${r.file} > ${r.name}`;

export default class TimeoutBudgetReporter {
	/** Vitest hands a reporter its options; the share comes from the environment. */
	constructor() {
		this.share = Number(process.env.VITEST_TIMEOUT_BUDGET);
		this.results = [];
	}

	onTestCaseResult(testCase) {
		const { duration } = testCase.diagnostic() ?? {};
		this.results.push({
			file: testCase.module.relativeModuleId ?? testCase.module.moduleId,
			name: testCase.fullName,
			state: testCase.result().state,
			duration: duration ?? 0,
			timeout: testCase.options.timeout ?? 0,
		});
	}

	onTestRunEnd() {
		if (!(this.share > 0)) return;
		const over = overBudget(this.results, this.share);
		if (!over.length) return;
		console.error(
			`\n${over.length} test(s) used over ${Math.round(this.share * 100)}% of their timeout; a slower runner times them out. Make them faster, or give a measured timeout:`,
		);
		for (const r of over) console.error(`  ${budgetLine(r)}`);
		process.exitCode = 1;
	}
}
