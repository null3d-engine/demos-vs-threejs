// Visual effects. Each is a switch, on in both engines or off in both. An effect stays on only when
// the image check shows that both engines draw it the same way on every GPU path.

export type EffectName = 'shadows' | 'fog' | 'glow';

export const EFFECT_NAMES: readonly EffectName[] = ['shadows', 'fog', 'glow'];

export type Effects = Record<EffectName, boolean>;

/** Effects that are all off. */
export function noEffects(): Effects {
	return { shadows: false, fog: false, glow: false };
}

/** The effects a scene uses, all on: the starting point before the image checks. */
export function effectsOf(names: readonly EffectName[]): Effects {
	const effects = noEffects();
	for (const name of names) effects[name] = true;
	return effects;
}

/** The effect switches as URL text, such as `shadows,fog`, for links and run files. */
export function effectsToText(effects: Effects): string {
	return EFFECT_NAMES.filter((name) => effects[name]).join(',');
}

/** Reads effect switches from URL text; unknown names are refused. */
export function effectsFromText(text: string): Effects {
	const effects = noEffects();
	for (const part of text.split(',')) {
		const name = part.trim();
		if (name === '') continue;
		if (!(EFFECT_NAMES as readonly string[]).includes(name))
			throw new RangeError(`"${name}" is not an effect. Use: ${EFFECT_NAMES.join(', ')}.`);
		effects[name as EffectName] = true;
	}
	return effects;
}
