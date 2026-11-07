import { WATER_FEATURE } from '../content/waterFeature';
import type { EntityWorld } from '../core/ecs';
import { createVisualRandom } from '../effects/createVisualRandom';
import { createDayNightState, createWeatherState, updateDayNightSystem, updateWeatherSystem } from '../environment';
import { createDayNightCycle } from '../lighting';
import { GROUND_HEIGHT, GROUND_SIZE } from '../scene/createScene';
import { parseVisualSeed } from '../startupOptions';
import { createWeatherSystem } from '../weather';
import type { AppContext, GameComponents } from './context';

export function registerEnvironment(context: AppContext) {
  const { scene, camera, character, windows, extraEmissives, stairs, bridgeHeight, farmShadows, sheepfold, garden } = context;
  const environment = context.engine.world.create({ dayNight: createDayNightState(), weather: createWeatherState() });
  context.environment = environment;
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
      garden.updateShadows(awayX, awayZ, offset, strength);
    },
  });
  context.dayNight = dayNight;
  const visualSeed = parseVisualSeed(window.location.search);
  context.visualSeed = visualSeed;
  const weather = createWeatherSystem({
    ...(visualSeed === undefined ? {} : { random: createVisualRandom(visualSeed) }),
    scene, camera, anchor: character, groundHeight: GROUND_HEIGHT, groundSize: GROUND_SIZE,
    state: environment.weather,
    splashExclusions: context.splashExclusions, setDirectionalIntensityMultiplier: dayNight.setDirectionalIntensityMultiplier,
    setAmbientHemisphereColorMultiplier: dayNight.setAmbientHemisphereColorMultiplier,
    setShadowWeather: dayNight.setShadowWeather,
  });
  context.weather = weather;
}

export function updateClockFrame(context: AppContext, world: EntityWorld<GameComponents>, deltaSeconds: number) {
  updateDayNightSystem(world, context.phaseController.frameDelta(deltaSeconds));
  if (!context.environment.dayNight!.held) context.dayNight.applyState();
  context.dayNight.updateCharacterShadow();
  context.farmHud.setPhase(context.dayNight.getPhase());
}

export function updateWeatherFrame(context: AppContext, world: EntityWorld<GameComponents>, deltaSeconds: number) {
  updateWeatherSystem(world, deltaSeconds);
  context.weather.render(deltaSeconds);
}
