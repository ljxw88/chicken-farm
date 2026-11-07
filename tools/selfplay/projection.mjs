import { OrthographicCamera, Vector3 } from 'three';

// Project a fixed world checkpoint using only the detached inspection snapshot.
export function projectCheckpoint(cameraState, point, viewport) {
  const { left, right, top, bottom, near, far, zoom, position, quaternion } = cameraState;
  const camera = new OrthographicCamera(left, right, top, bottom, near, far);
  camera.position.fromArray(position);
  camera.quaternion.fromArray(quaternion);
  camera.zoom = zoom;
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
  const projected = new Vector3(...point).project(camera);
  return { x: (projected.x + 1) * viewport.width / 2, y: (1 - projected.y) * viewport.height / 2 };
}
