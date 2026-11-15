// Tier and model of a PBI (references/roles.md): `Tier:` line, else size S/M/L, else standard.
export type Tier = 'fast' | 'standard' | 'strong';
export type TierChoice = { tier: Tier; model: string; from: string };

export const TIER_MODELS: Record<Tier, string> = {
  fast: 'haiku',
  standard: 'sonnet',
  strong: 'opus',
};
const SIZE_TIERS: Record<string, Tier> = { S: 'fast', M: 'standard', L: 'strong' };

export function getPbiTier(body: string | null | undefined): TierChoice {
  const text = body ?? '';
  const tierLine = /^[ \t]*(?:[-*][ \t]*)?\**Tier:?\**:?[ \t]*(fast|standard|strong)\b/im.exec(
    text,
  );
  if (tierLine) {
    const tier = tierLine[1].toLowerCase() as Tier;
    return { tier, model: TIER_MODELS[tier], from: 'Tier line' };
  }
  const size = /^[ \t]*(?:[-*][ \t]*)?\**Size:?\**:?[ \t]*([SML])\b/im.exec(text);
  if (size) {
    const letter = size[1].toUpperCase();
    const tier = SIZE_TIERS[letter];
    return { tier, model: TIER_MODELS[tier], from: `size ${letter}` };
  }
  return { tier: 'standard', model: TIER_MODELS.standard, from: 'default' };
}
