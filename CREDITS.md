# Credits

Frontfall is written from scratch. It relies on these open source projects:

| Project                                | Used for                    | License    |
| -------------------------------------- | --------------------------- | ---------- |
| [Three.js](https://threejs.org/)       | Rendering                   | MIT        |
| [ws](https://github.com/websockets/ws) | WebSocket server            | MIT        |
| [zod](https://zod.dev/)                | Message validation          | MIT        |
| [Vite](https://vite.dev/)              | Client build and dev server | MIT        |
| [Vitest](https://vitest.dev/)          | Tests                       | MIT        |
| [Playwright](https://playwright.dev/)  | End-to-end tests            | Apache-2.0 |
| [Inter](https://rsms.me/inter/)        | Interface and logo typeface | OFL-1.1    |

## Map data

Every map is generated from [Natural Earth](https://www.naturalearthdata.com/), free vector and raster map data in the public domain, by the generator in [`tools/src/mapgen`](tools/src/mapgen). Each map's manifest names its sources again.

| Map    | Dataset                                                                                           | Layers                                                                                             | License       |
| ------ | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------- |
| World  | [Natural Earth 5.1.2](https://github.com/nvkelso/natural-earth-vector/releases/tag/v5.1.2), 1:10m | land, lakes, glaciated areas, geography regions and elevation points, bathymetry, populated places | Public domain |
| Europe | [Natural Earth 5.1.2](https://github.com/nvkelso/natural-earth-vector/releases/tag/v5.1.2), 1:10m | same as World                                                                                      | Public domain |

The files and their checksums are listed in [`tools/mapgen/sources.json`](tools/mapgen/sources.json). See [docs/maps.md](docs/maps.md) for how they are used.

## Artwork

The logo, icons and brand artwork were drawn for Frontfall. The files are MIT like the rest of the repository; the Frontfall name and logo still identify the official project, see [Name and logo use](docs/brand.md#name-and-logo-use).

Game design is inspired by browser territory games such as [OpenFront](https://openfront.io/). No code, assets or text from those games are used.
