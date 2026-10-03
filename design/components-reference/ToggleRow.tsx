import { StyleSheet, Switch, Text, View } from 'react-native';
import { colors, depth, ledge, radii, spacing, type } from './tokens';

type Props = { label: string; emoji?: string; hint?: string; value: boolean; onValueChange: (v: boolean) => void };

export function ToggleRow({ label, emoji, hint, value, onValueChange }: Props) {
  return (
    <View style={[styles.row, value && styles.on]}>
      <View style={styles.text}>
        <Text style={type.label}>
          {emoji ? `${emoji} ` : ''}
          {label}
        </Text>
        {hint ? <Text style={type.caption}>{hint}</Text> : null}
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{ true: colors.pink, false: colors.hairline }}
        accessibilityLabel={label}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    marginBottom: depth.chip,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderCurve: 'continuous',
    borderWidth: depth.border,
    borderColor: colors.ink,
    boxShadow: ledge(depth.chip, colors.ink, false),
  },
  on: { backgroundColor: colors.blush, boxShadow: ledge(depth.chip, colors.pink, false) },
  text: { flex: 1, gap: 2 },
});
