// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	Toast,
	ToastClose,
	ToastDescription,
	ToastTitle,
} from "@/components/ui/toast";
import {
	openAttentionToast,
	setAttentionToasts,
	useAttentionToasts,
} from "@/lib/attention/attention-toasts";

/** Another thread's events as toasts, inside the toast layer's one provider. */
export function AttentionToasts() {
	const toasts = useAttentionToasts();
	return (
		<>
			{toasts.map((t) => (
				<Toast
					key={t.id}
					variant={t.tone}
					duration={8000}
					onOpenChange={(o) => {
						if (!o)
							setAttentionToasts((all) => all.filter((x) => x.id !== t.id));
					}}
					data-testid="attention-toast"
				>
					<button
						type="button"
						className="flex min-w-0 flex-col items-start text-left focus-visible:outline-none"
						onClick={() => openAttentionToast(t)}
					>
						<ToastTitle>{t.title}</ToastTitle>
						{t.body && <ToastDescription>{t.body}</ToastDescription>}
					</button>
					<ToastClose />
				</Toast>
			))}
		</>
	);
}
