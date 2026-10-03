import { useImperativeHandle, type ReactNode, type Ref } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';

// Web stand-in for react-native-maps (wired up in metro.config.js). Native builds never load this.

type MapHandle = { animateToRegion: () => void; fitToCoordinates: () => void };
type Props = { ref?: Ref<MapHandle>; style?: StyleProp<ViewStyle>; children?: ReactNode; [nativeOnlyProp: string]: unknown };

/** An empty surface where the map would be, so whatever sits behind it shows through. */
export default function MapView({ ref, style }: Props) {
  useImperativeHandle(ref, () => ({ animateToRegion: () => {}, fitToCoordinates: () => {} }), []);
  return <View style={style} />;
}

export function Marker(_props: { children?: ReactNode; [nativeOnlyProp: string]: unknown }) {
  return null;
}

export function Circle(_props: Record<string, unknown>) {
  return null;
}
