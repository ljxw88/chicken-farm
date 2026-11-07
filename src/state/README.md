# State hook shape

`snapshot(world, contentId?)` describes one live engine world as a detached
`SaveV1` plain-data object. It copies the player pose, stable placed entity IDs,
cells and quarter-turn rotations, clock, and weather transition progress.
Placed items are ordered by their placement sequence, including after removals.
The default content ID is `farm-v1`.

The function rejects ambiguous worlds and invalid/non-finite values; negative
zero is normalized so a JSON round-trip deep-equals the returned object. The
caller is responsible for synchronizing any external renderer pose before taking
the snapshot. Transient input, previews, particles and renderer objects are not
part of this shape.

`SaveHooks` declares the future `save`/`load` contract only. No implementation,
storage, startup loading, migration, or restore behavior is provided here.
