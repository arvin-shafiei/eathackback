import { ActivityIndicator, StyleSheet, Text, type StyleProp, type ViewStyle } from 'react-native';
import { Press3D } from './Press3D';
import { emojiRoom } from './emoji';
import { colors, depth, fonts, gradients, radii } from './tokens';

export type ChunkyTone = 'brand' | 'ink' | 'white';

type Props = {
  label: string;
  onPress?: () => void;
  emoji?: string;
  /** brand = pink→orange gradient; ink = black with a pink ledge; white = white with an ink ledge. */
  tone?: ChunkyTone;
  loading?: boolean;
  disabled?: boolean;
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
};

const TONES: Record<ChunkyTone, { fg: string; face?: string; ledge: string }> = {
  brand: { fg: colors.surface, ledge: colors.magenta },
  ink: { fg: colors.surface, face: colors.ink, ledge: colors.pink },
  white: { fg: colors.ink, face: colors.surface, ledge: colors.ink },
};

/** Full-width chunky capsule button with a 3D ledge; squishes down on press. */
export function ChunkyButton({ label, onPress, emoji, tone = 'ink', loading, disabled, compact, style }: Props) {
  const t = TONES[tone];
  const inactive = disabled || loading;
  const labelStyle = [styles.label, compact && styles.labelCompact, { color: t.fg }];
  return (
    <Press3D
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!inactive, busy: !!loading }}
      onPress={onPress}
      disabled={inactive}
      radius={radii.pill}
      depth={compact ? depth.chip : depth.button}
      ledgeColor={t.ledge}
      color={t.face}
      gradient={tone === 'brand' ? gradients.brand : undefined}
      style={style}
      faceStyle={[styles.face, compact && styles.compact]}>
      {loading ? (
        <ActivityIndicator color={t.fg} />
      ) : (
        <Text style={[labelStyle, emojiRoom(labelStyle, `${emoji ?? ''}${label}`)]} numberOfLines={1}>
          {emoji ? `${emoji} ` : ''}
          {label}
        </Text>
      )}
    </Press3D>
  );
}

const styles = StyleSheet.create({
  face: { height: 58, paddingHorizontal: 24 },
  compact: { height: 46, paddingHorizontal: 18 },
  label: { fontFamily: fonts.display, fontSize: 20, lineHeight: 26, letterSpacing: -0.2 },
  labelCompact: { fontSize: 17, lineHeight: 22 },
});
