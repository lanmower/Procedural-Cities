# Procedural Cities — Three.js / GitHub Pages

A procedural city generator running entirely in the browser using Three.js.

**[Live Demo](https://lanmower.github.io/Procedural-Cities/)**

## Algorithms

The city generation pipeline is a faithful JavaScript port of the original Unreal Engine C++ implementation:

### Road Network (roadGen.js)
Priority-queue driven road expansion guided by a simplex noise heatmap (ported from `Spawner.cpp`).

- A min-heap processes road candidates ordered by noise value at their endpoint
- Each accepted segment spawns forward continuation + left/right branches
- Main roads can branch into new main roads or secondary roads (`mainBranchChance`)
- Loose road ends extend up to `maxAttach` to connect to nearby roads

### Plot Extraction (plotGen.js)
City block polygon extraction from road segments (ported from `BaseLibrary::getSurroundingPolygons`).

- Each road segment produces two parallel side-lines
- Side-lines are split wherever they cross other roads
- Intersecting side-lines link into parent/child chains that form block polygons

### Building Generation (buildingGen.js)
Recursive polygon subdivision and extrusion (ported from `PlotBuilder` + `HouseBuilder`).

- Plot polygons are bisected along their longest edge until below max area
- Each footprint is extruded via `THREE.ExtrudeGeometry` to a random floor count

### Noise (noise.js)
2D Simplex noise ported from `simplexnoise.cpp` (Sebastien Rombauts / Stefan Gustavson).

## Running Locally

```
npx serve docs
```

Open `http://localhost:3000`.

## GitHub Pages

Point GitHub Pages to the `/docs` folder in repository settings.

## Controls

| Action | Control |
|--------|---------|
| Orbit  | Left-drag |
| Zoom   | Scroll |
| Pan    | Right-drag |

## License

MIT
