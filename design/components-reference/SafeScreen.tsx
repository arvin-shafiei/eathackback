import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type Edge = 'top' | 'bottom';

/**
 * Safe-area insets for laying out a screen. Reads the root provider (JS), which stays correct inside
 * native fullScreenModals where the native <SafeAreaView> can report 0 and let content slide under
 * the Dynamic Island.
 *
 * Full-screen routes/modals: pad the top with `top`. Page-sheet modals (settings, new-pres, the
 * requests grid) start below the status bar, so they pad only the bottom.
 */
export function useScreenInsets() {
  const insets = useSafeAreaInsets();
  return { top: insets.top, bottom: insets.bottom };
}

type Props = {
  /** Which edges to pad. Default: both. Use ['bottom'] for page sheets, ['top'] above the tab bar. */
  edges?: Edge[];
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
};

/** A View padded by the safe-area insets on top of whatever padding its style already has. */
export function SafeScreen({ edges = ['top', 'bottom'], style, children }: Props) {
  const { top, bottom } = useScreenInsets();
  const flat = StyleSheet.flatten(style) ?? {};
  const num = (v: unknown) => (typeof v === 'number' ? v : 0);
  const baseTop = num(flat.paddingTop ?? flat.paddingVertical ?? flat.padding);
  const baseBottom = num(flat.paddingBottom ?? flat.paddingVertical ?? flat.padding);
  return (
    <View
      style={[
        style,
        edges.includes('top') && { paddingTop: baseTop + top },
        edges.includes('bottom') && { paddingBottom: baseBottom + bottom },
      ]}>
      {children}
    </View>
  );
}
