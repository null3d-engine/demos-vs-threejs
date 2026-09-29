// Device classes. The page sorts each device by feature tests (screen size and pointer), never by
// its name or user agent. Each class fixes the render pixel ratio for both engines and picks the
// auto-slide settings.

export type DeviceClass = 'desktop' | 'tablet' | 'phone';

export const DEVICE_CLASSES: readonly DeviceClass[] = ['desktop', 'tablet', 'phone'];

/** What the page measures about the device. */
export interface DeviceFacts {
	/** The shorter side of the screen, in CSS pixels. */
	shortSideCss: number;
	/** True when the main pointer is coarse (`(pointer: coarse)`), as on touch screens. */
	coarsePointer: boolean;
}

/** Tablets have a short side of at least this many CSS pixels. */
export const TABLET_SHORT_SIDE = 600;

export function deviceClass(facts: DeviceFacts): DeviceClass {
	if (!facts.coarsePointer) return 'desktop';
	return facts.shortSideCss >= TABLET_SHORT_SIDE ? 'tablet' : 'phone';
}

/**
 * The most device pixels per CSS pixel that each class draws. Both engines draw at
 * `min(devicePixelRatio, cap)`, so they fill the same number of pixels on the same device.
 */
export const PIXEL_RATIO_CAP: Readonly<Record<DeviceClass, number>> = {
	desktop: 1,
	tablet: 1.5,
	phone: 1.5,
};

/** The render pixel ratio for a device. */
export function renderPixelRatio(cls: DeviceClass, devicePixelRatio: number): number {
	const ratio = devicePixelRatio > 0 ? devicePixelRatio : 1;
	return Math.min(ratio, PIXEL_RATIO_CAP[cls]);
}
