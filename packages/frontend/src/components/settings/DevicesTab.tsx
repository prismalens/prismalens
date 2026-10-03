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
import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { DestructiveConfirm } from "@/components/shared/DestructiveConfirm";
import { MutationError } from "@/components/shared/MutationError";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
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
			<p className="text-body text-text-2">
				Devices are managed from the machine running PrismaLens, not from a
				paired device.
			</p>
		);
	}

	return (
		<>
			<section data-testid="devices-list">
				{devices.isPending && (
					<div className="space-y-3 py-2">
						<Skeleton className="h-3 w-1/3" />
						<Skeleton className="h-3 w-1/2" />
					</div>
				)}
				{devices.isError && <MutationError error={devices.error} />}
				{devices.data?.devices.length === 0 && (
					<p className="text-body text-text-2">
						No device is paired. Only this machine can reach the instance.
					</p>
				)}
				{!!devices.data?.devices.length && (
					<ul>
						{devices.data.devices.map((d) => (
							<DeviceRow
								key={d.id}
								device={d}
								onRevoke={() => setRevoking(d)}
								onRenamed={refresh}
							/>
						))}
					</ul>
				)}
			</section>

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
				onConfirm={() => revoking && revoke.mutate({ id: revoking.id })}
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
		<li
			className="flex flex-col gap-2 border-t border-hairline py-2.5 first:border-t-0 sm:flex-row sm:items-start sm:gap-3"
			data-testid="device-row"
			data-current={device.current ? "" : undefined}
		>
			{editing ? (
				<form
					className="flex min-w-0 flex-1 items-center gap-2"
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
					<Button type="submit" size="sm" disabled={rename.isPending}>
						Save
					</Button>
					<Button
						type="button"
						variant="ghost"
						size="sm"
						onClick={() => {
							setName(device.name);
							setEditing(false);
						}}
					>
						Cancel
					</Button>
				</form>
			) : (
				<div className="min-w-0 flex-1">
					<p className="truncate text-body">
						<span className="font-medium" data-testid="device-name">
							{device.name}
						</span>
						{device.current && (
							<span className="ml-1.5 text-meta text-text-3">this device</span>
						)}
					</p>
					<p className="mt-0.5 text-meta text-text-3" data-testid="device-line">
						{deviceLine(device)}
					</p>
				</div>
			)}
			{!editing && (
				<div className="flex shrink-0 items-center gap-1">
					<Button
						variant="ghost"
						size="sm"
						onClick={() => setEditing(true)}
						data-testid="device-rename"
					>
						Rename
					</Button>
					<Button
						variant="ghost"
						size="sm"
						onClick={onRevoke}
						data-testid="device-revoke"
					>
						Revoke
					</Button>
				</div>
			)}
			{rename.isError && <MutationError error={rename.error} />}
		</li>
	);
}

const LOOPBACK = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|$)/i;

function PairAnother() {
	const here = typeof window === "undefined" ? "" : window.location.origin;
	const [origin, setOrigin] = useState(here);
	const [copied, setCopied] = useState<"idle" | "copied" | "failed">("idle");
	const create = useMutation({
		...orpc.pairing.manage.createLink.mutationOptions(),
	});
	const loopback = LOOPBACK.test(here);

	return (
		<section className="mt-8">
			<h3 className="mb-2 text-heading">Pair another device</h3>
			<p className="text-body text-text-2">
				Run <code>pl pair --tailscale</code> on the machine running PrismaLens,
				or create a link here. It works once, for 15 minutes.
			</p>
			<form
				className="mt-3 flex flex-wrap items-end gap-2"
				onSubmit={(e) => {
					e.preventDefault();
					setCopied("idle");
					create.mutate({ origin: origin.trim() || undefined });
				}}
			>
				{loopback && (
					<div className="min-w-0 flex-1 basis-64">
						<Label htmlFor="pair-origin" className="text-meta text-text-3">
							Address the other device can reach
						</Label>
						<Input
							id="pair-origin"
							className="mt-1"
							value={origin}
							onChange={(e) => setOrigin(e.target.value)}
						/>
					</div>
				)}
				<Button
					type="submit"
					variant="secondary"
					disabled={create.isPending}
					data-testid="device-create-link"
				>
					Create a link
				</Button>
			</form>
			{loopback && LOOPBACK.test(origin) && (
				<p className="mt-2 text-meta text-text-3">
					This address reaches only this machine. Use a LAN address or a tailnet
					name for another device.
				</p>
			)}
			{create.isError && (
				<MutationError error={create.error} className="mt-2" />
			)}
			{create.data && (
				<div className="mt-3 flex items-center gap-2">
					<code className="min-w-0 flex-1 truncate select-all">
						{create.data.url}
					</code>
					<Button
						variant="ghost"
						size="icon"
						aria-label="Copy link"
						onClick={() => {
							// Clipboard access needs a secure context; the link stays on screen otherwise.
							navigator.clipboard
								.writeText(create.data.url)
								.then(() => setCopied("copied"))
								.catch(() => setCopied("failed"));
						}}
					>
						{copied === "copied" ? <Check /> : <Copy />}
					</Button>
				</div>
			)}
			{copied === "failed" && (
				<p className="mt-1 text-meta text-text-3">
					Copying was blocked. Select the link and copy it by hand.
				</p>
			)}
		</section>
	);
}
