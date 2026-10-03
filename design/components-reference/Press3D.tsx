import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { VERTICAL, colors, depth as depthTokens } from './tokens';

export type Press3DProps = Omit<PressableProps, 'style' | 'children'> & {
  children: ReactNode;
  radius: number;
  /** Height of the solid ledge under the face. */
  depth?: number;
  ledgeColor?: string;
  /** Face fill; ignored when `gradient` is set. */
  color?: string;
  gradient?: readonly [string, string, ...string[]];
  /** Outer (layout) style: margins, flex, alignSelf. */
  style?: StyleProp<ViewStyle>;
  /** Face style: size, padding, alignment. */
  faceStyle?: StyleProp<ViewStyle>;
  haptic?: boolean;
  /** Drop the outline and ledge entirely (a plain tappable). */
  flat?: boolean;
};

/**
 * The core chunky 3D pressable: a face with a 2px ink outline sitting on a solid
 * ledge. Pressing pushes the face down onto the ledge with a light haptic.
 */
export function Press3D({
  children,
  radius,
  depth = depthTokens.button,
  ledgeColor = colors.ink,
  color = colors.surface,
  gradient,
  style,
  faceStyle,
  haptic = true,
  flat,
  disabled,
  onPressIn,
  onPressOut,
  ...rest
}: Press3DProps) {
  const d = flat ? 0 : depth;
  const pressed = useSharedValue(0);
  const faceAnim = useAnimatedStyle(() => ({
    transform: [{ translateY: pressed.get() * Math.max(d - 1, 0) }, { scale: flat ? 1 - pressed.get() * 0.06 : 1 }],
  }));

  return (
    <Pressable
      {...rest}
      disabled={disabled}
      onPressIn={(e) => {
        pressed.set(withTiming(1, { duration: 60 }));
        if (haptic) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        pressed.set(withSpring(0, { damping: 14, stiffness: 420, mass: 0.6 }));
        onPressOut?.(e);
      }}
      style={[{ paddingBottom: d, borderRadius: radius }, disabled && styles.disabled, style]}>
      {flat ? null : (
        <View style={[styles.ledge, { top: d, borderRadius: radius, backgroundColor: ledgeColor }]} />
      )}
      <Animated.View
        style={[
          styles.face,
          { borderRadius: radius, backgroundColor: gradient ? undefined : color },
          flat && styles.flatFace,
          faceStyle,
          faceAnim,
        ]}>
        {gradient ? <LinearGradient colors={gradient} {...VERTICAL} style={StyleSheet.absoluteFill} /> : null}
        {children}
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  ledge: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderWidth: depthTokens.border,
    borderColor: colors.ink,
    borderCurve: 'continuous',
  },
  face: {
    overflow: 'hidden',
    borderWidth: depthTokens.border,
    borderColor: colors.ink,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
  },
  flatFace: { borderWidth: 0, backgroundColor: 'transparent' },
  disabled: { opacity: 0.5 },
});
