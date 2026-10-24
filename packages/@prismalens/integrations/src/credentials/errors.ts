// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/** The stored sign-in no longer works; the connection reads `REFRESH_FAILED` (#848). */
export class SignInExpired extends Error {
	constructor() {
		super(
			"Sign-in expired. Sign in again in PrismaLens under Settings, Data sources.",
		);
		this.name = "SignInExpired";
	}
}
