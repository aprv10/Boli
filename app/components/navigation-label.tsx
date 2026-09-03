'use client';

import { useLinkStatus } from 'next/link';
import type { ReactNode } from 'react';

/** Uses the router's real pending state; never delays or intercepts navigation. */
export function NavigationLabel({ children }: { children: ReactNode }) {
  const { pending } = useLinkStatus();
  return <span className="navigation-label" data-pending={pending} aria-busy={pending}>
    {children}<span className="navigation-pending-line" aria-hidden="true" />
    {pending ? <span className="sr-only"> — opening</span> : null}
  </span>;
}
