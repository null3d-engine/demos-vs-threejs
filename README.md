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

## Commands

| Command | Use |
| --- | --- |
| `bun run dev` | Serve the demos with the isolation headers on port 5173 |
| `bun run build` | Build the site into `dist/` |
| `bun run preview` | Serve the build with the isolation headers |
| `bun run test` | Unit tests |
| `bun run check` | Lint and format check (Biome) |
| `bun run check:fix` | Lint and format, fixing what Biome can |
| `bun run typecheck` | TypeScript check |

## License

Licensed under either of the [Apache License 2.0](LICENSE-APACHE) or the [MIT license](LICENSE-MIT), at your option.
