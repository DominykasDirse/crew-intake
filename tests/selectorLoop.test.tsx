// The class of bug that crashed the photo screen: a Zustand selector that returns a value
// built fresh on every call loops the renderer. This renders both shapes against a real
// store and shows the naive one blows up while the memoised one renders once.
import { act, create } from 'react-test-renderer';
import { useMemo } from 'react';
import { Text } from 'react-native';
import { create as createStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';

type Item = { id: string; key: string };
type S = { items: Record<string, Item>; add: (it: Item) => void };
const useStore = createStore<S>((set) => ({
  items: { a: { id: 'a', key: 'k' }, b: { id: 'b', key: 'other' } },
  add: (it) => set((s) => ({ items: { ...s.items, [it.id]: it } })),
}));
const forKey = (items: Record<string, Item>, key: string) =>
  Object.values(items).filter((i) => i.key === key);

let renders = 0;
function Naive() {
  renders++;
  const items = useStore((s) => forKey(s.items, 'k')); // fresh array every getSnapshot
  return <Text>{items.length}</Text>;
}
function Memoised() {
  renders++;
  const items = useStore((s) => s.items);
  const mine = useMemo(() => forKey(items, 'k'), [items]);
  return <Text>{mine.length}</Text>;
}
function Shallow() {
  renders++;
  const items = useStore(useShallow((s) => forKey(s.items, 'k')));
  return <Text>{items.length}</Text>;
}

describe('zustand selectors must return stable snapshots', () => {
  const originalError = console.error;
  beforeEach(() => {
    renders = 0;
    console.error = jest.fn(); // React reports the getSnapshot warning here; keep the test output clean
  });
  afterEach(() => {
    console.error = originalError;
  });

  it('a selector that builds a fresh array loops the renderer (the PhotoGrid crash)', () => {
    let failed: unknown = null;
    try {
      act(() => {
        create(<Naive />);
      });
    } catch (e) {
      failed = e;
    }
    const warned = (console.error as jest.Mock).mock.calls.some((c) =>
      String(c[0]).includes('getSnapshot should be cached'),
    );
    expect(failed !== null || warned).toBe(true);
  });

  it('raw slice + useMemo renders once per state change', () => {
    let root: ReturnType<typeof create> | undefined;
    act(() => {
      root = create(<Memoised />);
    });
    expect(root!.toJSON()).toMatchObject({ children: ['1'] });
    const before = renders;
    act(() => useStore.getState().add({ id: 'c', key: 'k' }));
    expect(root!.toJSON()).toMatchObject({ children: ['2'] });
    expect(renders - before).toBeLessThanOrEqual(1);
    act(() => useStore.getState().add({ id: 'd', key: 'unrelated' }));
    expect(renders - before).toBeLessThanOrEqual(2);
  });

  it('useShallow renders at most once per store change and never loops', () => {
    let root: ReturnType<typeof create> | undefined;
    act(() => {
      root = create(<Shallow />);
    });
    const before = renders;
    act(() => useStore.getState().add({ id: 'e', key: 'unrelated' }));
    expect(renders - before).toBeLessThanOrEqual(1); // shallow-equal result → no loop
    expect(root!.toJSON()).toMatchObject({ children: ['2'] });
  });
});
