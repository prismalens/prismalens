// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Where a long identifier-like title may break: after `_ - . /` and before a
 * lower-to-upper case change ("AnomalyDetected" → "Anomaly" "Detected"). The
 * caller joins the parts with <wbr>; no layout JS.
 */
export function splitForWrap(text: string): string[] {
	return text.split(/(?<=[_\-./])|(?<=[a-z0-9])(?=[A-Z])/).filter(Boolean);
}
