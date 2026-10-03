import { StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { emojiLineHeight, hasEmoji } from './emoji';
import { colors, fonts } from './tokens';

type Props = {
  children: string;
  size?: number;
  /** Outline thickness; defaults to ~10% of the font size. */
  stroke?: number;
  /** Extra outline pushed straight down for a 3D ledge. */
  depth?: number;
  color?: string;
  outline?: string;
  /** Degrees; a slight tilt makes it feel stuck on. */
  tilt?: number;
  align?: TextStyle['textAlign'];
  style?: StyleProp<ViewStyle>;
};

const RING = 16;

/**
 * ngl-style sticker type: chunky white display text with a thick black outline.
 * iOS has no text stroke, so the outline is a ring of offset copies behind the fill.
 */
export function StickerTitle({
  children,
  size = 48,
  stroke,
  depth,
  color = colors.surface,
  outline = colors.ink,
  tilt = 0,
  align = 'left',
  style,
}: Props) {
  const s = stroke ?? Math.max(2, Math.round(size * 0.1));
  const d = depth ?? Math.round(size * 0.08);
  const text: TextStyle = {
    fontFamily: fonts.display,
    fontSize: size,
    // Baloo's 1.18em is snug for letters but clips emoji, which need the full line
    lineHeight: hasEmoji(children) ? emojiLineHeight(size, fonts.display) : Math.round(size * 1.18),
    letterSpacing: -size * 0.01,
    textAlign: align,
  };

  const offsets: [number, number][] = [];
  for (let i = 0; i < RING; i++) {
    const a = (i / RING) * Math.PI * 2;
    offsets.push([Math.cos(a) * s, Math.sin(a) * s]);
  }
  // the ledge: the same ring again, shifted down
  const ledgeOffsets = d > 0 ? offsets.filter(([, dy]) => dy >= 0).map(([dx, dy]) => [dx, dy + d] as [number, number]) : [];

  return (
    <View
      accessible
      accessibilityRole="header"
      accessibilityLabel={children}
      style={[{ padding: s, paddingBottom: s + d, transform: [{ rotate: `${tilt}deg` }] }, style]}>
      <View style={StyleSheet.absoluteFill} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {[...ledgeOffsets, ...offsets].map(([dx, dy], i) => (
          <Text
            key={i}
            style={[text, styles.copy, { color: outline, left: s + dx, right: s - dx, top: s + dy }]}>
            {children}
          </Text>
        ))}
      </View>
      <Text style={[text, { color }]} importantForAccessibility="no">
        {children}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({ copy: { position: 'absolute' } });
