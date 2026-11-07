import { STARTUP_OPTIONS } from '../content/startup';
import { createFarmHud, createSkyHud, createSkyStateAdapter } from '../ui';
import type { AppContext } from './context';

export function registerHud(context: AppContext) {
  context.farmHud = createFarmHud({ root: context.hudRoot, initialPhase: context.dayNight.getPhase() });
  // A clean, HUD-free frame is available without DevTools for signed visual gates.
  const skyEnabled = new URLSearchParams(window.location.search).get(STARTUP_OPTIONS.skyHudKey) !== STARTUP_OPTIONS.skyHudDisabledValue;
  context.skyState = skyEnabled ? createSkyStateAdapter(window) : undefined;
  context.skyHud = context.skyState ? createSkyHud({ root: context.skyRoot, ...context.skyState, audio: context.audio }) : undefined;
  if (!skyEnabled) context.skyRoot.remove();
}

export function updateSkyHudFrame(context: AppContext, deltaSeconds: number) {
  context.skyState?.update(deltaSeconds);
  context.skyHud?.update();
}
