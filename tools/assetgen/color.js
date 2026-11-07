// CIE76 ΔE using IEC sRGB transfer and D65 reference white. Screen-space
// contrast is evidence, not a substitute for Look Dev's semantic review.
export function srgbLinear(channel) {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

export function luminanceRGB(r, g, b) {
  return 0.2126 * srgbLinear(r) + 0.7152 * srgbLinear(g) + 0.0722 * srgbLinear(b);
}

export function labRGB(r, g, b) {
  const red = srgbLinear(r), green = srgbLinear(g), blue = srgbLinear(b);
  const x = (0.4124564 * red + 0.3575761 * green + 0.1804375 * blue) / 0.95047;
  const y = (0.2126729 * red + 0.7151522 * green + 0.0721750 * blue);
  const z = (0.0193339 * red + 0.1191920 * green + 0.9503041 * blue) / 1.08883;
  const f = (value) => value > 216 / 24389 ? Math.cbrt(value) : (24389 / 27 * value + 16) / 116;
  const fx = f(x), fy = f(y), fz = f(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

export function deltaE76(a, b) {
  const left = labRGB(...a), right = labRGB(...b);
  return Math.hypot(left[0] - right[0], left[1] - right[1], left[2] - right[2]);
}
