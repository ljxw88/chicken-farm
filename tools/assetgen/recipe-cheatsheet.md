# Asset recipe cheat sheet

Return **JSON data**, not TypeScript or code. Every part must use a palette
token and may tag exactly one declared identity feature. Use several parts
with the same feature tag if that feature needs several components. The checker
tests each feature's visible contribution in eight fixed daytime views.

```json
{
  "id": "example",
  "category": "prop",
  "footprint": { "w": 1, "d": 1 },
  "height": 1,
  "origin": "base-center",
  "facing": "+Z",
  "parts": [
    { "name": "body", "prim": "box", "size": [1, 1, 1], "at": [0, 0.5, 0], "mat": "wood.mid", "feature": "body" }
  ],
  "anchors": {},
  "emissive": [],
  "collision": { "type": "box", "w": 1, "d": 1, "h": 1 },
  "slots": {},
  "tags": ["farm", "cozy"]
}
```

Primitive fields (all position/dimension units are world units; rotations are
Euler **degrees**; dimensions are full widths):

* `box`: `size:[width,height,depth]`.
* `cylinder`: `radiusTop`, `radiusBottom`, `h`, `segments` (6–8; both radii positive).
* `cone`: `radius`, `h`, `segments` (6–8); the builder makes a nondegenerate tip.
* `sphere`: faceted icosahedron, `radius`, `detail` (0 or 1).
* `capsule`: `radius`, `length` (straight middle), `segments`.
* `wedge`: `size:[width,height,depth]`.
* `lathe`: `profile:[[radius,localY],...]` ordered from bottom to top, `segments`.
  A zero-radius endpoint is supported. For a closed barrel, use e.g. axis point,
  base rim, middle bulge, top rim, axis point. The local y values are relative
  to `at`, not absolute world coordinates.
* `extrude`: `polygon:[[x,y],...]`, `depth` along Z. It is centred on
  `at[2]`: before rotation/scale its Z range is `at[2] - depth/2` through
  `at[2] + depth/2`. Include both ends when measuring the full asset bounds.
* `custom`: `positions` and triangle `indices`; lower-trust, only when necessary.

Each part needs `name`, `prim`, `mat`, `at`; optional `rot`, `scale`, `feature`,
`exception` (`band`, `cleat` or `twine`; still at least 0.1), `polygonOffset`, and seeded `jitter`.
Part names are unique lowercase kebab-case, e.g. `left-lobe`, not `left_lobe`
or `leftLobe`. Seed belongs on the part, beside `jitter`, not inside it:

```json
{"name":"left-lobe","prim":"sphere","radius":0.3,"detail":1,"at":[0,1,0],"mat":"foliage.mid","feature":"lobes","seed":84001,"jitter":{"rotation":0.01}}
```

The only `jitter` keys are `position` and `rotation`; each is a scalar number
from 0 to 0.03 (world units and radians respectively). Do not use nested `seed`,
`max`, `rot`, or arrays. If the spec has `variationSeed`, put that exact integer
in a part's `seed` and use nonzero `position` or `rotation` jitter on that part.
Prefer rotation jitter for an above-ground part so the base stays grounded.
No loops, calculations, expressions, URLs, comments, raw hexes, arbitrary keys,
or code. Matte albedo tokens include `wood.mid`, `wood.light`, `timber`,
`trunk`, `foliage.mid`, `foliage.light`, `foliage.dark`, `dirt.hi`, `stone`,
`plaster`, `roof` and `water`. `slots` can map aliases to these tokens.

The checker uses actual 3D triangle intersection, so intersect adjacent parts by
more than 0.005 units; avoid coincident exterior faces and thin decorative
plates. A valid component must be connected to ground through other components.
Do not use identical X/Z extents on intersecting stacked boxes: their side faces
become coplanar. For a band around a cylinder, use a lathe profile rather than a
solid cylinder if it would hide the body. Use broad readable geometry; do not
claim a feature merely by naming an invisible or irrelevant part.
