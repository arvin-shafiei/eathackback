import { SymbolView, type SFSymbol } from 'expo-symbols';
import type { StyleProp, ViewStyle } from 'react-native';
import { Press3D } from './Press3D';
import { colors, depth, gradients } from './tokens';

type Props = {
  symbol: SFSymbol;
  onPress?: () => void;
  size?: number;
  /** light = white on ink ledge; dark = ink on pink ledge; brand = gradient; plain = no chrome. */
  tone?: 'light' | 'dark' | 'brand' | 'plain';
  tint?: string;
  accessibilityLabel: string;
  style?: StyleProp<ViewStyle>;
};

/** Round chunky 3D button with an SF Symbol. `size` is the face; the ledge adds a few points below. */
export function IconCircleButton({ symbol, onPress, size = 44, tone = 'light', tint, accessibilityLabel, style }: Props) {
  const fg = tint ?? (tone === 'light' || tone === 'plain' ? colors.ink : colors.surface);
  const d = size >= 60 ? depth.button : depth.chip;
  return (
    <Press3D
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      hitSlop={6}
      radius={size / 2}
      depth={d}
      flat={tone === 'plain'}
      color={tone === 'dark' ? colors.ink : colors.surface}
      ledgeColor={tone === 'dark' ? colors.pink : tone === 'brand' ? colors.magenta : colors.ink}
      gradient={tone === 'brand' ? gradients.brand : undefined}
      style={style}
      faceStyle={{ width: size, height: size }}>
      <SymbolView name={symbol} size={size * 0.42} tintColor={fg} weight="bold" />
    </Press3D>
  );
}
