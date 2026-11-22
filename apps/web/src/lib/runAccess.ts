import { useApp } from '../stores/app';

export interface RunAccess {
  canRun: boolean;
  /** Why Run is unavailable, in words for the person looking at it. Empty when it is available. */
  reason: string;
}

/** Whether the signed-in person may press Run in the IDE, and what to tell them if not. */
export function useRunAccess(): RunAccess {
  const canRun = useApp((s) => s.user?.canRun ?? s.config?.allowRun ?? true);
  const isAdmin = useApp((s) => !!s.user?.roles.includes('admin'));
  if (canRun) return { canRun: true, reason: '' };
  return {
    canRun: false,
    reason: isAdmin
      ? 'Running is turned off in Admin → Settings.'
      : 'Running projects here is limited to administrators. Export the project to run it on your own machine.',
  };
}
