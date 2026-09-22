// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Settings → Devices (ADR 0004 §8): the phones and laptops paired with this
 * instance, a way to pair another, and a way to revoke one. Hidden to a paired
 * device: managing access is the host's.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { MutationError } from "@/components/shared/MutationError";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useOperator } from "@/hooks/use-operator";
import { orpc } from "@/lib/api/orpc-client";

export function useDevices(enabled = true) {
	return useQuery({
		...orpc.pairing.manage.listDevices.queryOptions({ input: {} }),
		enabled,
	});
}

export function DevicesTab() {
	const { via } = useOperator();
	const isDevice = via === "device";
	const queryClient = useQueryClient();
	const devices = useDevices(!isDevice);
	const revoke = useMutation({
		...orpc.pairing.manage.revokeDevice.mutationOptions(),
		onSuccess: () =>
			queryClient.invalidateQueries({
				queryKey: orpc.pairing.manage.listDevices.queryKey({ input: {} }),
			}),
	});

	if (isDevice) {
		return (
			<p className="text-record text-muted-foreground">
				Devices are managed from the machine running prismalens, not from a
				paired device.
			</p>
		);
	}

	return (
		<div className="space-y-8">
			<PairAnother />

			<section className="space-y-3">
				<h3 className="text-label font-medium">Paired devices</h3>
				{devices.data?.devices.length === 0 && (
					<p className="text-record text-muted-foreground">
						No device is paired. Only this machine can reach the instance.
					</p>
				)}
				<ul className="divide-y rounded-md border">
					{devices.data?.devices.map((d) => (
						<li
							key={d.id}
							className="flex items-center justify-between gap-4 px-3 py-2"
						>
							<div className="min-w-0">
								<p className="truncate text-record">
									{d.name}
									{d.current && (
										<span className="ml-2 text-meta text-muted-foreground">
											this device
										</span>
									)}
								</p>
								<p className="text-meta text-muted-foreground">
									paired {new Date(d.createdAt).toLocaleDateString()}
									{d.lastSeenAt &&
										` · last seen ${new Date(d.lastSeenAt).toLocaleString()}`}
								</p>
							</div>
							<Button
								variant="outline"
								size="sm"
								disabled={revoke.isPending}
								onClick={() => revoke.mutate({ id: d.id })}
							>
								Revoke
							</Button>
						</li>
					))}
				</ul>
				{revoke.isError && <MutationError error={revoke.error} />}
			</section>
		</div>
	);
}

function PairAnother() {
	const [origin, setOrigin] = useState(() =>
		typeof window === "undefined" ? "" : window.location.origin,
	);
	const [label, setLabel] = useState("");
	const [copied, setCopied] = useState(false);
	const create = useMutation({
		...orpc.pairing.manage.createLink.mutationOptions(),
	});
	const loopback = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|$)/i.test(
		origin,
	);

	return (
		<section className="space-y-3">
			<h3 className="text-label font-medium">Pair another device</h3>
			<p className="text-record text-muted-foreground">
				The link works once, for 15 minutes. Open it on the other device. Treat
				it as a password.
			</p>
			<form
				className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_12rem_auto]"
				onSubmit={(e) => {
					e.preventDefault();
					setCopied(false);
					create.mutate({
						origin: origin.trim() || undefined,
						label: label.trim() || undefined,
					});
				}}
			>
				<div className="space-y-1">
					<Label htmlFor="pair-origin">Address the device can reach</Label>
					<Input
						id="pair-origin"
						value={origin}
						onChange={(e) => setOrigin(e.target.value)}
						placeholder="http://192.168.1.5:3001"
					/>
				</div>
				<div className="space-y-1">
					<Label htmlFor="pair-label">Device name</Label>
					<Input
						id="pair-label"
						value={label}
						onChange={(e) => setLabel(e.target.value)}
						placeholder="phone"
						maxLength={80}
					/>
				</div>
				<div className="flex items-end">
					<Button type="submit" disabled={create.isPending}>
						Create link
					</Button>
				</div>
			</form>
			{loopback && (
				<p className="text-meta text-muted-foreground">
					A loopback address reaches only this machine. Use a LAN IP or a
					tailnet name for another device.
				</p>
			)}
			{create.isError && <MutationError error={create.error} />}
			{create.data && (
				<div className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2">
					<code className="min-w-0 flex-1 truncate text-meta">
						{create.data.url}
					</code>
					<Button
						variant="ghost"
						size="sm"
						onClick={async () => {
							await navigator.clipboard.writeText(create.data.url);
							setCopied(true);
						}}
					>
						{copied ? (
							<Check className="h-4 w-4" />
						) : (
							<Copy className="h-4 w-4" />
						)}
					</Button>
				</div>
			)}
		</section>
	);
}
