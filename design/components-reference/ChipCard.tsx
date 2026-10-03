import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Press3D } from './Press3D';
import { colors, depth, fonts, ledge, radii, spacing } from './tokens';

type Props = { emoji: string; label: string; value?: string | number; onPress?: () => void };

/** Small chunky white card on a ledge: "🍾 3 posted". Pressable when given onPress. */
export function ChipCard({ emoji, label, value, onPress }: Props) {
  const body = (
    <>
      <Text style={styles.emoji}>{emoji}</Text>
      <Text style={styles.label} numberOfLines={1}>
        {value !== undefined ? <Text style={styles.value}>{value} </Text> : null}
        {label}
      </Text>
    </>
  );
  if (onPress) {
    return (
      <Press3D
        accessibilityRole="button"
        accessibilityLabel={`${value ?? ''} ${label}`.trim()}
        onPress={onPress}
        radius={radii.lg}
        depth={depth.chip}
        faceStyle={styles.face}>
        {body}
      </Press3D>
    );
  }
  return <View style={[styles.face, styles.static]}>{body}</View>;
}

export function ChipRow({ children }: { children: React.ReactNode }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row} style={styles.scroll}>
      {children}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  face: {
    minWidth: 100,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    gap: 4,
    alignItems: 'flex-start',
  },
  static: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderCurve: 'continuous',
    borderWidth: depth.border,
    borderColor: colors.ink,
    boxShadow: ledge(depth.chip, colors.ink, false),
  },
  emoji: { fontSize: 24, lineHeight: 32 },
  label: { fontFamily: fonts.bold, fontSize: 14, lineHeight: 28, color: colors.muted },
  value: { fontFamily: fonts.display, fontSize: 17, color: colors.ink },
  scroll: { marginHorizontal: -spacing.lg, overflow: 'visible' },
  row: { gap: spacing.xs, paddingHorizontal: spacing.lg, paddingTop: 4, paddingBottom: 10 },
});
