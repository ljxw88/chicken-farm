# Image analysis — hay bale (reference.png, approach A render)

Note: reference.png is a native-resolution render of approach A's preliminary recipe, not an independent photograph. This analysis treats it as a stylized reference view only. All pixel observations are from that render.

- **Layer 1 identification**: rectangular hay bale prop. primaryDomain=object, primaryType=hay bale (chunky cuboid). Confidence 0.85. Fabric/straw mass, no articulation.
- **Layer 2 form**: single cuboid bounding volume, slightly beveled edges (softened). Bilateral symmetry across mid-plane. Proportions brief 1.0 wide × 0.7 deep × 0.6 high. Top face is the dominant rect, end faces (<chunky end>) shorter depth side. 45° isometric view; back faces occluded.
- **Layer 3 decomposition**: macro = bale body (1). meso = two binding bands (wrapping vertical). micro = end cap definition / subtle bevel facet band (no straw strands, no hatch per brief). No other fasteners.
- **Layer 4 spatial**: <band, wraps-around, bale body> with embed/overlap contact on long sides and top; <end-face region, caps, bale body> flush. Bands sit proud of surface by ~0.02-0.04, not floating. Ground contact at y=0.
- **Layer 5 materials (PBR)**: bale albedo warm tan/ochre matte (roughness 1, metalness 0, opaque). Bands timber brown matte. Both opaque flat-shaded, no translucency, no specular metal.
- **Layer 6 color/finish**: bale warm tan mid-value, low saturation; bands dark timber brown mid-dark value. Matte finish, no gradient.
- **Layer 7 identity**: (1) squat rectangular bale mass, (2) two broad timber binding bands, (3) distinct chunky end faces. Features become featureReviewTargets.
- **Layer 8 uncertainty**: hidden/occluded = rear long side bands, underside, interior overlap; uncertain = exact bevel radius (render shows only small chamfer), band width from foreshortened view. Per brief, interpret as bevelBox radius ~0.05-0.08, band width ~0.08-0.10. Needs multi-angle renders to confirm wrapping.
- Strict constraints honoured: no strands/hatch, no textures, farm palette only (dirt.hi, wood.mid, timber), size 1.0×0.7×0.6.
