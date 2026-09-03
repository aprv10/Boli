import type { CSSProperties } from 'react';

/**
 * Adapted from Magic UI's Border Beam, discovered on 21st.dev (MIT).
 * https://magicui.design/r/border-beam.json
 * See THIRD_PARTY_NOTICES.md. Uses CSS instead of Motion, with an explicit pause.
 */
export function BorderBeam({
  active = false,
  duration = 12,
  size = 180,
}: {
  active?: boolean;
  duration?: number;
  size?: number;
}) {
  return (
    <span
      className="boli-border-beam"
      aria-hidden="true"
      data-active={active}
      style={{
        '--beam-duration': `${duration}s`,
        '--beam-size': `${size}px`,
      } as CSSProperties}
    >
      <span className="boli-border-beam-light" />
    </span>
  );
}
