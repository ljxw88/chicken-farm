import * as THREE from 'three';
import { buildRecipe, setRecipeNightAmount } from '/src/assets/buildRecipe.ts';
import { createScene, GROUND_HEIGHT } from '/src/scene/createScene.ts';
import { createFarmLayout } from '/src/scene/createFarmLayout.ts';
import { createPlacementVisual } from '/src/placement/createPlacementVisual.ts';
import { createCharacter } from '/src/character/createCharacter.ts';
import { createDayNightCycle } from '/src/lighting/createDayNightCycle.ts';
import { createComposer } from '/src/postprocess/index.ts';

// A review-only scene, never the runtime asset registry or placement state.
const { scene, camera, renderer, resize } = createScene(document.querySelector('#scene'));
const layout = createFarmLayout(scene);
const character = createCharacter();
character.position.set(-0.5, GROUND_HEIGHT, 2.6);
scene.add(character);
const fence = createPlacementVisual('fence');
fence.position.set(0, GROUND_HEIGHT, 4.1);
scene.add(fence);
const lighting = createDayNightCycle({ scene, character, windows: layout.windows, extraEmissives: layout.extraEmissives });
const subjects = (window.__assetShowcaseItems || []).map(({ recipe, x, z }) => {
  const subject = buildRecipe(recipe);
  subject.position.set(x, GROUND_HEIGHT, z);
  scene.add(subject);
  return subject;
});
const composer = createComposer(renderer, scene, camera);
resize();
composer.resize(innerWidth, innerHeight, devicePixelRatio);

function setView(yaw, phase) {
  const target = new THREE.Vector3(0, GROUND_HEIGHT + 0.7, 0);
  const angle = yaw * Math.PI / 180;
  camera.position.copy(target).add(new THREE.Vector3(Math.sin(angle) * Math.sqrt(288), 12, Math.cos(angle) * Math.sqrt(288)));
  camera.lookAt(target);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  lighting.setDayNightPhase(phase);
  subjects.forEach((subject) => setRecipeNightAmount(subject, phase === 'night' ? 1 : 0));
  composer.render();
}

window.__assetShowcase = { setView, count: subjects.length, pixel: () => composer.getState() };
setView(45, 'daytime');
