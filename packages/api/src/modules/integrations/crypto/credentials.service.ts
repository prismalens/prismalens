import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

/**
 * Service for encrypting and decrypting integration credentials.
 *
 * Uses AES-256-GCM encryption with:
 * - Master key from PRISMALENS_ENCRYPTION_KEY env var (64 hex chars = 32 bytes)
 * - Random 12-byte IV per encryption operation
 * - 16-byte authentication tag for integrity verification
 *
 * Encrypted format: base64(iv:authTag:ciphertext)
 *
 * Following n8n-style credential management where OAuth credentials
 * are stored in the database (encrypted), not in environment variables.
 */
@Injectable()
export class CredentialsService implements OnModuleInit {
  private readonly logger = new Logger(CredentialsService.name);
  private encryptionKey: Buffer | null = null;

  private readonly ALGORITHM = 'aes-256-gcm';
  private readonly IV_LENGTH = 12; // GCM recommended IV length
  private readonly AUTH_TAG_LENGTH = 16;
  private readonly KEY_LENGTH = 32; // 256 bits

  constructor(private readonly configService: ConfigService) {}

  onModuleInit(): void {
    this.initializeEncryptionKey();
  }

  private initializeEncryptionKey(): void {
    const keyHex = this.configService.get<string>('PRISMALENS_ENCRYPTION_KEY');

    if (!keyHex) {
      this.logger.warn(
        'PRISMALENS_ENCRYPTION_KEY not set. Integration credentials will be stored in plaintext. ' +
          'Set a 64-character hex string for production use.',
      );
      return;
    }

    if (keyHex.length !== 64) {
      this.logger.error(
        `PRISMALENS_ENCRYPTION_KEY must be 64 hex characters (32 bytes). Got ${keyHex.length} characters.`,
      );
      return;
    }

    try {
      this.encryptionKey = Buffer.from(keyHex, 'hex');
      if (this.encryptionKey.length !== this.KEY_LENGTH) {
        throw new Error('Invalid key length after hex decode');
      }
      this.logger.log('Encryption key initialized successfully');
    } catch {
      this.logger.error('Failed to initialize encryption key: invalid hex string');
      this.encryptionKey = null;
    }
  }

  /**
   * Check if encryption is available.
   */
  isEncryptionEnabled(): boolean {
    return this.encryptionKey !== null;
  }

  /**
   * Encrypt a JSON-serializable value.
   * Returns base64-encoded string: iv:authTag:ciphertext
   *
   * @param data - Data to encrypt (will be JSON.stringify'd)
   * @returns Encrypted string, or JSON string if encryption not available
   */
  encrypt<T>(data: T): string {
    const jsonData = JSON.stringify(data);

    if (!this.encryptionKey) {
      this.logger.debug('Encryption disabled, storing as plaintext JSON');
      return jsonData;
    }

    try {
      const iv = randomBytes(this.IV_LENGTH);
      const cipher = createCipheriv(this.ALGORITHM, this.encryptionKey, iv, {
        authTagLength: this.AUTH_TAG_LENGTH,
      });

      const encrypted = Buffer.concat([
        cipher.update(jsonData, 'utf8'),
        cipher.final(),
      ]);
      const authTag = cipher.getAuthTag();

      // Format: base64(iv:authTag:ciphertext)
      const combined = Buffer.concat([iv, authTag, encrypted]);
      return combined.toString('base64');
    } catch (error) {
      this.logger.error('Encryption failed', error);
      throw new Error('Failed to encrypt credentials');
    }
  }

  /**
   * Decrypt an encrypted string back to its original value.
   *
   * @param encryptedData - Encrypted string from encrypt()
   * @returns Decrypted data
   */
  decrypt<T>(encryptedData: string): T {
    if (!this.encryptionKey) {
      // If encryption is disabled, data was stored as plain JSON
      try {
        return JSON.parse(encryptedData) as T;
      } catch {
        throw new Error('Failed to parse credentials: invalid JSON');
      }
    }

    try {
      const combined = Buffer.from(encryptedData, 'base64');

      // Extract components: iv (12 bytes) + authTag (16 bytes) + ciphertext (rest)
      const iv = combined.subarray(0, this.IV_LENGTH);
      const authTag = combined.subarray(
        this.IV_LENGTH,
        this.IV_LENGTH + this.AUTH_TAG_LENGTH,
      );
      const ciphertext = combined.subarray(this.IV_LENGTH + this.AUTH_TAG_LENGTH);

      const decipher = createDecipheriv(this.ALGORITHM, this.encryptionKey, iv, {
        authTagLength: this.AUTH_TAG_LENGTH,
      });
      decipher.setAuthTag(authTag);

      const decrypted = Buffer.concat([
        decipher.update(ciphertext),
        decipher.final(),
      ]);

      return JSON.parse(decrypted.toString('utf8')) as T;
    } catch (error) {
      this.logger.error('Decryption failed', error);
      throw new Error('Failed to decrypt credentials');
    }
  }

  /**
   * Mask sensitive credential values for API responses.
   * Shows only first/last characters with asterisks in between.
   *
   * @param credentials - Credential object to mask
   * @returns Masked credential object safe for API responses
   */
  mask(credentials: Record<string, unknown>): Record<string, unknown> {
    const masked: Record<string, unknown> = {};
    const sensitiveFields = [
      'apiKey',
      'accessToken',
      'refreshToken',
      'token',
      'secret',
      'password',
      'clientSecret',
    ];

    for (const [key, value] of Object.entries(credentials)) {
      if (typeof value === 'string' && sensitiveFields.some((f) => key.toLowerCase().includes(f.toLowerCase()))) {
        masked[key] = this.maskString(value);
      } else if (typeof value === 'object' && value !== null) {
        masked[key] = this.mask(value as Record<string, unknown>);
      } else {
        masked[key] = value;
      }
    }

    return masked;
  }

  private maskString(value: string): string {
    if (value.length <= 8) {
      return '*'.repeat(value.length);
    }
    const visibleChars = 4;
    return (
      value.substring(0, visibleChars) +
      '*'.repeat(Math.min(value.length - visibleChars * 2, 20)) +
      value.substring(value.length - visibleChars)
    );
  }

  /**
   * Generate a new encryption key (for setup/rotation).
   * Returns a 64-character hex string.
   */
  static generateKey(): string {
    return randomBytes(32).toString('hex');
  }
}
