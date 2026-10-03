// AI-agent archetypes (data/personas/lens/ai_*.json, "kind": "ai_agent"): labels for the legend, panels and traces.
// An AI shopper is shown by WHO it is (archetype) with a robot badge; the model that decided is a detail line.
import type { Agent, Persona } from '../types';
import { archLabel } from '../theme';

const AI_ARCH: Record<string, { label: string; gear: string }> = {
  ai_assistant_general: { label: 'general shopping assistant', gear: '📡 reads the feed for a user' },
  ai_retailer_assistant: { label: 'retailer basket builder', gear: '🧾 replays your history, own-label default' },
  ai_price_bot: { label: 'price bot', gear: '🧮 sorts by £ per 100 g' },
  ai_agent: { label: 'ai shopping agent', gear: '📡 scans the feed' },
};

/** archetype keys used by AI agents (never the human "ai_delegator", who is a person using ChatGPT) */
export const isAIArch = (arch: string) => arch in AI_ARCH || arch.startsWith('ai ·');

export function aiLabel(arch: string, persona?: Persona) {
  return (persona as (Persona & { label?: string }) | undefined)?.label ?? AI_ARCH[arch]?.label ?? archLabel(arch.replace(/^ai_/, ''));
}
export const aiGear = (arch: string) => AI_ARCH[arch]?.gear ?? '📡 scans the feed';

/** "🤖 general shopping assistant" for AI archetypes, plain label for humans */
export const shopperLabel = (arch: string, persona?: Persona) => (isAIArch(arch) ? `🤖 ${aiLabel(arch, persona)}` : archLabel(arch));

/** the model that made the call, as a short human string */
export function modelName(model?: string) {
  if (!model) return 'unknown model';
  if (model.includes('jev-router')) return 'jev-router (openrouter fallback)';
  return model.replace(/^openrouter:/, '').split('/').pop() ?? model;
}
export const decidedBy = (a: Agent) => `decided by ${modelName(a.model)}`;

/** archetype key for an AI agent record (old runs without an archetype fall back to the generic one) */
export const aiArchOf = (a: Agent) => (a.archetype && a.archetype !== 'ai_agent' ? a.archetype : 'ai_agent');
