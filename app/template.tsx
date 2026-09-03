import type { ReactNode } from 'react';

// Templates remount on route changes, not on local form edits. CSS gives the
// incoming page a short transition without delaying routing or losing inputs.
export default function Template({ children }: { children: ReactNode }) {
  return <div className="page-arrival">{children}</div>;
}
