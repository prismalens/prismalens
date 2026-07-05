// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * License Info schema — matches DB model (LicenseInfo table)
 * Stores license key, entitlements, quotas, and validation state.
 */
import { z } from "zod";
import {
	DateStringSchema,
	LicenseTierSchema,
	LicenseTypeSchema,
} from "./common.js";

export const LicenseInfoSchema = z.object({
	id: z.string().uuid(),
	licenseKey: z.string().nullable(),
	licenseType: LicenseTypeSchema,
	tier: LicenseTierSchema,
	validUntil: DateStringSchema.nullable(),
	activatedAt: DateStringSchema.nullable(),
	lastValidated: DateStringSchema.nullable(),
	features: z.array(z.string()),
	quotas: z.record(z.unknown()),
	billingCycle: z.string().nullable(),
	seats: z.number().int().nullable(),
	cloudInstanceId: z.string().nullable(),
	isCloudManaged: z.boolean(),
	customerEmail: z.string().email().nullable(),
	customerName: z.string().nullable(),
	metadata: z.record(z.unknown()),
	createdAt: DateStringSchema,
	updatedAt: DateStringSchema,
});

export type LicenseInfo = z.infer<typeof LicenseInfoSchema>;
