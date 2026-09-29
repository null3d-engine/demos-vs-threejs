// The display's refresh rate, measured from the page's animation frames. Frame rates are judged
// against it: 120 on a ProMotion MacBook Pro in Chrome, 60 on most phones and in Safari on macOS.

/** Measures the display rate over about half a second: the median interval between frames. */
export function measureDisplayHz(frames = 40): Promise<number> {
	return new Promise((resolve) => {
		const intervals: number[] = [];
		let last = -1;
		const tick = (time: number) => {
			if (last >= 0) intervals.push(time - last);
			last = time;
			if (intervals.length < frames) {
				requestAnimationFrame(tick);
				return;
			}
			intervals.sort((a, b) => a - b);
			const median = intervals[Math.floor(intervals.length / 2)] ?? 1000 / 60;
			resolve(Math.round(1000 / median));
		};
		requestAnimationFrame(tick);
	});
}
