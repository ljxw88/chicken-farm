// Runs in the browser via page.evaluate. A non-black, nontransparent mask pixel
// permits a difference; all other pixels remain part of the exact-RGBA gate.
export async function compareParityFrames({ reference, candidate, mask }) {
  async function decode(data) {
    const image = new Image();
    image.src = `data:image/png;base64,${data}`;
    await image.decode();
    return image;
  }
  const [a, b] = await Promise.all([decode(reference), decode(candidate)]);
  if (a.width !== b.width || a.height !== b.height) throw new Error('Frame dimensions differ');
  const canvas = document.createElement('canvas');
  canvas.width = a.width;
  canvas.height = a.height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(a, 0, 0);
  const original = context.getImageData(0, 0, a.width, a.height);
  context.clearRect(0, 0, a.width, a.height);
  context.drawImage(b, 0, 0);
  const current = context.getImageData(0, 0, a.width, a.height);
  let approved;
  if (mask) {
    const image = await decode(mask);
    if (image.width !== a.width || image.height !== a.height) throw new Error('Mask dimensions differ');
    context.clearRect(0, 0, a.width, a.height);
    context.drawImage(image, 0, 0);
    approved = context.getImageData(0, 0, a.width, a.height).data;
  }
  const result = context.createImageData(a.width, a.height);
  let changedPixels = 0;
  let outsideMaskPixels = 0;
  for (let i = 0; i < original.data.length; i += 4) {
    const changed = original.data[i] !== current.data[i] || original.data[i + 1] !== current.data[i + 1] ||
      original.data[i + 2] !== current.data[i + 2] || original.data[i + 3] !== current.data[i + 3];
    if (changed) {
      changedPixels++;
      const masked = approved && approved[i + 3] && (approved[i] || approved[i + 1] || approved[i + 2]);
      if (!masked) outsideMaskPixels++;
      result.data[i] = masked ? 0 : 255;
      result.data[i + 1] = masked ? 180 : 0;
      result.data[i + 2] = 255;
    }
    result.data[i + 3] = 255;
  }
  context.putImageData(result, 0, 0);
  return { changedPixels, outsideMaskPixels, width: a.width, height: a.height, png: canvas.toDataURL('image/png').split(',')[1] };
}
