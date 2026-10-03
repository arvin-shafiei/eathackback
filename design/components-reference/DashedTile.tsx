import { Pressable, StyleSheet, Text } from 'react-native';
import { hasEmoji } from './emoji';
import { colors, fonts, radii } from './tokens';

type Props = { label?: string; emoji?: string; onPress?: () => void; size?: number };

/** Dashed pink placeholder tile ("post a pres"). */
export function DashedTile({ label, emoji = '+', onPress, size = 104 }: Props) {
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      style={({ pressed }) => [styles.tile, { width: size, height: size * 1.2 }, pressed && styles.pressed]}>
      <Text style={hasEmoji(emoji) ? styles.realEmoji : styles.emoji}>{emoji}</Text>
      {label ? <Text style={styles.label}>{label}</Text> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tile: {
    borderRadius: radii.lg,
    borderCurve: 'continuous',
    borderWidth: 2.5,
    borderStyle: 'dashed',
    borderColor: colors.hotPink,
    backgroundColor: 'rgba(255,64,121,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    padding: 8,
  },
  pressed: { transform: [{ scale: 0.96 }] },
  emoji: { fontFamily: fonts.display, fontSize: 28, lineHeight: 34, color: colors.pink },
  // real emoji render in the system font with full line room (Baloo's tight line clips them)
  realEmoji: { fontSize: 28, lineHeight: 38 },
  label: { fontFamily: fonts.heavy, fontSize: 12, color: colors.pink, textAlign: 'center' },
});
