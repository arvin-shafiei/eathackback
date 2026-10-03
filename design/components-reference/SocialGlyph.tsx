import FontAwesome6 from '@expo/vector-icons/FontAwesome6';
import { colors } from './tokens';

export type SocialNetwork = 'twitter' | 'instagram' | 'tiktok' | 'snapchat';

const GLYPH: Record<SocialNetwork, string> = {
  twitter: 'x-twitter',
  instagram: 'instagram',
  tiktok: 'tiktok',
  snapchat: 'snapchat',
};

/** Black brand glyph for a social network. */
export function SocialGlyph({ network, size = 18, color = colors.ink }: { network: SocialNetwork; size?: number; color?: string }) {
  return <FontAwesome6 name={GLYPH[network]} brand size={size} color={color} />;
}
