// Look Dev LOCKED the EBR-40 relative gains, not new hex colors.
// Apply gains in linear color space to each current day/night phase's own colors.
export const CLOUDY_LOOK = {
  directionalMultiplier: 0.72,
  ambientHemisphereColorGains: { red: 0.86, green: 0.96, blue: 1.08 },
} as const;
