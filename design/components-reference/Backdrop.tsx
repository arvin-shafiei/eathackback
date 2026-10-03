import { LinearGradient } from 'expo-linear-gradient';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { VERTICAL, colors, gradients } from './tokens';

type Props = {
  /** soft = blush wash behind white cards; brand = full pink→orange (sign-in). */
  variant?: 'soft' | 'brand';
  /** Paint a brand-gradient header band of this height (profile) over the soft wash. */
  headerHeight?: number;
  /** Decorations (Floaty3D) drawn above the background but behind the content. */
  decor?: ReactNode;
  children?: ReactNode;
};

/** Screen background: soft blush wash, full brand gradient, or wash + gradient header. */
export function Backdrop({ variant = 'soft', headerHeight, decor, children }: Props) {
  const brand = variant === 'brand';
  return (
    <View style={[styles.root, brand && { backgroundColor: colors.hotPink }]}>
      <LinearGradient colors={brand ? gradients.brand : gradients.soft} {...VERTICAL} style={StyleSheet.absoluteFill} />
      {headerHeight ? (
        <View style={[styles.header, { height: headerHeight }]}>
          <LinearGradient colors={gradients.brand} {...VERTICAL} style={StyleSheet.absoluteFill} />
        </View>
      ) : null}
      {decor ? (
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          {decor}
        </View>
      ) : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.backdrop },
  header: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    overflow: 'hidden',
    borderBottomLeftRadius: 44,
    borderBottomRightRadius: 44,
    borderCurve: 'continuous',
  },
});
