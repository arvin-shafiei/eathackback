import { StyleSheet, Text, View } from 'react-native';
import { type } from './tokens';

export type Stat = { value: number | string; label: string };

/** Big chunky number with a muted lowercase label. */
export function StatBlock({ value, label }: Stat) {
  return (
    <View>
      <Text style={type.stat}>{value}</Text>
      <Text style={[type.caption, styles.label]}>{label}</Text>
    </View>
  );
}

export function StatRow({ stats }: { stats: Stat[] }) {
  return (
    <View style={styles.row}>
      {stats.map((s) => (
        <StatBlock key={s.label} {...s} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  label: { marginTop: -4 },
  row: { flexDirection: 'row', gap: 18 },
});
