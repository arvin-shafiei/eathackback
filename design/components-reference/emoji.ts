import { isValidElement, type ReactNode } from 'react';
import { StyleSheet, type StyleProp, type TextStyle } from 'react-native';
import { fonts } from './tokens';

/**
 * Why emoji clip on iOS: when a Text's lineHeight is smaller than its font's natural
 * line height, iOS keeps the descent and trims the top. Baloo 2's natural line height
 * is 1.6em (ascent 1.078, descent 0.524), and Apple Color Emoji needs ~1em above the
 * baseline, so Baloo text needs lineHeight >= ~1.6em before an emoji fits. Inter is
 * 1.21em natural, so ~1.4em leaves headroom.
 */
export const EMOJI_LINE = { display: 1.62, text: 1.4 } as const;

// Surrogate-pair pictographs (U+1F000–1FAFF) plus the BMP symbol/dingbat blocks.
const EMOJI_RE = /[\uD83C-\uD83E][\uDC00-\uDFFF]|[⌀-⏿☀-➿⬀-⯿]/;

/** True if any string inside `node` (including nested Text children) contains an emoji. */
export function hasEmoji(node: ReactNode): boolean {
  if (typeof node === 'string') return EMOJI_RE.test(node);
  if (Array.isArray(node)) return node.some(hasEmoji);
  if (isValidElement<{ children?: ReactNode }>(node)) return hasEmoji(node.props.children);
  return false;
}

/** The smallest lineHeight that won't clip an emoji at this font size and family. */
export function emojiLineHeight(fontSize: number, fontFamily?: string) {
  return Math.ceil(fontSize * (fontFamily === fonts.display ? EMOJI_LINE.display : EMOJI_LINE.text));
}

/**
 * Returns a `{ lineHeight }` override when `children` contains an emoji and the style's
 * lineHeight is too tight for it (always for Baloo, or any explicit lineHeight). Append
 * it last in the style array.
 */
export function emojiRoom(style: StyleProp<TextStyle>, children: ReactNode): TextStyle | undefined {
  if (!hasEmoji(children)) return undefined;
  const flat = StyleSheet.flatten(style) ?? {};
  const size = flat.fontSize ?? 14;
  if (flat.lineHeight === undefined && flat.fontFamily !== fonts.display) return undefined;
  const need = emojiLineHeight(size, flat.fontFamily);
  return (flat.lineHeight ?? 0) < need ? { lineHeight: need } : undefined;
}
