export interface PixelViewport {
  displayWidth: number;
  displayHeight: number;
  targetWidth: number;
  targetHeight: number;
  pixelSize: number;
  cropLeft: number;
  cropRight: number;
  cropBottom: number;
  cropTop: number;
}

// The requested size is in CSS pixels; the presentation grid is in device pixels.
export function calculatePixelViewport(
  width: number,
  height: number,
  pixelRatio: number,
  cssPixelSize: number,
): PixelViewport {
  // Cover fractional device-pixel viewport edges rather than exposing the body.
  const displayWidth = Math.max(0, Math.ceil(width));
  const displayHeight = Math.max(0, Math.ceil(height));
  const pixelSize = Math.max(1, Math.round(cssPixelSize * pixelRatio));
  const targetWidth = Math.max(1, Math.ceil(displayWidth / pixelSize));
  const targetHeight = Math.max(1, Math.ceil(displayHeight / pixelSize));
  const extraWidth = targetWidth * pixelSize - displayWidth;
  const extraHeight = targetHeight * pixelSize - displayHeight;
  const cropLeft = Math.floor(extraWidth / 2);
  const cropBottom = Math.floor(extraHeight / 2);

  return {
    displayWidth,
    displayHeight,
    targetWidth,
    targetHeight,
    pixelSize,
    cropLeft,
    cropRight: extraWidth - cropLeft,
    cropBottom,
    cropTop: extraHeight - cropBottom,
  };
}
