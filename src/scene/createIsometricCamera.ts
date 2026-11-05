import { OrthographicCamera, Vector3 } from 'three';

const VIEW_HEIGHT = 12;
const FOCUS_HEIGHT = 0.7;
// Equal offsets give a 45° azimuth and a 35.26° elevation.
const CAMERA_OFFSET = new Vector3(12, 12, 12);

export function createIsometricCamera() {
  const halfHeight = VIEW_HEIGHT / 2;
  const camera = new OrthographicCamera(-halfHeight, halfHeight, halfHeight, -halfHeight, 0.1, 100);
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
