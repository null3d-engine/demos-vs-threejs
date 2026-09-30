// Draws a built scene each frame: straight to the canvas, or, with the glow effect on, through the
// renderer's own post-processing. The glow is three.js's bloom: UnrealBloomPass for the WebGL
// renderer, and its WebGPU port, the bloom node, for the WebGPU renderer. Both keep the 4x MSAA of
// the plain draw, and both apply the tone mapping once, at the end.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import type * as WebGPU from 'three/webgpu';
import type { RendererKind, SceneBuild } from './common';

export interface Drawer {
	/** Draws one frame. */
	render(): void;
	/** Follows a new canvas size in CSS pixels. */
	setSize(width: number, height: number, pixelRatio: number): void;
}

/** The part of either renderer that drawing needs. */
interface AnyRenderer {
	render(scene: unknown, camera: unknown): unknown;
}

export async function makeDrawer(
	renderer: AnyRenderer,
	kind: RendererKind,
	build: SceneBuild,
	glow: boolean,
	size: { width: number; height: number; pixelRatio: number },
): Promise<Drawer> {
	const { scene, camera } = build;
	if (!glow) {
		return {
			render: () => renderer.render(scene, camera),
			setSize: () => {},
		};
	}
	const { threshold, strength, radius } = build.glow;
	if (kind === 'webgl') {
		const webgl = renderer as unknown as THREE.WebGLRenderer;
		const target = new THREE.WebGLRenderTarget(
			size.width * size.pixelRatio,
			size.height * size.pixelRatio,
			{ type: THREE.HalfFloatType, samples: 4 },
		);
		const composer = new EffectComposer(webgl, target);
		composer.addPass(new RenderPass(scene, camera));
		composer.addPass(
			new UnrealBloomPass(new THREE.Vector2(size.width, size.height), strength, radius, threshold),
		);
		composer.addPass(new OutputPass());
		const setSize = (width: number, height: number, pixelRatio: number) => {
			composer.setPixelRatio(pixelRatio);
			composer.setSize(width, height);
		};
		setSize(size.width, size.height, size.pixelRatio);
		return { render: () => composer.render(), setSize };
	}
	const { RenderPipeline } = await import('three/webgpu');
	const tsl = await import('three/tsl');
	const { bloom } = await import('three/addons/tsl/display/BloomNode.js');
	const pipeline = new RenderPipeline(renderer as unknown as WebGPU.Renderer);
	const color = tsl.pass(scene as WebGPU.Scene, camera as WebGPU.Camera).getTextureNode('output');
	pipeline.outputNode = color.add(bloom(color, strength, radius, threshold));
	// The pipeline's pass follows the renderer's size by itself.
	return { render: () => pipeline.render(), setSize: () => {} };
}
