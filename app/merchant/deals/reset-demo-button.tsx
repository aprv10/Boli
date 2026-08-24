'use client';

import { useState } from 'react';

export function ResetDemoButton() {
  const [resetting, setResetting] = useState(false);

  async function resetInbox() {
    setResetting(true);
    const response = await fetch('/api/demo/reset', { method: 'POST' });
    if (response.ok) window.location.reload();
    else setResetting(false);
  }

  return (
    <button className="reset-demo" type="button" onClick={resetInbox} disabled={resetting}>
      {resetting ? 'Clearing…' : 'Reset demo inbox'}
    </button>
  );
}
