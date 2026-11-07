# Farm content and art slots

These files contain plain, finite data; they do not contain Three.js objects.
`farm.ts` supplies layout, prop IDs and positions; `buildings.ts`, `world.ts`
and the `*Geometry.ts` files supply sizes and collision footprints. The default
is assembled by the render factories in `src/render/`, which resolve the IDs in
the data. Placement entities likewise carry `fence` or `plot` asset IDs.

`slots.ts` holds the named palette, building, light, pixel, placement tint and
stair appearance slots. A Look Dev change can replace slot values without
changing world dimensions. Building, stair and placement-tint factories also accept
explicit alternate slot bundles. Slots are defaults used at construction/build
time, not a live asset-loading or hot-swap API.
`node tools/content-inventory.mjs` lists every data/slot leaf key (`[]` denotes
array elements).

Day/night, cloudy and rain presets are data. The EBR-88 `RAIN_LOOK` record is
copied byte-for-byte and deliberately remains intact, including its existing
colour and dimensions; splitting or retuning that locked record is out of scope.
The HUD CSS, shader equations and renderer/system algorithms remain in their
existing adapters; they are not game content records.
