// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// Zod-free, so the shell reads these without loading a schema (#1130).

/** Severities, most urgent first. */
export const SEVERITIES = [
	"critical",
	"high",
	"medium",
	"low",
	"info",
] as const;

/** An alert's statuses, in the order a list shows them. */
export const ALERT_STATUSES = [
	"triggered",
	"acknowledged",
	"correlated",
	"resolved",
	"suppressed",
] as const;
