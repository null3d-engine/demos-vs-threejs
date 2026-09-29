import { startPage } from './shell/page';

startPage().catch((error: unknown) => {
	const status = document.getElementById('status');
	if (status)
		status.textContent = `The demo could not start: ${error instanceof Error ? error.message : String(error)}`;
});
