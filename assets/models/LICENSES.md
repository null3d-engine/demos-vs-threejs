# Model licenses

The battle's models are converted from free packs by Quaternius. Each pack page says "License CC0", and the Quaternius FAQ says: "All models are under the CC0 License" ([quaternius.com/faq.html](https://quaternius.com/faq.html)). The CC0 1.0 deed says the author "has dedicated the work to the public domain by waiving all of his or her rights to the work worldwide under copyright law, including all related and neighboring rights, to the extent allowed by law" ([creativecommons.org/publicdomain/zero/1.0](https://creativecommons.org/publicdomain/zero/1.0/)).

| File | Source pack | Source file | License |
| --- | --- | --- | --- |
| `soldier.glb` | [Toon Shooter Game Kit](https://quaternius.com/packs/toonshootergamekit.html) | `Characters/glTF/Character_Soldier.gltf` | CC0 1.0 |
| `mech.glb` | [Animated Mech Pack](https://quaternius.com/packs/animatedmech.html), flat colors | `Flat Colors/glTF/George.gltf` | CC0 1.0 |

## Changes from the source files

`bun run assets` (`tools/assets.ts`) makes each file from its source, as listed in `assets/source.json` with the source file's SHA-256:

- One skinned mesh with one material. Each part's material color becomes a vertex color. Rigid parts on bones (the soldier's head, shoulder pads and rifle) are folded into the skinned mesh.
- Fewer joints: finger and helper joints are removed, and their weights move to the nearest kept joint.
- Four clips only, renamed `idle`, `run`, `shoot` and `die`.
- A simplified mesh: 2,500 triangles for the soldier, 3,000 for the mech.

`manifest.json` lists each file's figures: triangles, vertices, joints, the aim joint, the scale and the clip lengths.
