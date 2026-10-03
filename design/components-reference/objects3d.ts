/**
 * Glossy 3D decoration objects. Placeholders borrowed from ngl.link until we
 * render our own — see assets/images/3d/README.md.
 */
export const objects3d = {
  drink: require('../../assets/images/3d/drink.webp'),
  wave: require('../../assets/images/3d/wave.webp'),
  crown: require('../../assets/images/3d/crown.webp'),
  heart: require('../../assets/images/3d/heart.webp'),
  cloud: require('../../assets/images/3d/cloud.webp'),
  gummy: require('../../assets/images/3d/gummy.webp'),
} as const;

export type Object3DName = keyof typeof objects3d;
