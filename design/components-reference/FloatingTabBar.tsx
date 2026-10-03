import type { BottomTabBarProps } from 'expo-router/tabs';
import * as Haptics from 'expo-haptics';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { IconCircleButton } from './IconCircleButton';
import { colors, depth, ledge, spacing } from './tokens';

type Props = BottomTabBarProps & { onPlus?: () => void };

/** Chunky white floating capsule on an ink ledge, with a gradient "+" button on the right. */
export function FloatingTabBar({ state, descriptors, navigation, onPlus }: Props) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.wrap, { bottom: Math.max(insets.bottom, spacing.md) }]} pointerEvents="box-none">
      <View style={styles.capsule}>
        {state.routes.map((route, index) => {
          const { options } = descriptors[route.key];
          const focused = state.index === index;
          const color = focused ? colors.surface : colors.muted;
          const onPress = () => {
            const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
            if (!focused && !event.defaultPrevented) {
              Haptics.selectionAsync();
              navigation.navigate(route.name, route.params);
            }
          };
          return (
            <Pressable
              key={route.key}
              accessibilityRole="tab"
              accessibilityState={{ selected: focused }}
              accessibilityLabel={options.title ?? route.name}
              onPress={onPress}
              style={styles.item}>
              <View style={[styles.bubble, focused && styles.bubbleOn]}>
                {options.tabBarIcon?.({ focused, color, size: 22 })}
              </View>
            </Pressable>
          );
        })}
      </View>
      {onPlus ? (
        <IconCircleButton symbol="plus" size={62} tone="brand" onPress={onPlus} accessibilityLabel="post a pres" />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  capsule: {
    flex: 1,
    height: 66,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingHorizontal: 6,
    backgroundColor: colors.surface,
    borderRadius: 999,
    borderWidth: depth.border,
    borderColor: colors.ink,
    boxShadow: ledge(depth.button),
  },
  item: { flex: 1, height: '100%', alignItems: 'center', justifyContent: 'center' },
  bubble: { width: 48, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  bubbleOn: { backgroundColor: colors.ink },
});
