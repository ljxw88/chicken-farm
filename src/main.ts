import './style.css';
import './ui/farmHud.css';
import { CHARACTER_RADIUS, createCharacter, createCharacterController } from './character';
import { createEngine } from './core/loop';
import { createChimneySmoke } from './effects/createChimneySmoke';
import { createFireflies } from './effects/createFireflies';
import { createVisualRandom } from './effects/createVisualRandom';
import { createDayNightState, createWeatherState, updateDayNightSystem, updateWeatherSystem,
  type DayNightComponents, type WeatherComponents } from './environment';
import { createDayNightCycle, type DayNightPhaseName } from './lighting';
import { createPlacementAdapter, type PlacementComponents } from './placement';
import { createComposer, isPixelRenderingEnabled, type PixelRenderingState } from './postprocess';
import { createFarmDecorations } from './scene/createFarmDecorations';
import { createFarmLayout } from './scene/createFarmLayout';
import { createFarmShadows } from './scene/createFarmShadows';
import { createScene, GROUND_HEIGHT, GROUND_SIZE } from './scene/createScene';
import { createSheepfold } from './scene/sheepfold/createSheepfold';
import { WATER_FEATURE } from './scene/waterFeatureSpec';
import { createStartupPhaseController, parseSheepSeed, parseStartupOptions, parseVisualSeed } from './startupOptions';
import { createFarmHud } from './ui';
import { createWeatherSystem, type WeatherMode } from './weather';

interface GameComponents extends PlacementComponents, DayNightComponents, WeatherComponents {}

declare global {
  interface Window {
    setDayNightCycleSeconds: (seconds: number) => void;
    setDayNightPhase: (phase: DayNightPhaseName) => void;
    setPixelRendering: (enabled: boolean) => void;
    setPixelSize: (cssPixels: number) => void;
    getPixelRendering: () => PixelRenderingState;
    setWeather: (mode: WeatherMode) => void;
    getWeather: () => { mode: WeatherMode; rainAmount: number; cloudyAmount: number };
  }
}

const canvas = document.querySelector<HTMLCanvasElement>('#scene');
const hudRoot = document.querySelector<HTMLElement>('#farm-hud');

if (!canvas) {
  throw new Error('Scene canvas not found');
}
if (!hudRoot) {
  throw new Error('Farm HUD root not found');
}

const { scene, camera, renderer, ground, stairs, follow, resize } = createScene(canvas);
const character = createCharacter();
character.position.y = GROUND_HEIGHT;
scene.add(character);
follow(character.position);
const { windows, extraEmissives, obstacles, splashExclusions, bridgeHeight, updateWaterfall } = createFarmLayout(scene);
const sheepfold = createSheepfold(scene, parseSheepSeed(window.location.search));
obstacles.push(...sheepfold.obstacles);
const decorations = createFarmDecorations(scene, GROUND_HEIGHT);
const farmShadows = createFarmShadows(scene);
const engine = createEngine<GameComponents>({
  setAnimationLoop: (callback) => renderer.setAnimationLoop(callback),
  input: { target: window, canvas, ownMovement: true, ownPlacement: true,
    getPlacement: () => ({ active: placement.isActive(), removing: placement.isRemoving() }) },
  frameSystems: [
    (world, move, deltaSeconds) => controls.system(world, move, Math.min(deltaSeconds, 0.1)),
    (world, _move, deltaSeconds) => {
      updateDayNightSystem(world, deltaSeconds);
      if (!environment.dayNight!.held) dayNight.applyState();
      dayNight.updateCharacterShadow();
      farmHud.setPhase(dayNight.getPhase());
      follow(character.position);
      placement.update();
      updateWeatherSystem(world, deltaSeconds);
      weather.render(deltaSeconds);
      const { rainAmount, cloudyAmount } = weather.getWeather();
      const nightAmount = dayNight.getNightAmount();
      smoke.update(deltaSeconds, rainAmount, nightAmount);
      fireflies.update(deltaSeconds, nightAmount, rainAmount, cloudyAmount);
      updateWaterfall(deltaSeconds);
      sheepfold.update(deltaSeconds);
    },
  ],
  beforeFrame() {
    // Moving a window between displays can change DPR without a resize event.
    if (window.devicePixelRatio !== lastDevicePixelRatio) handleResize();
  },
  render: (deltaSeconds) => composer.render(deltaSeconds),
});
const environment = engine.world.create({ dayNight: createDayNightState(), weather: createWeatherState() });
function shadowSupported(x: number, z: number, radius: number) {
  // The character's blob must not float off a raised bridge deck onto water.
  if (bridgeHeight(character.position.x, character.position.z) !== undefined) {
    const { bridge } = WATER_FEATURE;
    return x - radius >= bridge.x - bridge.length / 2 && x + radius <= bridge.x + bridge.length / 2 &&
      z - radius >= bridge.z - bridge.width / 2 && z + radius <= bridge.z + bridge.width / 2;
  }
  return stairs.supports(x, z, radius);
}
const dayNight = createDayNightCycle({
  scene, character, windows, extraEmissives, shadowSupported, state: environment.dayNight,
  updateFarmShadows(awayX, awayZ, offset, strength) {
    farmShadows.update(awayX, awayZ, offset, strength);
    sheepfold.updateShadows(awayX, awayZ, offset, strength);
  },
});
const visualSeed = parseVisualSeed(window.location.search);
const weather = createWeatherSystem({
  ...(visualSeed === undefined ? {} : { random: createVisualRandom(visualSeed) }),
  scene, camera, anchor: character, groundHeight: GROUND_HEIGHT, groundSize: GROUND_SIZE,
  state: environment.weather,
  splashExclusions, setDirectionalIntensityMultiplier: dayNight.setDirectionalIntensityMultiplier,
  setAmbientHemisphereColorMultiplier: dayNight.setAmbientHemisphereColorMultiplier,
  setShadowWeather: dayNight.setShadowWeather,
});
const smoke = createChimneySmoke({ scene,
  random: visualSeed === undefined ? undefined : createVisualRandom(visualSeed ^ 0x534d4f4b) });
const fireflies = createFireflies({ scene, camera, groundHeight: GROUND_HEIGHT,
  random: visualSeed === undefined ? undefined : createVisualRandom(visualSeed ^ 0x464c4945) });
const startup = parseStartupOptions(window.location.search);
const phaseController = createStartupPhaseController(dayNight, startup.phase);
if (startup.weather) weather.setWeather(startup.weather);
export const setDayNightCycleSeconds = phaseController.setDayNightCycleSeconds;
export const setDayNightPhase = phaseController.setDayNightPhase;
export const setWeather = weather.setWeather;
export const getWeather = weather.getWeather;
window.setDayNightCycleSeconds = setDayNightCycleSeconds;
window.setDayNightPhase = setDayNightPhase;
window.setWeather = setWeather;
window.getWeather = getWeather;
const controls = createCharacterController({
  world: engine.world, input: engine.input, character, camera, canvas, ground,
  groundSize: GROUND_SIZE, groundHeight: GROUND_HEIGHT, characterRadius: CHARACTER_RADIUS,
  obstacles, stairs, bridgeHeight, groundShadow: character.getObjectByName('character-shadow'),
});
const placement = createPlacementAdapter({
  world: engine.world, input: engine.input,
  scene, camera, canvas, ground, groundSize: GROUND_SIZE, groundHeight: GROUND_HEIGHT,
  obstacles, syncObstacles: controls.syncObstacles, syncCharacter: controls.syncExternalPose,
  getBlockers: () => decorations,
  debugGrid: new URLSearchParams(window.location.search).get('grid') === '1',
  onActiveChange(active) {
    if (active) controls.cancelTarget();
  },
});
const farmHud = createFarmHud({ root: hudRoot, initialPhase: dayNight.getPhase() });
const composer = createComposer(renderer, scene, camera);
window.setPixelRendering = composer.setEnabled;
window.setPixelSize = composer.setPixelSize;
window.getPixelRendering = composer.getState;

let lastDevicePixelRatio = window.devicePixelRatio;

function handleResize() {
  resize();
  composer.resize(window.innerWidth, window.innerHeight, window.devicePixelRatio);
  lastDevicePixelRatio = window.devicePixelRatio;
}

handleResize();
// The default stays on; ?pixel=0 is a console-free native comparison.
if (!isPixelRenderingEnabled(window.location.search)) composer.setEnabled(false);
window.addEventListener('resize', handleResize);

engine.start();
