import type { TextStyle } from 'react-native';

/**
 * ngl-inspired palette: hot pink → orange brand gradient, warm blush neutrals,
 * near-black "ink" for outlines and 3D ledges, white cards.
 */
export const colors = {
  // brand
  pink: '#ED1980',
  hotPink: '#FF4079',
  orange: '#FE831B',
  magenta: '#9E0F52', // ledge under brand-gradient buttons
  peach: '#FFD3B8',
  blush: '#FFE4EE',
  cream: '#FFF6F0',
  // neutrals
  ink: '#141014',
  inkSoft: '#2B2228',
  muted: '#8A7A84',
  mutedSoft: '#C2B3BC',
  line: '#F3D3E0', // soft pink outline for fields inside cards
  hairline: '#EAD9E1',
  surface: '#ffffff',
  surfaceDim: '#FFF1F5',
  backdrop: '#FFF1EC',
  // status
  green: '#18B65B',
  greenSoft: '#DDF7E7',
  red: '#FF3B47',
  amber: '#FFB020',
  scrim: 'rgba(20,16,20,0.45)',
} as const;

type Stops = readonly [string, string, ...string[]];

export const gradients = {
  /** the ngl gradient: vertical (180deg) hot pink → orange */
  brand: [colors.hotPink, colors.orange] as Stops,
  brandDeep: [colors.pink, colors.orange] as Stops,
  /** secondary ngl gradients — use sparingly for variety */
  fire: ['#FF008A', '#D30000'] as Stops,
  night: ['#2D0049', '#8E00E5'] as Stops,
  sunset: ['#FF4079', '#5403D9'] as Stops,
  /** soft page wash behind white cards */
  soft: ['#FFE6EF', '#FFF1E6', '#FFF8F2'] as Stops,
} as const;

/** Vertical start/end for LinearGradient (the ngl 180deg direction). */
export const VERTICAL = { start: { x: 0.5, y: 0 }, end: { x: 0.5, y: 1 } } as const;

export const radii = {
  sm: 12,
  md: 16,
  lg: 22,
  xl: 30,
  sheet: 36,
  pill: 999,
} as const;

export const spacing = {
  xxs: 4,
  xs: 8,
  sm: 12,
  md: 16,
  lg: 20,
  xl: 28,
  xxl: 40,
} as const;

/** 3D depth: the solid "ledge" under chunky things, and the outline that wraps them. */
export const depth = {
  card: 6,
  button: 5,
  chip: 4,
  sticker: 3,
  border: 2,
} as const;

/** A solid ink ledge plus a soft warm drop shadow, as a boxShadow string. */
export function ledge(d: number = depth.card, color: string = colors.ink, soft = true) {
  const solid = `0px ${d}px 0px 0px ${color}`;
  return soft ? `${solid}, 0px ${d + 10}px 24px 0px rgba(158,15,82,0.16)` : solid;
}

export const shadows = {
  soft: '0px 10px 28px rgba(158,15,82,0.14)',
  lifted: '0px 16px 40px rgba(158,15,82,0.22)',
  chip: '0px 4px 12px rgba(158,15,82,0.10)',
} as const;

/**
 * Font families (loaded in the root layout). Custom fonts on iOS pick the face by
 * family name, so never combine these with fontWeight.
 */
export const fonts = {
  display: 'Baloo2_800ExtraBold',
  regular: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
  heavy: 'Inter_800ExtraBold',
  black: 'Inter_900Black',
} as const;

/**
 * Chunky rounded display (Baloo 2) + Inter body; all copy is lowercase by convention.
 *
 * lineHeights leave room for emoji: on iOS a lineHeight below the font's natural line
 * height trims the top of the line, and emoji sit taller than Baloo's caps. Baloo is
 * 1.6em natural, so heading/title (the ones that carry "📍 hackney"-style emoji) are
 * at ~1.6em; the bigger sizes stay tighter and `Txt`/`emojiRoom` bump them when the
 * text actually contains an emoji. Inter tokens get explicit ~1.4em for headroom.
 */
export const type = {
  hero: { fontFamily: fonts.display, fontSize: 42, lineHeight: 52, letterSpacing: -0.8, color: colors.ink },
  display: { fontFamily: fonts.display, fontSize: 32, lineHeight: 42, letterSpacing: -0.6, color: colors.ink },
  title: { fontFamily: fonts.display, fontSize: 22, lineHeight: 36, letterSpacing: -0.3, color: colors.ink },
  heading: { fontFamily: fonts.display, fontSize: 20, lineHeight: 33, letterSpacing: -0.2, color: colors.ink },
  body: { fontFamily: fonts.semibold, fontSize: 16, lineHeight: 22, letterSpacing: -0.2, color: colors.ink },
  label: { fontFamily: fonts.bold, fontSize: 15, lineHeight: 21, letterSpacing: -0.2, color: colors.ink },
  caption: { fontFamily: fonts.semibold, fontSize: 13, lineHeight: 19, color: colors.muted },
  stat: { fontFamily: fonts.display, fontSize: 24, lineHeight: 32, color: colors.ink },
} satisfies Record<string, TextStyle>;

export type TypeVariant = keyof typeof type;

/** Space reserved at the bottom of tab screens for the floating tab bar. */
export const TAB_BAR_CLEARANCE = 120;
