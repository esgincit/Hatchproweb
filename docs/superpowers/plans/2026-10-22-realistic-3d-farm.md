# Realistic 3D farm + viewer UI — plan (2026-10-22)

Owner feedback on v1 (commits 089ed8f, 6f45d98): "the 3D visualization is very simple … should be realistic and have all
things an actual farm has. Also UI should be improved. First plan it then build it."

## Goal
The Farm screen's 3D view looks like a real Indian poultry farm — real shed construction, site buildings, utilities,
vehicles, trees, people — all driven by the tenant's real rows, inside a redesigned viewer UI.

## Definition of done
1. **Looks real** (screenshots: overview, broiler shed inside, EC shed, layer cages, hatchery, phone):
   - Sheds: brick plinth, columns, steel trusses + purlins, corrugated GI roof with ridge ventilator, overhangs,
     chicken mesh + roll-up curtains (open-sided), sandwich panels + tunnel fans + cooling pads (EC), end walls + doors.
   - Inside: litter, feeder pans + drinker lines on hanging cables, bulbs, brooders/chick guards for young batches;
     layer A-frame cages with feed troughs, egg belts with eggs, moving feed trolley; hatchery setters/hatchers + egg trolleys.
   - Site: entrance gate with farm-name arch board, security cabin, wheel-dip, fence, internal roads, office, feed godown
     with bags, generator room, pump house + overhead water tank, feed silos, electric poles + transformer + wires,
     trees (neem/palmyra/shrubs), surrounding fields + distant hills, scattered props (crates, bags, gas cylinders, chairs).
   - Light: HDRI sky + matching sun, soft shadows, ambient occlusion, filmic tone mapping, haze.
2. **Data-driven**: shed size/type/status from rows; birds = live count; vehicles + generator + incubators from `asset`
   rows; open `maintenance_ticket`s → issue markers on that asset/shed; workers present today (`attendance`) → people
   walking; feed stock → silo/bag levels; logs: humidity + "last update by <name>".
3. **Viewer UI**: HUD (farm switcher, live, IST time, farm KPIs), shed list, floating shed labels, detail panel
   (expected-vs-actual bars, 14-day sparkline, issue banner, last update by, actions: record mortality / daily log /
   open batch), view modes Overview · Inside (walk-through) · Top, fullscreen, loading progress, quality Auto/High/Low;
   5 languages.
4. **Performance**: High ≥ 50 FPS (AMD Radeon iGPU, 1280×800, shed open); Low ≥ 30 FPS at 390 px; first load ≤ 40 MB.
5. **Tests**: unit (layout), e2e farm3d (open shed, panel, live update < 5 s, action opens form); all existing pass.

## Assets — all CC0 (no attribution needed; listed in `apps/web/public/3d/CREDITS.md`)
- Poly Haven textures (1k, some 2k): corrugated_iron_02, box_profile_metal_sheet, brick_wall_005, concrete_floor_02,
  painted_plaster_wall, red_laterite_soil_stones, sparse_grass, dry_ground_01, gravel_ground_01, rusty_metal_02,
  painted_metal_shutter, brown_planks_05, bark_brown_02.
- HDRI: farm_field_puresky 2k (fallback qwantani_mid_morning_puresky).
- Poly Haven small props, decimated + 512 px textures via Blender: cement_bag (feed bags), propane_tank (brooder gas),
  plastic_crate_01 (bird crates), barrel_03, plastic_monobloc_chair_01, large_iron_gate, power_box_01, rollershutter_door.
  (Poly Haven trees/shrubs are 0.3–3.7 M polys — not usable; poles are 200 k — rebuild.)
- Own Blender procedural (headless scripts): trees (neem/mango broadleaf, palmyra palm, shrubs), office, godown,
  generator room + DG canopy, pump house, water tank on stand, feed silo, security cabin, light truck (Tata 407 type),
  pickup (Bolero type), motorbike, worker figures (GPU walk rig like the birds).
- Scripts: `apps/web/scripts/fetch_assets.py` (download), `apps/web/scripts/blender/farm_assets.py` (build/convert).
  Output: `apps/web/public/3d/{hdri,tex,models}`. Shared PBR materials are assigned in three.js by material name
  (`M_brick`, `M_plaster`, `M_concrete`, `M_corrugated`, `M_galv`, `M_paint_*`, `M_glass`, `M_rubber`, `M_wood`, …);
  models use world-scale UVs (1 UV unit = 1 m).

## Architecture (`apps/web/components/farm3d/`)
- `Scene.tsx` — Canvas, renderer (ACES/AgX), HDRI env, sun + shadow fit, post (N8AO, SMAA), camera rig, quality tier.
- `layout.ts` — pure: farm → positions of sheds, roads, buildings, silos, fence, gate, trees (unit-tested, seeded).
- `materials.ts` — shared textured materials by name; `world/` — Ground, Site, Shed (open / EC / cage / hatchery),
  Interiors, Birds, People, Vehicles; `ui/` — Hud, ShedList, ShedPanel, Labels (DOM projector), Loading.
- Data: `lib/farm3d.ts` scene model gains assets, tickets, workers present, feed stock, humidity, last-update-by.

## Phases (riskiest first; each ends with screenshots + tests)
1. **Look spike** — fetch assets; HDRI, tone mapping, soft shadows, AO; textured ground/roads/fields; parametric open
   shed with trusses, corrugated roof, ridge vent, curtains, mesh. Screenshot checkpoint.
2. **Site** — layout + Blender batch (buildings, silo, tank, gate/sign, fence, poles/wires, trees, props). *(parallel agent)*
3. **Shed types + interiors** — broiler, EC, layer cages + eggs + trolley, hatchery.
4. **Viewer UI** — HUD, list, labels, panel, actions, view modes, fullscreen, loading, quality; i18n. *(parallel agent)*
5. **Data hooks** — vehicles/generator/incubators from assets, ticket markers, workers walking, silo levels, day/night.
6. **Finish** — perf tiers + PerformanceMonitor, FPS/size checks, tests, screenshots, commit, memory.

## Out of scope (ask first)
Whole-app redesign (demo/index.html stays the app UI spec); satellite-accurate placement; live weather API.

## Status — built 2026-10-22
- Phases 1–6 built. Sheds (open / EC / cage / hatchery) are parametric in `world/Shed.tsx`; the compound comes from
  `layout.ts`; 26 Blender models (`scripts/blender/farm_assets.py`, `convert_polyhaven.py`) are instanced by `world/Site.tsx`.
- Data hooks live: shed sizes/status, live bird counts, vehicles + generator + incubators from `asset`, open tickets as
  red markers, workers present walking, godown feed-bag stack from feed in store, humidity + "by <name>", day/night.
- Measured on the AMD Radeon iGPU (1280×800): overview / opened shed = broiler 60/54, layer 60/58, EC farm 60/56 FPS;
  phone 60. Download ≈ 22 MB (textures 8.9, HDRIs 6.2, models 5.3, birds 0.7).
- Deviations: bulbs glow but don't cast light (a warm litter glow fakes it at night); software-only WebGL shows the
  "3D not available" message instead of a frozen scene; a person LOD and GPS-true shed orientation are not done.
