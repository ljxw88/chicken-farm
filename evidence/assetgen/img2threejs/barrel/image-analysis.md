# Image analysis — barrel (reference.png)

Reference is a render of approach A's preliminary recipe, not a photograph. View is slightly above, front, flat orthographic-ish, green void background.

## Layer 1 Identification
- Wooden stave barrel: work type "stave barrel", classification "container prop", primaryDomain=object, confidence 0.97.

## Layer 2 Form/silhouette
- Radial symmetry about +Y. Low-poly lathe: narrower at base, bulging mid, slightly narrower at top lip. Bounding volume ~0.8 x 1.0 x 0.8 per spec.json (width 0.8, depth 0.8, height 1.0). Faceted cylindrical body, flat-shaded quads.

## Layer 3 Decomposition
- Macro: stave-body, lid, hoop-top, hoop-mid, hoop-bottom.
- Meso: lid-disc + rim; staves as single faceted lathe (no per-stave gaps at this scale); hoops as short cylinders.
- Micro: none beyond bevels between bands. No nails/grain per style-bible prohibition.

## Layer 4 Spatial
- <hoop-top, attached-to, body-upper>, <hoop-mid, attached-to, body-mid-bulge>, <hoop-bottom, attached-to, body-lower>, <lid, above, body-top, flush-with>. Hoops fully encircle body (overlap/embed), lid caps top, base rests at y=0.

## Layer 5 Materials (PBR)
- Body staves: wood.mid dielectric, roughness 1, metalness 0, matte opaque.
- Lid: wood.light (lighter top disc), same PBR.
- Hoops: timber dark brown, roughness 1, metalness 0. Dirt.hi hint corresponds to lightest lid tint; builder will resolve via game palette tokens only (wood.mid/wood.light/timber). Flat shading, no textures/noise.

## Layer 6 Color/finish
- Body mid-tone warm brown, lid pale tan, hoops dark umber. Matte finish, faceted value bands from lighting only.

## Layer 7 Identity
- (1) Bulge + taper profile, (2) three broad dark hoops evenly spaced, (3) contrasting pale lid disc. Matches spec.json identityFeatures.

## Layer 8 Uncertainty
- Hidden: inner stave detail, bottom face, rear hoop continuity (inferred continuous ring). Camera is near-orthographic high-front; side profiles from turntable must confirm roundness. Reference is small in frame (object ~120px tall in 640px image), so no micro detail can be claimed.
