# 3D asset credits

## Poly Haven models (CC0 1.0 — public domain, attribution not required)

Converted by `apps/web/scripts/blender/convert_polyhaven.py` (1k glTF → decimated, 512 px JPEG textures, metres,
front +Z, origin at the base centre).

| File | Poly Haven asset | Author(s) | Changes |
|------|------------------|-----------|---------|
| `models/feed_bag.glb` | [Cement Bag](https://polyhaven.com/a/cement_bag) | PierreB3D | decimated; colour map repainted as a plain woven feed sack |
| `models/gas_cylinder.glb` | [Propane Tank](https://polyhaven.com/a/propane_tank) | Slinc | decimated |
| `models/crate.glb` | [Plastic Crate 01](https://polyhaven.com/a/plastic_crate_01) | PierreB3D | decimated |
| `models/barrel.glb` | [Barrel 03](https://polyhaven.com/a/barrel_03) | Serhii Khromov | decimated |
| `models/chair.glb` | [Plastic Monobloc Chair 01](https://polyhaven.com/a/plastic_monobloc_chair_01) | Kuutti Siitonen | decimated, turned to face +Z |
| `models/panel_box.glb` | [Power Box 01](https://polyhaven.com/a/power_box_01) | Rico Cilliers, Yann Kervran | door closed, decimated |

License: <https://creativecommons.org/publicdomain/zero/1.0/>

## Poly Haven textures and HDRIs (CC0 1.0)

Fetched by `apps/web/scripts/fetch_assets.py` into `tex/` and `hdri/` (keep this list in sync with that script).

- Textures: [corrugated_iron_02](https://polyhaven.com/a/corrugated_iron_02), [box_profile_metal_sheet](https://polyhaven.com/a/box_profile_metal_sheet),
  [brick_wall_005](https://polyhaven.com/a/brick_wall_005), [concrete_floor_02](https://polyhaven.com/a/concrete_floor_02),
  [painted_plaster_wall](https://polyhaven.com/a/painted_plaster_wall), [red_laterite_soil_stones](https://polyhaven.com/a/red_laterite_soil_stones),
  [sparse_grass](https://polyhaven.com/a/sparse_grass), [dry_ground_01](https://polyhaven.com/a/dry_ground_01),
  [gravel_ground_01](https://polyhaven.com/a/gravel_ground_01), [farm_soil](https://polyhaven.com/a/farm_soil),
  [coast_sand_01](https://polyhaven.com/a/coast_sand_01), [rusty_metal_02](https://polyhaven.com/a/rusty_metal_02),
  [painted_metal_shutter](https://polyhaven.com/a/painted_metal_shutter), [brown_planks_05](https://polyhaven.com/a/brown_planks_05),
  [bark_brown_02](https://polyhaven.com/a/bark_brown_02)
- HDRIs: [farm_field_puresky](https://polyhaven.com/a/farm_field_puresky), [qwantani_night_puresky](https://polyhaven.com/a/qwantani_night_puresky)

## Original procedural models

Every other model in `models/` (buildings, silo, water tank, gate, poles, transformer, trees, palms, shrub, vehicles,
wheelbarrow, person) is original work generated from code by `apps/web/scripts/blender/farm_assets.py`, including
their embedded textures (leaf and palm atlases, solar cells, vehicle decals). No third-party geometry or images are
used in them.
