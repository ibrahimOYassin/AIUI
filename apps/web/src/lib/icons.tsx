import { Box, icons, type LucideIcon, type LucideProps } from 'lucide-react';
import type { NodeKind } from '@aiui/shared';

const cache = new Map<string, LucideIcon>();

/** Resolve a kebab-case lucide name ("mail-check") to its component. */
export function iconFor(name: string | undefined | null): LucideIcon {
  if (!name) return Box;
  const hit = cache.get(name);
  if (hit) return hit;
  const pascal = name
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join('');
  const found = (icons as Record<string, LucideIcon | undefined>)[pascal] ?? Box;
  cache.set(name, found);
  return found;
}

export function Icon({ name, ...props }: { name: string | undefined | null } & LucideProps) {
  const Cmp = iconFor(name);
  return <Cmp size={16} {...props} />;
}

export const KIND_LABEL: Record<NodeKind, string> = {
  trigger: 'Trigger',
  action: 'Action',
  logic: 'Logic',
  ai: 'AI',
};
