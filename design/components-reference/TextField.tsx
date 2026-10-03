import { SymbolView } from 'expo-symbols';
import { useState, type Ref } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View, type TextInputProps, type StyleProp, type ViewStyle } from 'react-native';
import { colors, depth, fonts, ledge, radii, spacing, type } from './tokens';

type FieldProps = TextInputProps & {
  /** Fixed text shown before the input, e.g. "@". */
  prefix?: string;
  /** Leading icon element (e.g. a SocialGlyph). */
  leading?: React.ReactNode;
  /** Trailing element inside the field (e.g. the show-password eye). */
  trailing?: React.ReactNode;
  containerStyle?: StyleProp<ViewStyle>;
  size?: 'md' | 'lg';
  ref?: Ref<TextInput>;
};

/** White rounded field with an ink outline on a small ink ledge (like the 3D buttons); the ledge turns pink on focus. */
export function TextField({ prefix, leading, trailing, containerStyle, size = 'md', multiline, style, ref, onFocus, onBlur, ...rest }: FieldProps) {
  const [focused, setFocused] = useState(false);
  const lg = size === 'lg';
  return (
    <View style={[styles.box, lg && styles.lg, multiline && styles.multi, focused && styles.focused, containerStyle]}>
      {leading}
      {prefix ? <Text style={styles.prefix}>{prefix}</Text> : null}
      <TextInput
        ref={ref}
        placeholderTextColor={colors.mutedSoft}
        selectionColor={colors.pink}
        autoCapitalize="none"
        autoCorrect={false}
        multiline={multiline}
        onFocus={(e) => {
          setFocused(true);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          onBlur?.(e);
        }}
        style={[styles.input, lg && styles.inputLg, multiline && styles.inputMulti, style]}
        {...rest}
      />
      {trailing}
    </View>
  );
}

/** A TextField for passwords, with an eye to show or hide what's typed. */
export function PasswordField(props: Omit<FieldProps, 'secureTextEntry' | 'trailing'>) {
  const [shown, setShown] = useState(false);
  return (
    <TextField
      {...props}
      secureTextEntry={!shown}
      trailing={
        <Pressable
          onPress={() => setShown((s) => !s)}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={shown ? 'hide password' : 'show password'}>
          <SymbolView name={shown ? 'eye.slash' : 'eye'} size={20} tintColor={colors.muted} weight="semibold" />
        </Pressable>
      }
    />
  );
}

type LabeledProps = FieldProps & { label: string; hint?: string };

/** Muted label on the left, field on the right — the settings-form row. */
export function LabeledField({ label, hint, ...field }: LabeledProps) {
  return (
    <View style={styles.row}>
      <Text style={[styles.label, field.multiline && { paddingTop: 12 }]}>{label}</Text>
      <View style={styles.fieldCol}>
        <TextField {...field} />
        {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 48,
    paddingHorizontal: spacing.md,
    gap: 6,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderCurve: 'continuous',
    borderWidth: depth.border,
    borderColor: colors.ink,
    boxShadow: ledge(depth.sticker, colors.ink, false),
    marginBottom: depth.sticker,
  },
  focused: { boxShadow: ledge(depth.sticker, colors.pink, false) },
  lg: { minHeight: 60, borderRadius: radii.pill, paddingHorizontal: spacing.lg },
  multi: { alignItems: 'flex-start', paddingVertical: 10 },
  prefix: { ...type.body, color: colors.muted },
  // single-line iOS inputs misplace text with a lineHeight, so only multiline keeps one
  input: { flex: 1, ...type.body, lineHeight: undefined, paddingVertical: 10 },
  inputLg: { fontFamily: fonts.bold, fontSize: 19 },
  inputMulti: { minHeight: 72, lineHeight: type.body.lineHeight, textAlignVertical: 'top', paddingVertical: 2 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  label: { width: 64, paddingTop: 14, ...type.label, color: colors.muted },
  fieldCol: { flex: 1, gap: 4 },
  hint: { ...type.caption, paddingLeft: 4 },
});
