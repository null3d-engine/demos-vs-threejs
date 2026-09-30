# null3D vs three.js

Three demo scenes, each drawn by [null3D](https://github.com/null3d-engine/null3d) and by a tuned three.js. Both versions of a scene look the same. A count slider adds objects until one engine can no longer keep up, and a live readout shows what each engine does.

Status: in progress. The three.js versions come first. The null3D versions follow the null3D releases up to 1.0.

## The scenes

| Scene | What it tests |
| --- | --- |
| Factory | Robot arms, belts and crates. Every arm is a tree of parts that moves every frame. |
| City | A city at night with traffic. Most objects stand still, and buildings hide most of the city. |
| Battle | Two armies of animated soldiers, with tanks, projectiles and explosions. |

## Rules of the comparison

1. Each scene has one shared description: seed, models, colors, lights, camera path and a fixed-step simulation. Both engines run the same scene code and reach the same state at the same time.
2. Both engines draw at the same size and pixel ratio, with 4x MSAA, the same tone mapping and the high-performance GPU.
3. null3D's automatic quality drop is off. three.js also draws at a fixed resolution.
4. The three.js version uses three.js 0.186.1, its add-ons and the methods of its official examples, plus normal game code. It runs in one worker with an OffscreenCanvas. It uses the faster of its two renderers on each device.
5. Every effect is a switch. An effect is on only when both engines draw it the same way, as an image check shows.
6. One engine runs at a time.
7. The run files and the three.js code are public. If you can make the three.js version faster within these rules, open a pull request.

## Run the demos

You need [Bun](https://bun.sh/) 1.3.14 or newer.

```sh
bun install
bun run dev
```

Then open `http://localhost:5173/`. The dev server sends the two headers that make the page cross-origin isolated, which worker threads need.

### Page options

Add these to the page address, for example `/?scene=city&gpu=webgl2&count=500`.

| Option | Values | Default |
| --- | --- | --- |
| `scene` | `factory`, `city`, `battle` | `factory` |
| `engine` | `threejs` | `threejs` |
| `gpu` | `auto`, `webgpu`, `webgl2` | `auto`: WebGPU where it works, else WebGL2 |
| `effects` | Effect names, separated by commas: `shadows`, `fog`, `glow` | The scene's effects |
| `count` | The count to start with. The page keeps it inside the slider's range. | The auto-slide's start count |
| `at` | Simulation seconds to run before the first frame, from 0 to 600, to start the scene at a set moment | `0` |
| `hold` | Draw one frame at `at` and keep it, with no readout: the hold frame of the image check | Off |
| `crowd` | How three.js draws the battle's soldiers on WebGL2: `draw` (one draw per model, in the WebGPU renderer's WebGL2 mode) or `skinned` (one skinned model per soldier, in the WebGL renderer). WebGPU always uses `draw`. | `draw` |

## Commands

| Command | Use |
| --- | --- |
| `bun run dev` | Serve the demos with the isolation headers on port 5173 |
| `bun run build` | Build the site into `dist/` |
| `bun run preview` | Serve the build with the isolation headers |
| `bun run test` | Unit tests |
| `bun run test:browser` | Start each demo in Chromium with a software GPU, through Playwright |
| `bun run check` | Lint and format check (Biome) |
| `bun run check:fix` | Lint and format, fixing what Biome can |
| `bun run typecheck` | TypeScript check |
| `bun run parity` | The image check: each scene's hold frame drawn by three.js on WebGL2 and on WebGPU, compared with three.js's image rule; frames, diffs and a report go to `runs/parity` (`--help` for options) |
| `bun run assets` | Make the battle's models in `assets/models/` from the source files listed in `assets/source.json` |

## Publish

The `Deploy` workflow builds the demos and publishes them on Cloudflare Pages: `main` to the production site, each pull request to a preview address. `public/_headers` sends the two cross-origin isolation headers there.

It needs, in the repository settings:

| Setting | Kind | Value |
| --- | --- | --- |
| `CLOUDFLARE_API_TOKEN` | Secret | A Cloudflare API token with the Cloudflare Pages: Edit permission |
| `CLOUDFLARE_ACCOUNT_ID` | Secret | The Cloudflare account ID |
| `CLOUDFLARE_PAGES_PROJECT` | Variable (optional) | The Pages project name; default `null3d-vs-threejs` |

Make the project once with `bunx wrangler pages project create null3d-vs-threejs --production-branch main`. Without the secrets, the workflow only says so and passes.

## License

Licensed under either of the [Apache License 2.0](LICENSE-APACHE) or the [MIT license](LICENSE-MIT), at your option.
