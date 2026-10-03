import { StyleSheet, Text, View } from 'react-native';
import { Floaty3D } from './Floaty3D';
import type { Object3DName } from './objects3d';
import { emojiRoom } from './emoji';
import { spacing, type } from './tokens';

type Props = {
  /** A floating 3D object; falls back to the emoji when omitted. */
  object?: Object3DName;
  emoji?: string;
  title: string;
  body?: string;
  children?: React.ReactNode;
};

export function EmptyState({ object, emoji, title, body, children }: Props) {
  return (
    <View style={styles.root}>
      {object ? (
        <Floaty3D name={object} size={132} rotate={-8} style={styles.object} />
      ) : emoji ? (
        <Text style={styles.emoji}>{emoji}</Text>
      ) : null}
      <Text style={[type.display, styles.center, emojiRoom(type.display, title)]}>{title}</Text>
      {body ? <Text style={[type.caption, styles.center, styles.body]}>{body}</Text> : null}
      {children ? <View style={styles.actions}>{children}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.xs },
  object: { marginBottom: spacing.xs },
  emoji: { fontSize: 52, lineHeight: 70, marginBottom: spacing.xs },
  center: { textAlign: 'center' },
  body: { fontSize: 15, maxWidth: 280 },
  actions: { marginTop: spacing.md, alignSelf: 'stretch', gap: spacing.xs },
});
