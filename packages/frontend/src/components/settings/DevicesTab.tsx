// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Settings, Devices (ADR 0004 §8, mock `settings-devices`): the phones and
 * computers paired with this instance, each by its name and its browser, a
 * way to rename or revoke one, and a way to pair another. Hidden to a paired
 * device: managing access is the host's.
 */

import type { PairedDevice } from "@prismalens/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { CopyButton } from "@/components/shared/CopyButton";
import { DestructiveConfirm } from "@/components/shared/DestructiveConfirm";
import { Mono } from "@/components/shared/Mono";
import { MutationError } from "@/components/shared/MutationError";
import { Pool } from "@/components/shared/Row";
import { SettingGroup, SettingRow } from "@/components/shared/SettingRow";
import { Empty, Loading, Problem } from "@/components/shared/State";
import { StateWord } from "@/components/shared/StateWord";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useOperator } from "@/hooks/use-operator";
import { orpc } from "@/lib/api/orpc-client";
import { guessDeviceName } from "@/lib/device-name";
import { formatClock, formatDate } from "@/lib/format-time";

export function useDevices(enabled = true) {
	return useQuery({
		...orpc.pairing.manage.listDevices.queryOptions({ input: {} }),
		enabled,
	});
}

/** "Chrome on Android. Paired Oct 2, last seen 17:07." */
export function deviceLine(d: PairedDevice, now: Date = new Date()): string {
	const client = d.userAgent ? guessDeviceName(d.userAgent, false) : undefined;
	const seen = d.lastSeenAt ? new Date(d.lastSeenAt) : null;
	const seenWord = !seen
		? null
		: now.getTime() - seen.getTime() < 60_000
			? "now"
			: seen.toDateString() === now.toDateString()
				? formatClock(seen)
				: formatDate(seen);
	const paired = `Paired ${formatDate(d.createdAt)}${seenWord ? `, last seen ${seenWord}` : ""}.`;
	return client ? `${client}. ${paired}` : paired;
}

export function DevicesTab() {
	const { managesPairing } = useOperator();
	const queryClient = useQueryClient();
	const devices = useDevices(managesPairing);
	const refresh = () =>
		queryClient.invalidateQueries({
			queryKey: orpc.pairing.manage.listDevices.queryKey({ input: {} }),
		});
	const [revoking, setRevoking] = useState<PairedDevice | null>(null);
	const revoke = useMutation({
		...orpc.pairing.manage.revokeDevice.mutationOptions(),
		onSuccess: async () => {
			const self = revoking?.current;
			setRevoking(null);
			await refresh();
			if (self) window.location.assign("/pair");
		},
	});

	if (!managesPairing) {
		return (
			<Empty text="Devices are managed from the machine running PrismaLens, not from a paired device." />
		);
	}

	return (
		<>
			<SettingGroup
				title="Paired"
				count={devices.data?.devices.length || undefined}
				testId="devices-list"
			>
				{devices.isPending && <Loading rows={2} />}
				{devices.isError && (
					<Problem
						text="The paired devices did not load."
						onRetry={() => devices.refetch()}
					/>
				)}
				{devices.data?.devices.length === 0 && (
					<Empty text="No device is paired. Only this machine can reach the instance." />
				)}
				{!!devices.data?.devices.length && (
					<Pool>
						{devices.data.devices.map((d) => (
							<DeviceRow
								key={d.id}
								device={d}
								onRevoke={() => setRevoking(d)}
								onRenamed={refresh}
							/>
						))}
					</Pool>
				)}
			</SettingGroup>

			<PairAnother />

			<DestructiveConfirm
				open={!!revoking}
				onOpenChange={(open) => {
					if (!open) {
						setRevoking(null);
						revoke.reset();
					}
				}}
				title={
					revoking?.current
						? "Revoke this browser?"
						: `Revoke ${revoking?.name}?`
				}
				description={
					revoking?.current ? (
						<p data-testid="revoke-self-warning">
							This browser loses access at once, until you run{" "}
							<code>pl pair --operator</code> on this machine and open the link
							it prints.
						</p>
					) : (
						<p>
							{revoking?.name} loses access at once. To use it again, pair it
							with a new link.
						</p>
					)
				}
				confirmLabel="Revoke"
				onConfirm={() => revoking && revoke.mutateAsync({ id: revoking.id })}
				isPending={revoke.isPending}
				error={revoke.error}
			/>
		</>
	);
}

function DeviceRow({
	device,
	onRevoke,
	onRenamed,
}: {
	device: PairedDevice;
	onRevoke: () => void;
	onRenamed: () => Promise<unknown>;
}) {
	const [editing, setEditing] = useState(false);
	const [name, setName] = useState(device.name);
	const rename = useMutation({
		...orpc.pairing.manage.renameDevice.mutationOptions(),
		onSuccess: async () => {
			await onRenamed();
			setEditing(false);
		},
	});
	return (
		<SettingRow
			testId="device-row"
			label={
				editing ? (
					<form
						className="flex min-w-0 items-center gap-2"
						onSubmit={(e) => {
							e.preventDefault();
							if (name.trim())
								rename.mutate({ id: device.id, name: name.trim() });
						}}
					>
						<Input
							aria-label="Device name"
							value={name}
							onChange={(e) => setName(e.target.value)}
							maxLength={80}
							autoFocus
							onKeyDown={(e) => {
								if (e.key === "Escape") {
									e.preventDefault();
									setName(device.name);
									setEditing(false);
								}
							}}
							data-testid="device-name-input"
						/>
						<Button
							type="submit"
							variant="secondary"
							disabled={rename.isPending}
						>
							Save
						</Button>
						<Button
							type="button"
							variant="text"
							onClick={() => {
								setName(device.name);
								setEditing(false);
							}}
						>
							Cancel
						</Button>
					</form>
				) : (
					<span className="flex min-w-0 items-baseline gap-2">
						<span className="truncate" data-testid="device-name">
							{device.name}
						</span>
						{device.current && (
							<StateWord tone="quiet" data-testid="device-current">
								this device
							</StateWord>
						)}
					</span>
				)
			}
			description={<span data-testid="device-line">{deviceLine(device)}</span>}
			below={
				rename.isError ? <MutationError error={rename.error} /> : undefined
			}
		>
			{!editing && (
				<>
					<Button
						variant="text"
						size="sm"
						onClick={() => setEditing(true)}
						data-testid="device-rename"
					>
						Rename
					</Button>
					<Button
						variant="danger"
						size="sm"
						onClick={onRevoke}
						data-testid="device-revoke"
					>
						Revoke
					</Button>
				</>
			)}
		</SettingRow>
	);
}

const LOOPBACK = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|$)/i;

function PairAnother() {
	const here = typeof window === "undefined" ? "" : window.location.origin;
	const [origin, setOrigin] = useState(here);
	const create = useMutation({
		...orpc.pairing.manage.createLink.mutationOptions(),
	});
	const loopback = LOOPBACK.test(here);

	return (
		<SettingGroup
			title="Pair another device"
			description={
				<>
					Or run <code>pl pair --tailscale</code> on the machine running
					PrismaLens.
				</>
			}
		>
			<Pool>
				<form
					onSubmit={(e) => {
						e.preventDefault();
						create.mutate({ origin: origin.trim() || undefined });
					}}
				>
					<SettingRow
						label="A pairing link"
						description="Works once, for 15 minutes"
						below={
							loopback ? (
								<div className="space-y-1.5">
									<label
										htmlFor="pair-origin"
										className="block text-meta text-text-3"
									>
										Address the other device can reach
									</label>
									<Input
										id="pair-origin"
										value={origin}
										onChange={(e) => setOrigin(e.target.value)}
										placeholder="https://box.tail1234.ts.net"
									/>
									<p className="min-h-4 text-meta text-text-3">
										{LOOPBACK.test(origin) &&
											"This address reaches only this machine. Use the tailnet address from pl up --tailscale-serve."}
									</p>
								</div>
							) : undefined
						}
					>
						<Button
							type="submit"
							variant="secondary"
							disabled={create.isPending}
							data-testid="device-create-link"
						>
							Create a link
						</Button>
					</SettingRow>
				</form>
				{create.data && (
					<SettingRow
						label="Open this on the other device"
						description={
							<Mono className="select-all" data-testid="device-link">
								{create.data.url}
							</Mono>
						}
					>
						<CopyButton value={create.data.url} />
					</SettingRow>
				)}
			</Pool>
			{create.isError && (
				<MutationError error={create.error} className="mt-2" />
			)}
		</SettingGroup>
	);
}
