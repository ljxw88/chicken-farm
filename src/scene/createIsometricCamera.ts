import { OrthographicCamera, Vector3 } from 'three';
import { CAMERA } from '../content/camera';

// The initial view includes the island's raised cross-section and the void.
const VIEW_HEIGHT = CAMERA.viewHeight;
const FOCUS_HEIGHT = CAMERA.focusHeight;
// Equal offsets give a 45° azimuth and a 35.26° elevation.
const CAMERA_OFFSET = new Vector3(...CAMERA.offset);

export function createIsometricCamera() {
  const halfHeight = VIEW_HEIGHT / 2;
  const camera = new OrthographicCamera(-halfHeight, halfHeight, halfHeight, -halfHeight, CAMERA.near, CAMERA.far);
  const focus = new Vector3();

  function follow(position: Vector3) {
    focus.copy(position);
    focus.y += FOCUS_HEIGHT;
    camera.position.copy(focus).add(CAMERA_OFFSET);
    camera.lookAt(focus);
  }

  function resize(width: number, height: number) {
    const halfHeight = VIEW_HEIGHT / 2;
    const halfWidth = halfHeight * (width / Math.max(height, 1));
    camera.left = -halfWidth;
    camera.right = halfWidth;
    camera.top = halfHeight;
    camera.bottom = -halfHeight;
    camera.updateProjectionMatrix();
  }

  follow(new Vector3());

  return { camera, follow, resize };
}
