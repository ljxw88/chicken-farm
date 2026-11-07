import type { AppContext } from '../app/context';

type DeepReadonly<T> = T extends readonly (infer Item)[] ? readonly DeepReadonly<Item>[] :
  T extends object ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> } : T;

// Only call this on the newly constructed plain-data tree, never on live game objects.
function freezeCopy<T>(value: T): DeepReadonly<T> {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freezeCopy(child);
    Object.freeze(value);
  }
  return value as DeepReadonly<T>;
}

function readGame(context: AppContext) {
  const { character, camera, controls, environment, dayNight, engine, hudRoot, skyRoot, skyState, placement } = context;
  const clock = environment.dayNight!;
  const weather = environment.weather!;
  const motion = controls.entity.character!;
  const input = engine.input.movement();
  // Read the displayed toggle, not a public console getter that another script
  // could replace with a side-effecting function.
  const automatic = skyState?.weather.status === 'ready'
    ? skyRoot.querySelector('[aria-labelledby="change-weather-label"]')?.getAttribute('aria-checked') === 'true' : null;

  return freezeCopy({
    version: 1 as const,
    player: { position: character.position.toArray(), yaw: character.rotation.y },
    clock: { progress: clock.progress, cycleSeconds: clock.cycleSeconds, held: clock.held },
    weather: {
      mode: weather.mode, rainProgress: weather.rainProgress, cloudyProgress: weather.cloudyProgress,
      snowProgress: weather.snowProgress, rainAmount: weather.rainAmount, cloudyAmount: weather.cloudyAmount,
      snowAmount: weather.snowAmount,
    },
    phase: dayNight.getPhase(),
    nightAmount: dayNight.getNightAmount(),
    camera: {
      position: camera.position.toArray(), quaternion: camera.quaternion.toArray(), zoom: camera.zoom,
      left: camera.left, right: camera.right, top: camera.top, bottom: camera.bottom, near: camera.near, far: camera.far,
    },
    hud: {
      phaseLabel: hudRoot.querySelector('[data-phase]')?.textContent ?? null,
      skyEnabled: Boolean(skyState),
      skyPanelOpen: skyState ? skyRoot.querySelector<HTMLElement>('#sky-panel')?.hidden === false : false,
      weatherAutomatic: automatic,
      placement: {
        active: placement.isActive(), removing: placement.isRemoving(),
        status: document.querySelector('.placement-status')?.textContent ?? null,
      },
    },
    route: {
      status: motion.target ? 'following' as const : input.active ? 'manual' as const : 'idle' as const,
      target: motion.target ? [...motion.target] : null,
      waypoints: (motion.waypoints ?? []).map((point) => [...point]),
      input: { active: input.active, forward: input.forward, right: input.right },
    },
  });
}

export type GameSnapshot = ReturnType<typeof readGame>;

declare global {
  interface Window {
    readonly __game?: GameSnapshot;
  }
}

/** Install a getter, not a live reference or a command surface. */
export function registerGameInspection(context: AppContext) {
  if (new URLSearchParams(window.location.search).get('qa') !== '1') return;
  Object.defineProperty(window, '__game', {
    configurable: false,
    enumerable: false,
    get: () => readGame(context),
  });
}
