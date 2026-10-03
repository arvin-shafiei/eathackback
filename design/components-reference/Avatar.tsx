import { Image } from 'expo-image';
import { SymbolView } from 'expo-symbols';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { colors, depth, ledge } from './tokens';

type Props = {
  uri?: string | null;
  /** Width in points; the pill is 1.4x as tall as it is wide. */
  width?: number;
  outlined?: boolean;
  /** Plain round avatar (tab bar, stacks) instead of the tall pill. */
  round?: boolean;
  /** Solid ink ledge under the outline. Defaults on for big avatars. */
  raised?: boolean;
  style?: StyleProp<ViewStyle>;
};

/** Tall oval "pill" avatar with an ink outline and (for big ones) a 3D ledge. */
export function Avatar({ uri, width = 96, outlined = true, round, raised, style }: Props) {
  const height = round ? width : Math.round(width * 1.4);
  const lifted = raised ?? (outlined && width >= 72);
  const radius = width / 2;
  return (
    <View
      style={[
        { width, height, borderRadius: radius },
        outlined && styles.outline,
        lifted && { boxShadow: ledge(width >= 100 ? depth.card : depth.chip) },
        style,
      ]}>
      <View style={[styles.clip, { borderRadius: radius }]}>
        {uri ? (
          <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} />
        ) : (
          <SymbolView name="person.fill" size={width * 0.38} tintColor={colors.pink} />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  clip: {
    flex: 1,
    overflow: 'hidden',
    backgroundColor: colors.blush,
    alignItems: 'center',
    justifyContent: 'center',
  },
  outline: { borderWidth: 2.5, borderColor: colors.ink, backgroundColor: colors.blush },
});
