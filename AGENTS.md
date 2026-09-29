# Rules for people and agents working in this repository

This repository holds demo scenes that compare null3d with three.js. The README states the rules of the comparison. This file holds the working rules.

## Where things are

| Path | Contents |
| --- | --- |
| `src/scenes/` | The shared scene descriptions. Plain data and pure functions, with no engine imports. |
| `src/shell/` | The demo page: scene picker, engine switch, count slider and auto-slide, readout |
| `src/measure/` | Frame statistics that measure both engines the same way |
| `src/threejs/` | The tuned three.js version of each scene, run in a worker |
| `src/null3d/` | The null3d version of each scene |
| `tools/` | Measuring, device and recording tools |
| `public/_headers` | The isolation headers for Cloudflare Pages |

## Commands

The README lists every command. Run `bun run check`, `bun run typecheck` and `bun run test` before each commit.

## Rules

1. The shared scene description is the single source of each scene. Both engines read their data, motion, camera path and counts from it.
2. Motion runs in a fixed-step simulation from a seed, so both engines hold the same state at the same time.
3. Per-frame code allocates nothing: no `new`, no array or object literals, no closures. Write into arrays made once at setup.
4. The three.js version uses only three.js 0.186.1, its add-ons and the methods of its official examples, plus normal game code. It runs in one worker. No hand-built engine systems, no multi-worker split and no baked animation textures.
5. Both engines ask for the high-performance GPU.
6. Every visual effect is a switch in the scene options. An effect ships only when the image check passes on every GPU path.
7. The readout shows only figures that both engines give in the same way.
8. Never decide anything from GPU names or user agents. Decide from feature tests.

## Commits

Commits follow Conventional Commits, with a scope such as `scenes`, `shell`, `threejs`, `null3d`, `tools` or `ci`. Pull requests merge by squash.
