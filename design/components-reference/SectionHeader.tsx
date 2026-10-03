import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, fonts, type } from './tokens';

type Props = { title: string; emoji?: string; action?: { label: string; onPress: () => void } };

/** Chunky lowercase section header with an optional emoji and trailing action. */
export function SectionHeader({ title, emoji, action }: Props) {
  return (
    <View style={styles.row}>
      <View style={styles.title}>
        {/* the emoji gets its own system-font Text so Baloo's tight lineHeight can't clip it */}
        {emoji ? <Text style={styles.emoji}>{emoji}</Text> : null}
        <Text style={[type.heading, styles.flex]}>{title}</Text>
      </View>
      {action ? (
        <Pressable onPress={action.onPress} hitSlop={8}>
          <Text style={styles.action}>{action.label}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  title: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 },
  flex: { flexShrink: 1 },
  emoji: { fontSize: 19, lineHeight: 28 },
  action: { fontFamily: fonts.heavy, fontSize: 14, color: colors.pink },
});
