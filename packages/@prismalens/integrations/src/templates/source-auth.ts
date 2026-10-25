// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/** The credential kinds a self-hosted HTTP query API takes (#848); mirrors contracts `SOURCE_CREDENTIAL_KINDS`. */
export const SOURCE_AUTH_KINDS = [
	"none",
	"bearer",
	"basic",
	"header",
	"mtls",
] as const;
