// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Credential vault (AES-256-GCM) — the encryption core every stored integration
 * credential passes through (#253). Covers the round-trip, the envelope layout
 * (iv‖authTag‖ciphertext), nonce uniqueness, and every tamper/wrong-key path:
 * a corrupted envelope must FAIL LOUDLY, never decrypt to garbage.
 * Hermetic — no network, no DB, no filesystem.
 */
import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { TokenVault } from "./token-vault.js";

const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const HEADER_LENGTH = IV_LENGTH + AUTH_TAG_LENGTH;

const KEY_A = Buffer.alloc(32, 0xa1);
const KEY_B = Buffer.alloc(32, 0xb2);

function vault(key: Buffer = KEY_A): TokenVault {
	return new TokenVault(key);
}

/** Flip one bit in a copy of `buf` at `index`. */
function tamper(buf: Buffer, index: number): Buffer {
	const copy = Buffer.from(buf);
	copy[index] ^= 0x01;
	return copy;
}

describe("TokenVault construction", () => {
	it("accepts exactly a 32-byte key", () => {
		expect(() => new TokenVault(Buffer.alloc(32))).not.toThrow();
	});

	it("rejects a key that is not 32 bytes", () => {
		expect(() => new TokenVault(Buffer.alloc(16))).toThrow(
			"Encryption key must be 32 bytes",
		);
		expect(() => new TokenVault(Buffer.alloc(33))).toThrow(
			"Encryption key must be 32 bytes",
		);
		expect(() => new TokenVault(Buffer.alloc(0))).toThrow(
			"Encryption key must be 32 bytes",
		);
	});

	it("fromHex builds a vault from a 64-char hex key", () => {
		const hex = "a".repeat(64);
		const fromHex = TokenVault.fromHex(hex);
		const direct = new TokenVault(Buffer.from(hex, "hex"));
		// Both must decrypt each other's output — same key material.
		expect(direct.decrypt(fromHex.encrypt("shared-key"))).toBe("shared-key");
	});

	it("fromHex rejects a hex key of the wrong length", () => {
		expect(() => TokenVault.fromHex("a".repeat(63))).toThrow(
			"Hex key must be 64 characters (32 bytes)",
		);
		expect(() => TokenVault.fromHex("a".repeat(65))).toThrow(
			"Hex key must be 64 characters (32 bytes)",
		);
		expect(() => TokenVault.fromHex("")).toThrow(
			"Hex key must be 64 characters (32 bytes)",
		);
	});
});

describe("TokenVault encrypt/decrypt round-trip", () => {
	it("round-trips a secret (the #253 falsifier)", () => {
		const v = vault();
		const secret = "ghp_0123456789abcdefABCDEF_secret-token";
		expect(v.decrypt(v.encrypt(secret))).toBe(secret);
	});

	it("round-trips an empty string", () => {
		const v = vault();
		expect(v.decrypt(v.encrypt(""))).toBe("");
	});

	it("round-trips multibyte UTF-8 and long payloads", () => {
		const v = vault();
		const multibyte = "clé-🔐-パスワード-Ω";
		expect(v.decrypt(v.encrypt(multibyte))).toBe(multibyte);

		const long = randomBytes(64_000).toString("base64");
		expect(v.decrypt(v.encrypt(long))).toBe(long);
	});

	it("never emits the plaintext in the ciphertext", () => {
		const v = vault();
		const secret = "super-secret-value";
		expect(v.encrypt(secret).includes(Buffer.from(secret, "utf8"))).toBe(false);
	});

	it("uses the iv‖authTag‖ciphertext envelope", () => {
		const v = vault();
		const plaintext = "envelope-check";
		const envelope = v.encrypt(plaintext);
		expect(envelope).toBeInstanceOf(Buffer);
		expect(envelope.length).toBe(
			HEADER_LENGTH + Buffer.byteLength(plaintext, "utf8"),
		);
	});

	it("never reuses the IV across encryptions of the same plaintext", () => {
		const v = vault();
		const plaintext = "same-plaintext-every-time";
		const ivs = new Set<string>();
		const ciphertexts = new Set<string>();

		for (let i = 0; i < 200; i++) {
			const envelope = v.encrypt(plaintext);
			ivs.add(envelope.subarray(0, IV_LENGTH).toString("hex"));
			ciphertexts.add(envelope.subarray(HEADER_LENGTH).toString("hex"));
			expect(v.decrypt(envelope)).toBe(plaintext);
		}

		expect(ivs.size).toBe(200);
		expect(ciphertexts.size).toBe(200);
	});
});

describe("TokenVault rejects tampered or foreign envelopes", () => {
	it("fails to decrypt with the wrong key", () => {
		const envelope = vault(KEY_A).encrypt("cross-key");
		expect(() => vault(KEY_B).decrypt(envelope)).toThrow();
	});

	it("fails when the ciphertext is tampered with", () => {
		const v = vault();
		const envelope = v.encrypt("tamper-me-please");
		expect(() => v.decrypt(tamper(envelope, HEADER_LENGTH))).toThrow();
		expect(() => v.decrypt(tamper(envelope, envelope.length - 1))).toThrow();
	});

	it("fails when the auth tag is tampered with", () => {
		const v = vault();
		const envelope = v.encrypt("tamper-the-tag");
		expect(() => v.decrypt(tamper(envelope, IV_LENGTH))).toThrow();
		expect(() => v.decrypt(tamper(envelope, HEADER_LENGTH - 1))).toThrow();
	});

	it("fails when the IV is tampered with", () => {
		const v = vault();
		const envelope = v.encrypt("tamper-the-iv");
		expect(() => v.decrypt(tamper(envelope, 0))).toThrow();
		expect(() => v.decrypt(tamper(envelope, IV_LENGTH - 1))).toThrow();
	});

	it("fails when the ciphertext is truncated", () => {
		const v = vault();
		const envelope = v.encrypt("truncate-me-0123456789");
		expect(() => v.decrypt(envelope.subarray(0, envelope.length - 1))).toThrow();
	});

	it("rejects malformed envelopes rather than returning garbage", () => {
		const v = vault();
		// Too short to even hold iv + tag.
		expect(() => v.decrypt(Buffer.alloc(0))).toThrow();
		expect(() => v.decrypt(Buffer.alloc(5))).toThrow();
		expect(() => v.decrypt(Buffer.alloc(IV_LENGTH))).toThrow();
		expect(() => v.decrypt(Buffer.alloc(HEADER_LENGTH - 1))).toThrow();
		// Well-formed lengths, random content: the auth tag must not validate.
		expect(() => v.decrypt(randomBytes(HEADER_LENGTH))).toThrow();
		expect(() => v.decrypt(randomBytes(HEADER_LENGTH + 32))).toThrow();
	});

	it("does not accept an envelope whose payload was swapped in from another secret", () => {
		const v = vault();
		const a = v.encrypt("aaaa-secret-value-one");
		const b = v.encrypt("bbbb-secret-value-two");
		// Splice: a's iv+tag with b's ciphertext.
		const spliced = Buffer.concat([
			a.subarray(0, HEADER_LENGTH),
			b.subarray(HEADER_LENGTH),
		]);
		expect(() => v.decrypt(spliced)).toThrow();
	});
});

describe("TokenVault JSON helpers", () => {
	it("round-trips a credential object", () => {
		const v = vault();
		const credentials = {
			accessToken: "at_123",
			refreshToken: "rt_456",
			expiresIn: 3600,
			nested: { installationId: "42", scopes: ["repo", "read:org"] },
			nothing: null,
		};
		expect(v.decryptJSON(v.encryptJSON(credentials))).toEqual(credentials);
	});

	it("propagates the decryption failure for a tampered JSON envelope", () => {
		const v = vault();
		const envelope = v.encryptJSON({ accessToken: "at_123" });
		expect(() => v.decryptJSON(tamper(envelope, HEADER_LENGTH))).toThrow();
	});
});

describe("TokenVault.mask", () => {
	it("masks sensitive fields and leaves the rest intact", () => {
		const masked = TokenVault.mask({
			accessToken: "ghp_abcdefghijklmnopqrstuvwxyz",
			clientSecret: "cs_abcdefghijklmnop",
			baseUrl: "https://api.github.com",
			installationId: 42,
		});

		expect(masked.baseUrl).toBe("https://api.github.com");
		expect(masked.installationId).toBe(42);
		expect(masked.accessToken).not.toContain("efghijklmnopqrstuv");
		// 30 chars → first 4 + min(30-8, 20)=20 stars + last 4
		expect(masked.accessToken).toBe(`ghp_${"*".repeat(20)}wxyz`);
		// 19 chars → first 4 + min(19-8, 20)=11 stars + last 4
		expect(masked.clientSecret).toBe(`cs_a${"*".repeat(11)}mnop`);
	});

	it("fully masks short secrets so nothing leaks", () => {
		const masked = TokenVault.mask({ apiKey: "12345678", token: "" });
		expect(masked.apiKey).toBe("********");
		expect(masked.token).toBe("");
	});

	it("matches sensitive field names case-insensitively and as substrings", () => {
		const masked = TokenVault.mask({
			API_KEY: "abcdefghijklmnop",
			githubToken: "abcdefghijklmnop",
			userPassword: "abcdefghijklmnop",
		});
		for (const value of Object.values(masked)) {
			expect(value).toBe(`abcd${"*".repeat(8)}mnop`);
		}
	});

	it("recurses into nested credential objects", () => {
		const masked = TokenVault.mask({
			provider: "github",
			auth: { accessToken: "abcdefghijklmnop", scope: "repo" },
		}) as { provider: string; auth: Record<string, unknown> };

		expect(masked.provider).toBe("github");
		expect(masked.auth.scope).toBe("repo");
		expect(masked.auth.accessToken).toBe(`abcd${"*".repeat(8)}mnop`);
	});

	it("masks string elements of a sensitive array but leaves a non-sensitive one byte-identical", () => {
		const scopes = ["repo", "read:org"];
		const masked = TokenVault.mask({
			refresh_tokens: ["ghr_abcdefghijklmnop", "ghr_qrstuvwxyz012345"],
			scopes,
		}) as { refresh_tokens: string[]; scopes: string[] };

		// A sensitive key whose value is an array of raw tokens must not leak them.
		expect(masked.refresh_tokens).toEqual([
			`ghr_${"*".repeat(12)}mnop`,
			`ghr_${"*".repeat(12)}2345`,
		]);
		for (const token of masked.refresh_tokens) {
			expect(token).not.toContain("abcdefghijkl");
			expect(token).not.toContain("qrstuvwxyz01");
		}

		// ...and a non-sensitive array must come back untouched, so nobody
		// "fixes" the leak above by masking every array.
		expect(masked.scopes).toEqual(["repo", "read:org"]);
		expect(masked.scopes).not.toBe(scopes);
	});

	it("preserves array-valued fields instead of turning them into objects", () => {
		const masked = TokenVault.mask({
			scopes: ["repo", "read:org"],
			installations: [{ id: 1, accessToken: "abcdefghijklmnop" }],
		}) as { scopes: unknown; installations: Array<Record<string, unknown>> };

		expect(Array.isArray(masked.scopes)).toBe(true);
		expect(masked.scopes).toEqual(["repo", "read:org"]);
		expect(Array.isArray(masked.installations)).toBe(true);
		expect(masked.installations[0].id).toBe(1);
		expect(masked.installations[0].accessToken).toBe(
			`abcd${"*".repeat(8)}mnop`,
		);
	});
});
