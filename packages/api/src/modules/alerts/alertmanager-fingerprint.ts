// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

const FNV_OFFSET_64 = 14695981039346656037n;
const FNV_PRIME_64 = 1099511628211n;
const MASK_64 = 0xffffffffffffffffn;

/**
 * FNV-1a 64-bit hash over raw bytes.
 * Masked to 64 bits with BigInt arithmetic.
 */
export function fnv1a64Bytes(
	bytes: Uint8Array | number[] | Buffer,
	initialHash = FNV_OFFSET_64,
): bigint {
	let hash = initialHash;
	for (let i = 0; i < bytes.length; i++) {
		hash ^= BigInt(bytes[i]);
		hash = (hash * FNV_PRIME_64) & MASK_64;
	}
	return hash;
}

const SEPARATOR = new Uint8Array([0xff]);
const textEncoder = new TextEncoder();

/**
 * Alertmanager's label set fingerprint matching `prometheus/common/model.LabelSet.Fingerprint()`.
 * FNV-1a 64-bit over label names sorted bytewise, feeding for each:
 * name bytes, 0xff, value bytes, 0xff; rendered as 16 lowercase hex digits.
 */
export function alertmanagerFingerprint(
	labels: Record<string, string>,
): string {
	const names = Object.keys(labels).sort((a, b) => {
		const bufA = Buffer.from(a, "utf8");
		const bufB = Buffer.from(b, "utf8");
		return bufA.compare(bufB);
	});

	let hash = FNV_OFFSET_64;
	for (const name of names) {
		const val = labels[name];
		if (val === undefined) continue;
		hash = fnv1a64Bytes(textEncoder.encode(name), hash);
		hash = fnv1a64Bytes(SEPARATOR, hash);
		hash = fnv1a64Bytes(textEncoder.encode(val), hash);
		hash = fnv1a64Bytes(SEPARATOR, hash);
	}

	return hash.toString(16).padStart(16, "0");
}
