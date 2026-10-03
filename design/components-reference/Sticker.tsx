import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { VERTICAL, colors, depth, fonts, gradients, ledge, radii } from './tokens';

export type StickerTone = 'light' | 'dark' | 'green' | 'brand';

type Props = { label: string; emoji?: string; tone?: StickerTone; style?: StyleProp<ViewStyle> };

const TONES: Record<StickerTone, { bg: string; fg: string }> = {
  light: { bg: colors.surface, fg: colors.ink },
  dark: { bg: colors.ink, fg: colors.surface },
  green: { bg: colors.greenSoft, fg: '#0B6B34' },
  brand: { bg: colors.hotPink, fg: colors.surface },
};

/** Small outlined capsule on a mini ledge — city pill, "🔓 open" badge, map markers. */
export function Sticker({ label, emoji, tone = 'light', style }: Props) {
  const t = TONES[tone];
  return (
    <View style={[styles.base, { backgroundColor: t.bg }, style]}>
      {tone === 'brand' ? (
        <LinearGradient colors={gradients.brand} {...VERTICAL} style={[StyleSheet.absoluteFill, styles.grad]} />
      ) : null}
      <Text style={[styles.label, { color: t.fg }]} numberOfLines={2}>
        {emoji ? `${emoji} ` : ''}
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    alignSelf: 'flex-start',
    paddingHorizontal: 11,
    paddingVertical: 5,
    marginBottom: depth.sticker,
    borderRadius: radii.pill,
    borderWidth: depth.border,
    borderColor: colors.ink,
    boxShadow: ledge(depth.sticker, colors.ink, false),
  },
  grad: { borderRadius: radii.pill },
  // explicit ~1.4em lineHeight leaves room above Inter's caps for the emoji
  label: { fontFamily: fonts.heavy, fontSize: 13, lineHeight: 18, letterSpacing: -0.2 },
});
