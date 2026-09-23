// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * @prismalens/auth
 *
 * Device pairing for a single-operator instance (ADR 0004 §8). There is no
 * account: every browser pairs, the host's own through the startup link.
 */

export {
	ACCESS_SCOPE,
	authenticateDevice,
	buildPairingUrl,
	type CreatedPairingLink,
	createPairingLink,
	DEVICE_SCOPES,
	type DeviceRecord,
	type DeviceScope,
	generateToken,
	hashToken,
	OPERATOR_SCOPES,
	PAIRING_LINK_TTL_MS,
	PAIRING_PATH,
	PairingError,
	type PairingErrorReason,
	type PairingLinkRecord,
	type PairingStore,
	prismaPairingStore,
	type RedeemedDevice,
	redeemPairingLink,
	STARTUP_LINK_LABEL,
} from "./pairing.js";
export {
	createPairingLinkInWorkspace,
	createStartupLinkInWorkspace,
	WorkspaceError,
} from "./workspace.js";
