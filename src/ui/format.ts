function withUnit(value: number, unit: string) {
  return `${value} ${unit}${value === 1 ? '' : 's'}`;
}

export function formatFarmDayLength(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  // Avoid floating point noise without rounding tiny valid durations down to zero.
  const remainder = Number((seconds % 60).toPrecision(8));
  const duration = minutes > 0
    ? `${withUnit(minutes, 'minute')}${remainder > 0 ? ` ${withUnit(remainder, 'second')}` : ''}`
    : withUnit(remainder, 'second');
  return `One farm day lasts ${duration}`;
}
