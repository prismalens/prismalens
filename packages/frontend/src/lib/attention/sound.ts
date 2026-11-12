// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * One short two-note chime for a thread that needs you (#1101 category 4), made
 * with Web Audio so no sound file ships. Browsers allow it after a first click.
 */
let ctx: AudioContext | null = null;

export function playNeedsYou(): void {
	try {
		ctx ??= new AudioContext();
		const audio = ctx;
		const start = audio.currentTime;
		[660, 880].forEach((hz, i) => {
			const osc = audio.createOscillator();
			const gain = audio.createGain();
			osc.type = "sine";
			osc.frequency.value = hz;
			const at = start + i * 0.14;
			gain.gain.setValueAtTime(0.0001, at);
			gain.gain.exponentialRampToValueAtTime(0.15, at + 0.02);
			gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.22);
			osc.connect(gain).connect(audio.destination);
			osc.start(at);
			osc.stop(at + 0.24);
		});
	} catch {
		// No audio device, or the browser has not allowed sound yet.
	}
}
