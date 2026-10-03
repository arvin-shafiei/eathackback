import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { colors, depth as depthTokens, ledge, radii, spacing } from './tokens';

type Props = {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Inner style (padding, gap). Defaults to generous padding. */
  contentStyle?: StyleProp<ViewStyle>;
  padded?: boolean;
  radius?: number;
  depth?: number;
  ledgeColor?: string;
  color?: string;
  /** Clip children to the rounded corners (photos, gradients). */
  clip?: boolean;
};

/** Big white rounded card with an ink outline, sitting on a solid 3D ledge. */
export function Card3D({
  children,
  style,
  contentStyle,
  padded = true,
  radius = radii.sheet,
  depth = depthTokens.card,
  ledgeColor = colors.ink,
  color = colors.surface,
  clip,
}: Props) {
  return (
    <View style={[styles.card, { borderRadius: radius, backgroundColor: color, boxShadow: ledge(depth, ledgeColor) }, style]}>
      <View
        style={[
          { borderRadius: radius - depthTokens.border },
          clip && styles.clip,
          padded && styles.pad,
          contentStyle,
        ]}>
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: depthTokens.border, borderColor: colors.ink, borderCurve: 'continuous' },
  clip: { overflow: 'hidden', flex: 1 },
  pad: { padding: spacing.lg },
});
