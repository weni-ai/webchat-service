interface SegmentWindow extends Window {
  __RUNTIME__?: { segmentToken?: string };
  faststore_sdk_stores?: {
    get?: (key: string) => { read?: () => unknown };
  };
}

/** Host segment used by phone formatting. No cart contents are logged. */
export async function getHostSegment(): Promise<string | null> {
  try {
    const response = await fetch('/api/segments');
    if (response.ok) {
      const body: unknown = await response.json();
      if (body) return JSON.stringify(body);
    }
  } catch {
    // Fall through to the host page.
  }

  const host = window as SegmentWindow;
  const fastStore = host.faststore_sdk_stores?.get?.('fs::session')?.read?.();
  if (fastStore) return JSON.stringify(fastStore);

  const token = host.__RUNTIME__?.segmentToken;
  if (token) {
    try {
      return atob(token);
    } catch {
      return null;
    }
  }
  return null;
}
