import { useRequest } from 'ahooks';
import { useRef } from 'react';
import { create } from 'zustand';

type Resource =
  | 'today'
  | 'catalog'
  | 'catalog-item'
  | 'people'
  | 'events'
  | 'quests'
  | 'quest-leaderboard'
  | 'progress'
  | 'reminders'
  | 'credentials'
  | 'assistant-history';

const useRevisions = create<Partial<Record<Resource, number>>>(() => ({}));

export function useResource<T>(
  key: Resource,
  service: () => Promise<T>,
  options: { ready?: boolean; refreshDeps?: unknown[]; pollingInterval?: number } = {},
) {
  const revision = useRevisions((state) => state[key] ?? 0);

  return useRequest(service, {
    ready: options.ready,
    refreshDeps: [revision, ...(options.refreshDeps ?? [])],
    pollingInterval: options.pollingInterval,
    retryCount: 1,
    retryInterval: 500,
    onError: () => {},
  });
}

export function useAction<T, V>(service: (input: V) => Promise<T>, resources: Resource[] = []) {
  const cleared = useRef(false);
  const request = useRequest(
    (input: V, _callbacks?: { onSuccess: (data: T) => void }) => service(input),
    {
      manual: true,
      onBefore: () => {
        cleared.current = false;
      },
      onSuccess: (data, [, callbacks]) => {
        if (resources.length) {
          useRevisions.setState((state) =>
            Object.fromEntries(resources.map((key) => [key, (state[key] ?? 0) + 1])),
          );
        }
        callbacks?.onSuccess(data);
      },
      onError: () => {},
    },
  );

  return {
    ...request,
    error: cleared.current ? undefined : request.error,
    reset() {
      cleared.current = true;
      request.cancel();
      request.mutate(undefined);
    },
  };
}
