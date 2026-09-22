// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * @prismalens/auth
 *
 * Device pairing for a single-operator instance (ADR 0004 §8). There is no
 * account: the host is the operator, other devices pair.
 */

export {
	authenticateDevice,
	buildPairingUrl,
	type CreatedPairingLink,
	createPairingLink,
	DEVICE_SCOPES,
	type DeviceRecord,
	type DeviceScope,
	generateToken,
	hashToken,
	PAIRING_LINK_TTL_MS,
	PAIRING_PATH,
	PairingError,
	type PairingErrorReason,
	type PairingLinkRecord,
	type PairingStore,
	prismaPairingStore,
	type RedeemedDevice,
	redeemPairingLink,
} from "./pairing.js";
export {
	createPairingLinkInWorkspace,
	WorkspaceError,
} from "./workspace.js";
