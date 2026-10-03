import { Text, type TextProps } from 'react-native';
import { emojiRoom } from './emoji';
import { colors, type as typeScale, type TypeVariant } from './tokens';

type Props = TextProps & { variant?: TypeVariant; muted?: boolean; center?: boolean };

/** Themed text. Grows its lineHeight when the text holds an emoji so iOS doesn't clip it. */
export function Txt({ variant = 'body', muted, center, style, ...rest }: Props) {
  const base = [typeScale[variant], muted && { color: colors.muted }, center && { textAlign: 'center' as const }, style];
  return <Text {...rest} style={[...base, emojiRoom(base, rest.children)]} />;
}
