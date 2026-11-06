import { useState, type ComponentRef, type Ref } from 'react';
import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native';
import { Controller, type Control, type FieldPath, type FieldValues } from 'react-hook-form';
import { Text } from './Text';
import { alpha, useTheme } from './theme';

export interface TextFieldProps extends TextInputProps {
  ref?: Ref<ComponentRef<typeof TextInput>>;
  label: string;
  error?: string | undefined;
  hint?: string;
}

/**
 * Text input from TDD Section C: 48 pt, radius 10, Surface 2 fill, 1 pt Line
 * border, 2 pt Cobalt when focused; label above in footnote Soft ink; error
 * under the field in Danger.
 */
export function TextField({
  ref,
  label,
  error,
  hint,
  onFocus,
  onBlur,
  style,
  ...rest
}: TextFieldProps) {
  const t = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <View style={styles.wrap}>
      <Text variant="footnote" tone="inkSoft" style={styles.label}>
        {label}
      </Text>
      <TextInput
        ref={ref}
        accessibilityLabel={label}
        accessibilityHint={error ?? hint}
        placeholderTextColor={t.colors.inkFaint}
        selectionColor={alpha(t.colors.primary, 0.3)}
        cursorColor={t.colors.primary}
        {...rest}
        onFocus={(e) => {
          setFocused(true);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          onBlur?.(e);
        }}
        style={[
          styles.input,
          t.type('body'),
          {
            color: t.colors.ink,
            backgroundColor: t.colors.surface2,
            borderColor: error ? t.colors.danger : focused ? t.colors.primary : t.colors.line,
            borderWidth: focused || error ? 2 : 1,
            paddingHorizontal: focused || error ? 13 : 14,
          },
          style,
        ]}
      />
      {error ? (
        <Text
          variant="footnote"
          tone="danger"
          accessibilityLiveRegion="polite"
          style={styles.below}
        >
          {error}
        </Text>
      ) : hint ? (
        <Text variant="footnote" tone="inkFaint" style={styles.below}>
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

type ControlledProps<T extends FieldValues> = Omit<TextFieldProps, 'value' | 'onChangeText'> & {
  control: Control<T>;
  name: FieldPath<T>;
};

/** TextField bound to react-hook-form. */
export function ControlledTextField<T extends FieldValues>({
  control,
  name,
  onBlur,
  ...rest
}: ControlledProps<T>) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => (
        <TextField
          {...rest}
          value={(field.value as string | undefined) ?? ''}
          onChangeText={field.onChange}
          onBlur={(e) => {
            field.onBlur();
            onBlur?.(e);
          }}
        />
      )}
    />
  );
}

const styles = StyleSheet.create({
  wrap: { alignSelf: 'stretch', marginBottom: 16 },
  label: { marginBottom: 6 },
  input: { minHeight: 48, borderRadius: 10, paddingVertical: 10 },
  below: { marginTop: 6 },
});
