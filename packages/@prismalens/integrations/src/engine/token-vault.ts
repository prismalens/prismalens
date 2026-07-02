/**
 * AES-256-GCM credential encryption vault.
 * Outputs Buffer (for Prisma Bytes) instead of base64 strings.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32;

export class TokenVault {
	private readonly key: Buffer;

	constructor(key: Buffer) {
		if (key.length !== KEY_LENGTH) {
			throw new Error(`Encryption key must be ${KEY_LENGTH} bytes`);
		}
		this.key = key;
	}

	static fromHex(hexKey: string): TokenVault {
		if (hexKey.length !== 64) {
			throw new Error("Hex key must be 64 characters (32 bytes)");
		}
		return new TokenVault(Buffer.from(hexKey, "hex"));
	}

	encrypt(plaintext: string): Buffer {
		const iv = randomBytes(IV_LENGTH);
		const cipher = createCipheriv("aes-256-gcm", this.key, iv, {
			authTagLength: AUTH_TAG_LENGTH,
		});
		const encrypted = Buffer.concat([
			cipher.update(plaintext, "utf8"),
			cipher.final(),
		]);
		const authTag = cipher.getAuthTag();
		return Buffer.concat([iv, authTag, encrypted]);
	}

	decrypt(data: Buffer): string {
		const iv = data.subarray(0, IV_LENGTH);
		const authTag = data.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
		const ciphertext = data.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
		const decipher = createDecipheriv("aes-256-gcm", this.key, iv, {
			authTagLength: AUTH_TAG_LENGTH,
		});
		decipher.setAuthTag(authTag);
		return (
			decipher.update(ciphertext).toString("utf8") + decipher.final("utf8")
		);
	}

	encryptJSON<T>(data: T): Buffer {
		return this.encrypt(JSON.stringify(data));
	}

	decryptJSON<T = Record<string, unknown>>(data: Buffer): T {
		return JSON.parse(this.decrypt(data)) as T;
	}

	/**
	 * Mask sensitive credential values for API responses.
	 * Shows only first/last characters with asterisks in between.
	 */
	static mask(credentials: Record<string, unknown>): Record<string, unknown> {
		const sensitiveFields = [
			"apikey",
			"accesstoken",
			"refreshtoken",
			"token",
			"secret",
			"password",
			"clientsecret",
			"apitoken",
			"appkey",
		];

		const masked: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(credentials)) {
			if (
				typeof value === "string" &&
				sensitiveFields.some((f) => key.toLowerCase().includes(f))
			) {
				masked[key] = maskString(value);
			} else if (typeof value === "object" && value !== null) {
				masked[key] = TokenVault.mask(value as Record<string, unknown>);
			} else {
				masked[key] = value;
			}
		}
		return masked;
	}
}

function maskString(value: string): string {
	if (value.length <= 8) {
		return "*".repeat(value.length);
	}
	const visibleChars = 4;
	return (
		value.substring(0, visibleChars) +
		"*".repeat(Math.min(value.length - visibleChars * 2, 20)) +
		value.substring(value.length - visibleChars)
	);
}
