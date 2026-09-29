// The worker that runs three.js with an OffscreenCanvas: the one worker the rules allow it.

import type { FromEngine, ToEngine } from '../engine/protocol';
import { ThreeRuntime } from './runtime';

const scope = self as unknown as {
	postMessage(message: FromEngine): void;
	onmessage: ((event: MessageEvent<ToEngine>) => void) | null;
	close(): void;
};

let runtime: ThreeRuntime | null = null;

scope.onmessage = (event) => {
	const message = event.data;
	switch (message.type) {
		case 'start': {
			if (!message.canvas) {
				scope.postMessage({ type: 'failed', message: 'The worker got no canvas.' });
				return;
			}
			runtime = new ThreeRuntime(
				message.canvas,
				message.options,
				(reply) => scope.postMessage(reply),
				true,
			);
			runtime.start().catch((error: unknown) => {
				scope.postMessage({
					type: 'failed',
					message: error instanceof Error ? error.message : String(error),
				});
			});
			return;
		}
		case 'count':
			runtime?.setCount(message.count);
			return;
		case 'measure':
			runtime?.measure(message.id, message.milliseconds);
			return;
		case 'pause':
			runtime?.setPaused(message.paused);
			return;
		case 'resize':
			runtime?.resize(message.width, message.height, message.pixelRatio);
			return;
		case 'stop':
			runtime?.stop();
			runtime = null;
			scope.close();
			return;
	}
};
