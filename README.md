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
| `bench` | Measure for this many seconds (default 30) after a 5 s warm-up, and hand the figures to `bun run bench` | Off |
| `auto` | Start the auto-slide after a 5 s warm-up, and hand its run file to `bun run bench` | Off |
| `gputime` | Measure GPU time with timestamp queries (the WebGPU renderer only). The queries cost time, so GPU time comes from runs of its own | Off |
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
| `bun run bench` | The benchmark: each scene with three.js at fixed counts (or `--auto`), five fresh-tab runs of 5 s warm-up and 30 s measured, in Google Chrome on this machine's GPU; run files and a summary go to `runs/bench` (`--help` for options) |
| `bun run parity` | The image check: each scene's hold frame drawn by three.js on WebGL2 and on WebGPU, compared with three.js's image rule; frames, diffs and a report go to `runs/parity` (`--help` for options) |
| `bun run devices` | The same measurements, or a search for the largest count at which three.js holds the display rate (`--plan scale`), in browsers that Playwright cannot drive: apps on this Mac, browsers on an Android phone over USB, and tablets and phones on the local network; results go to `runs/devices` (`--help` for options) |
| `bun run dev-cert` | Make the HTTPS certificate that tablets and phones on the local network need (uses mkcert) |
| `bun run assets` | Make the battle's models in `assets/models/` from the source files listed in `assets/source.json` |

## Phones and tablets

`bun run devices` builds the site and serves it with a runner page. The runner page opens each
demo page in a frame, waits for its result, and sends the result back. It needs no remote control
of the browser, so it works in any browser.

- **Android phone:** turn on USB debugging and connect the phone. The tool forwards its port over
  adb, opens the runner page in each named browser, and reads the phone's heat every 10 s. Each
  result records the heat it ran in.

  ```sh
  bun run devices -- --android chrome,brave
  bun run devices -- --android chrome --plan scale
  ```

- **iPad or iPhone:** browsers give WebGPU and shared memory only to secure pages, so the tool
  serves HTTPS on the local network. Run `bun run dev-cert` once, and install and trust the
  printed `rootCA.pem` on the device. Then start the tool and open the printed address on the
  device, with `?listen&runner=ipad-safari`. The page waits for each run.

  ```sh
  bun run devices -- --lan ipad-safari --scenes city
  ```

- **Apps on this Mac:** name them, for example `bun run devices -- Safari`.

One browser per device runs at a time. The scale search doubles the count until three.js drops
below the display rate, then narrows the gap, and suggests an auto-slide row that starts at half
the count that held.

## License

Licensed under either of the [Apache License 2.0](LICENSE-APACHE) or the [MIT license](LICENSE-MIT), at your option.
