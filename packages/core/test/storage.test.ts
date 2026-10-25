import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BEST_KEY,
  DEFAULT_SAVE_KEY,
  SAVE_VERSION,
  clearKey,
  createMemoryStorage,
  emptyBest,
  emptySave,
  isSerializedBest,
  isSerializedSave,
  loadBest,
  loadSave,
  migrate,
  recordBest,
  writeJson,
  type SerializedBest,
  type SerializedSave,
  type StorageLike
} from '../src/index';

const VALID_SAVE: SerializedSave = {
  v: SAVE_VERSION,
  level: 3,
  score: 4200,
  marbles: ['red', 'green', 'red'],
  headDist: 1234.5,
  elapsedMs: 61_000,
  shotsFired: 18,
  hits: 12
};

const VALID_BEST: SerializedBest = {
  v: SAVE_VERSION,
  unlocked: 5,
  scores: { '1': 900, '5': 1200 }
};

describe('键名与版本', () => {
  it('遵守合集约定 game-<slug>:<slot>', () => {
    expect(DEFAULT_SAVE_KEY).toBe('game-zuma:save');
    expect(DEFAULT_BEST_KEY).toBe('game-zuma:best');
    expect(SAVE_VERSION).toBe(1);
  });

  it('键名与版本是常量，不随实例变化', () => {
    expect(SAVE_VERSION).toBe(1);
  });
});

describe('空值与回落', () => {
  it('emptySave 是可直接开局的零值快照', () => {
    const s = emptySave(2);
    expect(s.v).toBe(SAVE_VERSION);
    expect(s.level).toBe(2);
    expect(s.marbles).toEqual([]);
    expect(s.score).toBe(0);
    expect(isSerializedSave(s)).toBe(true);
  });

  it('emptyBest 解锁到第 1 关', () => {
    const b = emptyBest();
    expect(b.unlocked).toBe(1);
    expect(b.scores).toEqual({});
    expect(isSerializedBest(b)).toBe(true);
  });
});

describe('类型守卫', () => {
  it('接受自己写出去的格式', () => {
    expect(isSerializedSave(VALID_SAVE)).toBe(true);
    expect(isSerializedBest(VALID_BEST)).toBe(true);
  });

  it('拒绝版本号不认识的东西', () => {
    expect(isSerializedSave({ ...VALID_SAVE, v: 999 })).toBe(false);
    expect(isSerializedSave({ ...VALID_SAVE, v: undefined })).toBe(false);
    expect(isSerializedBest({ ...VALID_BEST, v: 2 })).toBe(false);
  });

  it('拒绝非对象、数组与 null', () => {
    for (const bad of [null, undefined, 42, 'str', [], [1, 2]]) {
      expect(isSerializedSave(bad)).toBe(false);
      expect(isSerializedBest(bad)).toBe(false);
    }
  });

  it('逐字段挑刺：负分、NaN、无穷大都算脏数据', () => {
    expect(isSerializedSave({ ...VALID_SAVE, score: -1 })).toBe(false);
    expect(isSerializedSave({ ...VALID_SAVE, score: Number.NaN })).toBe(false);
    expect(isSerializedSave({ ...VALID_SAVE, headDist: Number.POSITIVE_INFINITY })).toBe(false);
    expect(isSerializedSave({ ...VALID_SAVE, level: 0 })).toBe(false);
    expect(isSerializedSave({ ...VALID_SAVE, level: 2.5 })).toBe(false);
    expect(isSerializedSave({ ...VALID_SAVE, hits: 'many' })).toBe(false);
  });

  it('链上颜色逐颗校验（混进非法色就整份丢掉）', () => {
    expect(isSerializedSave({ ...VALID_SAVE, marbles: ['red', 'mauve'] })).toBe(false);
    expect(isSerializedSave({ ...VALID_SAVE, marbles: 'red,green' })).toBe(false);
    expect(isSerializedSave({ ...VALID_SAVE, marbles: [null] })).toBe(false);
  });

  it('荣誉榜的分数表必须全是非负有限数', () => {
    expect(isSerializedBest({ ...VALID_BEST, scores: { '1': -5 } })).toBe(false);
    expect(isSerializedBest({ ...VALID_BEST, scores: [] })).toBe(false);
    expect(isSerializedBest({ ...VALID_BEST, scores: { '1': 'x' } })).toBe(false);
    expect(isSerializedBest({ ...VALID_BEST, unlocked: 0 })).toBe(false);
  });
});

describe('migrate', () => {
  it('当前版本原样通过', () => {
    expect(migrate(VALID_SAVE)).toEqual(VALID_SAVE);
  });

  it('认不出的格式返回 null（而不是硬猜字段）', () => {
    expect(migrate({ v: 2, foo: 1 })).toBeNull();
    expect(migrate({ foo: 1 })).toBeNull();
    expect(migrate(null)).toBeNull();
    expect(migrate('json')).toBeNull();
  });
});

describe('load / write 往返', () => {
  it('写进去读得回来（字符串往返）', () => {
    const store = createMemoryStorage();
    expect(writeJson(store, DEFAULT_SAVE_KEY, VALID_SAVE)).toBe(true);
    expect(loadSave(store)).toEqual(VALID_SAVE);
    writeJson(store, DEFAULT_BEST_KEY, VALID_BEST);
    expect(loadBest(store)).toEqual(VALID_BEST);
  });

  it('键不存在时返回 null', () => {
    const store = createMemoryStorage();
    expect(loadSave(store)).toBeNull();
    expect(loadBest(store, DEFAULT_BEST_KEY)).toBeNull();
  });

  it('坏 JSON 与空串都不炸，只当没有', () => {
    const store = createMemoryStorage({ 'game-zuma:save': '{ 不是 JSON' });
    expect(loadSave(store)).toBeNull();
    const blank = createMemoryStorage({ 'game-zuma:save': '' });
    expect(loadSave(blank)).toBeNull();
  });

  it('脏数据（守卫不过）被丢弃', () => {
    const store = createMemoryStorage({
      'game-zuma:save': JSON.stringify({ ...VALID_SAVE, marbles: ['plaid'] })
    });
    expect(loadSave(store)).toBeNull();
  });

  it('自定义键名各读各的', () => {
    const store = createMemoryStorage();
    writeJson(store, 'zuma:slot-b', VALID_SAVE);
    expect(loadSave(store, 'zuma:slot-b')).toEqual(VALID_SAVE);
    expect(loadSave(store)).toBeNull();
  });

  it('宿主写失败（配额 / 冻结）只报告失败，不抛出来', () => {
    const hostile: StorageLike = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError');
      }
    };
    expect(writeJson(hostile, DEFAULT_SAVE_KEY, VALID_SAVE)).toBe(false);
  });

  it('宿主读就抛（隐私模式）时当作没有存档，不向外抛错', () => {
    const hostile: StorageLike = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => undefined
    };
    expect(() => loadSave(hostile)).not.toThrow();
    expect(loadSave(hostile)).toBeNull();
    expect(loadBest(hostile)).toBeNull();
    expect(loadSave(createMemoryStorage({ a: 'not-json' }), 'a')).toBeNull();
  });
});

describe('clearKey', () => {
  it('有 removeItem 就真删', () => {
    const store = createMemoryStorage({ k: 'v' });
    clearKey(store, 'k');
    expect(store.getItem('k')).toBeNull();
  });

  it('没有 removeItem 的宿主退化成写空串', () => {
    const map = new Map<string, string>([['k', 'v']]);
    const minimal: StorageLike = {
      getItem: (key) => map.get(key) ?? null,
      setItem: (key, value) => {
        map.set(key, value);
      }
    };
    clearKey(minimal, 'k');
    expect(map.get('k')).toBe('');
    expect(loadSave(minimal, 'k')).toBeNull();
  });

  it('删除本身抛错也被吞掉', () => {
    const hostile: StorageLike = {
      getItem: () => null,
      setItem: () => undefined,
      removeItem: () => {
        throw new Error('nope');
      }
    };
    expect(() => clearKey(hostile, 'k')).not.toThrow();
  });
});

describe('recordBest', () => {
  it('只抬高不压低', () => {
    const after = recordBest(VALID_BEST, 1, 500);
    expect(after.scores['1']).toBe(900);
    expect(recordBest(VALID_BEST, 1, 1500).scores['1']).toBe(1500);
  });

  it('打过更后面的关会抬高解锁进度', () => {
    expect(recordBest(VALID_BEST, 9, 100).unlocked).toBe(9);
    expect(recordBest(VALID_BEST, 2, 100).unlocked).toBe(5);
  });

  it('不改入参（快照要能被订阅安全比较）', () => {
    const before = { ...VALID_BEST, scores: { ...VALID_BEST.scores } };
    const after = recordBest(before, 3, 777);
    expect(before.scores['3']).toBeUndefined();
    expect(after).not.toBe(before);
  });

  it('新版本号自动带上', () => {
    expect(recordBest(VALID_BEST, 1, 1).v).toBe(SAVE_VERSION);
  });
});

describe('createMemoryStorage', () => {
  it('初值可读、值一律字符串化', () => {
    const store = createMemoryStorage({ a: '1' });
    expect(store.getItem('a')).toBe('1');
    expect(store.getItem('missing')).toBeNull();
    store.setItem('n', 42 as unknown as string);
    expect(store.getItem('n')).toBe('42');
  });

  it('实例之间互不串味', () => {
    const a = createMemoryStorage();
    const b = createMemoryStorage();
    a.setItem('k', 'v');
    expect(b.getItem('k')).toBeNull();
  });
});
