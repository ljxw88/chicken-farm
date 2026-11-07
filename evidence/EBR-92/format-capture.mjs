// Keep capture metadata readable without turning every ground sample into
// six separate diff lines. The arrays remain ordinary JSON.
export function formatCapture(report) {
  const samples = [];
  const text = JSON.stringify(report, (key, value) => {
    if (key !== 'groundSamples' || !Array.isArray(value)) return value;
    const index = samples.push(JSON.stringify(value)) - 1;
    return `__ebr92_ground_${index}__`;
  }, 2);
  return `${text.replace(/"__ebr92_ground_(\d+)__"/g, (_, index) => samples[Number(index)])}\n`;
}
