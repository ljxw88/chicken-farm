import { createAudio } from '../audio';
import type { AppContext } from './context';

export function registerAudio(context: AppContext) {
  context.audio = createAudio();
}
