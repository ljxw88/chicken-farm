import { createChimneySmoke } from '../effects/createChimneySmoke';
import { createFireflies } from '../effects/createFireflies';

export const EFFECT_ASSETS = {
  'effect.chimney-smoke': createChimneySmoke,
  'effect.fireflies': createFireflies,
} as const;
