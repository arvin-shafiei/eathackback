import { Image } from 'expo-image';
import { useEffect } from 'react';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { objects3d, type Object3DName } from './objects3d';

type Props = {
  name: Object3DName;
  size: number;
  /** Positioning (e.g. { position: 'absolute', top: 40, left: -10 }). Don't pass transforms here. */
  style?: StyleProp<ViewStyle>;
  /** Resting tilt in degrees. */
  rotate?: number;
  /** Vertical bob distance in points. */
  drift?: number;
  /** One bob, in ms. */
  duration?: number;
  delay?: number;
};

/** A glossy 3D object that slowly bobs and wobbles. Purely decorative, never interactive. */
export function Floaty3D({ name, size, style, rotate = 0, drift = 8, duration = 3200, delay = 0 }: Props) {
  const reduceMotion = useReducedMotion();
  const t = useSharedValue(0.5);

  useEffect(() => {
    if (reduceMotion) return;
    t.set(0);
    t.set(
      withDelay(delay, withRepeat(withTiming(1, { duration, easing: Easing.inOut(Easing.sin) }), -1, true)),
    );
    return () => cancelAnimation(t);
  }, [reduceMotion, delay, duration, t]);

  const anim = useAnimatedStyle(() => {
    const k = t.get() - 0.5;
    return {
      transform: [{ translateY: k * 2 * drift }, { rotate: `${rotate + k * 8}deg` }, { scale: 1 + k * 0.03 }],
    };
  });

  return (
    <Animated.View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[{ width: size, height: size }, style, anim]}>
      <Image source={objects3d[name]} style={StyleSheet.absoluteFill} contentFit="contain" />
    </Animated.View>
  );
}
