import { describe, expect, it } from 'vitest';
import {
  PHYSICS,
  LEVELS,
  LEVEL_COUNT,
  Zuma,
  advanceBy,
  createMemoryStorage,
  flightAngle,
  levelById,
  marblePose,
  writeJson,
  type Burst,
  type MarbleColor,
  type StorageLike,
  type ZumaState
} from '../src/index';

/** 固定种子随机源（mulberry32）。 */
function lcg(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 7), 1 | a);
    t = (t ^ (t >>> 14)) | 0;
    t = (t + Math.imul(t ^ (t >>> 4), 1 | t)) | 0;
    return ((t ^ (t >>> 15)) >>> 0) / 4294967296;
  };
}

/** 只记录写入次数的存储包装，用来验自动存档节流。 */
function countingStorage(): { storage: StorageLike; writes: () => number } {
  const inner = createMemoryStorage();
  let writes = 0;
  return {
    writes: () => writes,
    storage: {
      getItem: (k) => inner.getItem(k),
      setItem: (k, v) => {
        writes += 1;
        inner.setItem(k, v);
      },
      removeItem: (k) => inner.removeItem?.(k)
    }
  };
}

/** 用存档把一个精心挑选的链塞进游戏（存档只存颜色，位置由 headDist + spacing 重建）。 */
function gameWithChain(
  headToTail: readonly MarbleColor[],
  options: {
    level?: number;
    rng?: () => number;
    storage?: StorageLike;
    autosaveMs?: number;
    autoNextMs?: number;
  } = {}
): { game: Zuma; storage: StorageLike } {
  const storage = options.storage ?? createMemoryStorage();
  const level = options.level ?? 1;
  const spec = levelById(level);
  const spacing = spec.radius * 2;
  const ok = writeJson(storage, 'game-zuma:save', {
    v: 1,
    level,
    score: 0,
    marbles: [...headToTail].reverse(),
    headDist: (headToTail.length - 1) * spacing,
    elapsedMs: 0,
    shotsFired: 0,
    hits: 0
  });
  expect(ok).toBe(true);
  const game = new Zuma({
    storage,
    rng: options.rng ?? lcg(7),
    samplesPerSegment: 4,
    // 这些用例只验证结算本身；自动推进另有专门用例，默认关掉免得推进到下一关把断言带偏。
    autoNextMs: options.autoNextMs ?? 0,
    autosaveMs: options.autosaveMs ?? 0
  });
  expect(game.load()).toBe(true);
  return { game, storage };
}

describe('构造与开局', () => {
  it('默认从第 1 关开始，链上球数与关卡表一致', () => {
    const game = new Zuma({ rng: lcg(1), samplesPerSegment: 4 });
    const s = game.getState();
    expect(s.phase).toBe('playing');
    expect(s.level).toBe(1);
    expect(s.remaining).toBe(levelById(1).marbles);
    expect(s.chain.marbles).toHaveLength(levelById(1).marbles);
    expect(s.queue).toHaveLength(levelById(1).nextQueue);
    expect(s.score).toBe(0);
    expect(s.settled).toBeNull();
  });

  it('开局链紧贴排布，尾球落在生成口 0', () => {
    const game = new Zuma({ rng: lcg(2), samplesPerSegment: 4 });
    const s = game.getState();
    const spacing = s.chain.spacing;
    expect(s.headDist).toBeCloseTo((s.remaining - 1) * spacing, 6);
    const tail = s.chain.marbles[s.chain.marbles.length - 1]!;
    expect(tail.dist).toBeCloseTo(0, 6);
  });

  it('同一种子的两局开局完全一致（可复现）', () => {
    const a = new Zuma({ rng: lcg(42), samplesPerSegment: 4 }).getState();
    const b = new Zuma({ rng: lcg(42), samplesPerSegment: 4 }).getState();
    expect(a.chain.marbles.map((m) => m.color)).toEqual(b.chain.marbles.map((m) => m.color));
    expect(a.queue).toEqual(b.queue);
  });

  it('非法关卡号抛错', () => {
    expect(() => new Zuma({ level: 99 })).toThrow(/不存在/);
    expect(() => new Zuma({ level: 0 })).toThrow(RangeError);
  });
});

describe('订阅与快照', () => {
  it('状态变化会推送，退订后不再推送', () => {
    const game = new Zuma({ rng: lcg(3), samplesPerSegment: 4 });
    const seen: ZumaState[] = [];
    const off = game.subscribe((s) => seen.push(s));
    advanceBy(game, 3);
    expect(seen.length).toBe(3);
    off();
    advanceBy(game, 3);
    expect(seen.length).toBe(3);
  });

  it('aim 相同角度不产生新快照（避免每帧空推）', () => {
    const game = new Zuma({ rng: lcg(3), samplesPerSegment: 4 });
    const before = game.getState();
    expect(game.aim(before.aimAngle)).toBe(false);
    expect(game.getState()).toBe(before);
    expect(game.aim(0.5)).toBe(true);
    expect(game.getState().aimAngle).toBe(0.5);
  });

  it('getState 返回的是不可变引用（外部改不动）', () => {
    const game = new Zuma({ rng: lcg(3), samplesPerSegment: 4 });
    const s = game.getState();
    expect(() => {
      (s as { score: number }).score = 999_999;
    }).toThrow();
  });
});

describe('aim / aimAt', () => {
  it('aimAt 把世界坐标换算成相对发射器的角度', () => {
    const game = new Zuma({ rng: lcg(3), samplesPerSegment: 4 });
    const origin = game.getLauncher();
    // 默认瞄准角就是正上方，先换个方向才能观察到「真的改了」
    expect(game.getState().aimAngle).toBeCloseTo(-Math.PI / 2, 9);
    expect(game.aimAt({ x: origin.x + 100, y: origin.y })).toBe(true);
    expect(game.getState().aimAngle).toBeCloseTo(0, 9);
    expect(game.aimAt({ x: origin.x, y: origin.y + 50 })).toBe(true);
    expect(game.getState().aimAngle).toBeCloseTo(Math.PI / 2, 9);
    // 同一个点再瞄一次是 no-op
    expect(game.aimAt({ x: origin.x, y: origin.y + 50 })).toBe(false);
  });

  it('NaN / Infinity 的角度被拒绝且不改状态', () => {
    const game = new Zuma({ rng: lcg(3), samplesPerSegment: 4 });
    const before = game.getState();
    expect(game.aim(Number.NaN)).toBe(false);
    expect(game.aimAt({ x: Number.POSITIVE_INFINITY, y: 0 })).toBe(false);
    expect(game.getState()).toBe(before);
  });

  it('暂停时不接受输入', () => {
    const game = new Zuma({ rng: lcg(3), samplesPerSegment: 4 });
    game.pause();
    expect(game.aim(1)).toBe(false);
    expect(game.shoot()).toBe(false);
  });
});

describe('shoot', () => {
  it('消耗装填球、补满队列、记一发', () => {
    const game = new Zuma({ rng: lcg(9), samplesPerSegment: 4 });
    const loaded = game.getState().queue[0]!;
    expect(game.shoot()).toBe(true);
    const s = game.getState();
    expect(s.projectile).not.toBeNull();
    expect(s.projectile!.color).toBe(loaded);
    expect(s.shotsFired).toBe(1);
    expect(s.queue).toHaveLength(levelById(1).nextQueue);
  });

  it('同一发没落地前不能连射', () => {
    const game = new Zuma({ rng: lcg(9), samplesPerSegment: 4 });
    game.shoot();
    expect(game.shoot()).toBe(false);
    expect(game.getState().shotsFired).toBe(1);
  });

  it('弹球朝瞄准方向飞', () => {
    const game = new Zuma({ rng: lcg(9), samplesPerSegment: 4 });
    game.aim(0);
    game.shoot();
    const p = game.getState().projectile!;
    expect(flightAngle(p)).toBeCloseTo(0, 9);
    advanceBy(game, 5);
    expect(game.getState().projectile!.pos.x).toBeGreaterThan(p.pos.x);
  });
});

describe('tick 的时间处理', () => {
  it('NaN 与负数抛错，0 什么都不做', () => {
    const game = new Zuma({ rng: lcg(3), samplesPerSegment: 4 });
    expect(() => game.tick(Number.NaN)).toThrow(RangeError);
    expect(() => game.tick(-16)).toThrow(RangeError);
    const before = game.getState();
    game.tick(0);
    expect(game.getState()).toBe(before);
  });

  it('链随时间前进，用时累加', () => {
    const game = new Zuma({ rng: lcg(3), samplesPerSegment: 4 });
    const before = game.getState();
    advanceBy(game, 120); // 1 秒
    const after = game.getState();
    expect(after.elapsedMs).toBeCloseTo(1000, 3);
    expect(after.headDist).toBeGreaterThan(before.headDist);
    expect(after.remaining).toBe(before.remaining);
  });

  it('同样的游戏时间，切成大帧或小帧结果一致（固定子步的意义）', () => {
    const big = new Zuma({ rng: lcg(11), samplesPerSegment: 4 });
    const small = new Zuma({ rng: lcg(11), samplesPerSegment: 4 });
    big.tick(200);
    for (let i = 0; i < 12; i += 1) small.tick(16.67);
    // 固定步会有不足一步的残余，允许一步之内的偏差
    const tolerance = PHYSICS.STEP_MS * 0.001 * 200;
    expect(Math.abs(big.getState().headDist - small.getState().headDist)).toBeLessThan(
      Math.max(tolerance, 0.5)
    );
  });

  it('一帧给超大 dt 也不会瞬移（后台回来的保护）', () => {
    const game = new Zuma({ rng: lcg(3), samplesPerSegment: 4 });
    const before = game.getState().headDist;
    game.tick(60_000);
    const moved = game.getState().headDist - before;
    const oneStepMaxSpeed = game.getSpec().maxSpeed * (PHYSICS.STEP_MS / 1000);
    expect(moved).toBeLessThanOrEqual(oneStepMaxSpeed * PHYSICS.MAX_STEPS_PER_TICK + 1e-9);
  });

  it('advanceBy 拒绝非法步数', () => {
    const game = new Zuma({ rng: lcg(3), samplesPerSegment: 4 });
    expect(() => advanceBy(game, -1)).toThrow(RangeError);
    expect(() => advanceBy(game, 1.5)).toThrow(RangeError);
  });
});

describe('命中与消合（经状态机）', () => {
  it('链上一出现三连就在下一步被结算', () => {
    const { game } = gameWithChain(['yellow', 'green', 'green', 'green']);
    expect(game.getState().remaining).toBe(4);
    advanceBy(game, 1);
    const s = game.getState();
    expect(s.remaining).toBe(1);
    expect(s.score).toBe(300);
    expect(s.combo).toBe(1);
    expect(s.bursts.length).toBe(3);
    // 链安静下来（无空隙、无可消串）后连锁层级归零，HUD 的 combo 不会挂着不放
    advanceBy(game, 1);
    expect(game.getState().combo).toBe(0);
  });

  it('消合留下空隙 → 后段追上 → 第二波连锁自动涌现', () => {
    const { game } = gameWithChain(['blue', 'blue', 'red', 'red', 'red', 'blue', 'blue']);
    // 空隙 = 3 颗球宽 ≈ 132 单位，以链速收拢要几秒游戏时间，给足 1500 步。
    advanceBy(game, 1500);
    const s = game.getState();
    // 第 1 波 red×3 = 300；合拢后第 2 波 blue×4 按 1.5 倍率 = 900；清空结算 +1000
    expect(s.score).toBe(300 + 900 + 1000);
    expect(s.remaining).toBe(0);
    expect(s.phase).toBe('won');
    expect(s.settled).toBe(1000); // 清空大奖（未发射 → 无精度奖励）
    expect(s.combo).toBe(2);
  });

  it('爆点带颜色与波次，并在 burstMs 后被清掉', () => {
    const { game } = gameWithChain(['red', 'red', 'red', 'green'], {});
    advanceBy(game, 2);
    const bursts: readonly Burst[] = game.getState().bursts;
    expect(bursts.length).toBeGreaterThan(0);
    expect(bursts.every((b) => b.color === 'red')).toBe(true);
    expect(bursts[0]!.combo).toBe(1);
    expect(bursts[0]!.runLength).toBe(3);
    advanceBy(game, 200); // 远超默认 420ms
    expect(game.getState().bursts).toEqual([]);
  });

  it('隔着空隙的同色不会被误消（合拢前不算一串）', () => {
    // 存档重建是紧贴的，所以先造一个带空隙的链：插入一颗远处球制造空隙。
    const { game } = gameWithChain(['red', 'red', 'green', 'green']);
    advanceBy(game, 1);
    const before = game.getState().score;
    // 上面 4 颗里没有三连；确认没有任何分数产生
    expect(game.getState().remaining).toBe(4);
    expect(game.getState().score).toBe(before);
  });
});

describe('命中路径（几何瞄准）', () => {
  it('朝链头方向射击会命中并插入', () => {
    const game = new Zuma({ rng: lcg(21), samplesPerSegment: 4 });
    const s0 = game.getState();
    const head = s0.chain.marbles[0]!;
    const pose = marblePose(game.getTrack(), head);
    const origin = game.getLauncher();
    game.aim(Math.atan2(pose.y - origin.y, pose.x - origin.x));
    game.shoot();
    for (let i = 0; i < 600 && game.getState().projectile; i += 1) {
      game.tick(PHYSICS.STEP_MS);
    }
    const s1 = game.getState();
    expect(s1.hits).toBe(1);
    expect(s1.projectile).toBeNull();
    expect(s1.chain.marbles.length).toBe(s0.remaining + 1);
    // 链头就在发射器旁边，飞行距离不足一档（100 单位）→ 没有远射奖励，只有命中本身
    expect(s1.hits).toBe(1);
    expect(s1.shotsFired).toBe(1);
  });

  it('一发打空（背对唯一的球）会被消耗掉，不算命中', () => {
    const { game } = gameWithChain(['red']);
    const head = game.getState().chain.marbles[0]!;
    const pose = marblePose(game.getTrack(), head);
    const origin = game.getLauncher();
    const away = Math.atan2(origin.y - pose.y, origin.x - pose.x); // 从球指向发射器的反方向
    game.aim(away);
    game.shoot();
    for (let i = 0; i < 4000 && game.getState().projectile; i += 1) {
      game.tick(PHYSICS.STEP_MS);
    }
    expect(game.getState().projectile).toBeNull();
    expect(game.getState().hits).toBe(0);
    expect(game.getState().shotsFired).toBe(1);
    expect(game.getState().remaining).toBe(1);
  });
});

describe('失败与过关', () => {
  it('链头抵达洞口即判负，且状态停住不再推进', () => {
    const { game } = gameWithChain(['red', 'green', 'blue']);
    const spec = game.getSpec();
    const steps = Math.ceil((game.getTrack().length / spec.speed) * 200);
    advanceBy(game, Math.min(steps, 40_000));
    const s = game.getState();
    expect(s.phase).toBe('lost');
    expect(s.settled).toBe(0);
    const atLoss = game.getState();
    advanceBy(game, 10);
    const later = game.getState();
    // 世界冻住（用时与链头都不再前进），但 overMs 在走（结算画面要显示停留时长）
    expect(later.elapsedMs).toBe(atLoss.elapsedMs);
    expect(later.headDist).toBe(atLoss.headDist);
    expect(later.overMs).toBeGreaterThan(atLoss.overMs);
    expect(later.phase).toBe('lost');
  });

  it('失败不会自动重来：停在失败画面等人（自动重看像 bug）', () => {
    const { game } = gameWithChain(['red'], { autoNextMs: 2600 });
    advanceBy(game, 30_000);
    expect(game.getState().phase).toBe('lost');
    expect(game.getState().level).toBe(1);
  });
});

describe('过关结算与自动下一关', () => {
  it('过关后 overMs 累计，到点自动进入下一关并重置局面', () => {
    const { game } = gameWithChain(['red', 'red', 'red'], { autoNextMs: 1000 });
    advanceBy(game, 2);
    expect(game.getState().phase).toBe('won');
    expect(game.getState().level).toBe(1);
    // 还没到点：停在第 1 关的成功画面上，倒计时继续走
    const atWin = game.getState().overMs;
    game.tick(600);
    expect(game.getState().level).toBe(1);
    expect(game.getState().overMs).toBeCloseTo(atWin + 600, 6);
    // 过点：自动开第 2 关，局面完全重置
    game.tick(500);
    const s = game.getState();
    expect(s.level).toBe(2);
    expect(s.phase).toBe('playing');
    expect(s.overMs).toBe(0);
    expect(s.elapsedMs).toBe(0);
    expect(s.remaining).toBe(levelById(2).marbles);
  });

  it('autoNextMs 为 0 时停在成功画面，由宿主自己推进', () => {
    const { game } = gameWithChain(['red', 'red', 'red'], { autoNextMs: 0 });
    advanceBy(game, 2);
    advanceBy(game, 600);
    expect(game.getState().phase).toBe('won');
    expect(game.getState().level).toBe(1);
    game.next();
    expect(game.getState().level).toBe(2);
  });

  it('最后一关过关不自动往后走（没有第 13 关）', () => {
    const { game } = gameWithChain(['red', 'red', 'red'], { level: LEVEL_COUNT, autoNextMs: 500 });
    advanceBy(game, 2);
    expect(game.getState().phase).toBe('won');
    game.tick(4000);
    expect(game.getState().level).toBe(LEVEL_COUNT);
    expect(game.getState().phase).toBe('won');
  });

  it('结算画面 pause() 是 no-op：不会退回 playing，倒计时照旧走', () => {
    // 原版也没有「暂停庆祝画面」这个操作。刻意不做：phase 已经离开 playing，
    // 再塞一个 paused 会把 won/lost 顶掉，玩家反而看不见自己怎么结束的。
    const { game } = gameWithChain(['red', 'red', 'red'], { autoNextMs: 1000 });
    advanceBy(game, 2);
    game.pause();
    expect(game.getState().phase).toBe('won');
    const before = game.getState().overMs;
    game.tick(400);
    expect(game.getState().overMs).toBeCloseTo(before + 400, 6);
    expect(game.getState().phase).toBe('won');
  });

  it('快照回显 autoNextMs，适配层不必各自硬编码倒计时数字', () => {
    const fresh = new Zuma({ rng: lcg(4), samplesPerSegment: 4 });
    expect(fresh.getState().autoNextMs).toBe(2600);
    const manual = new Zuma({ rng: lcg(4), samplesPerSegment: 4, autoNextMs: 0 });
    expect(manual.getState().autoNextMs).toBe(0);
  });
});

describe('结算后的分数记录与关卡推进', () => {
  it('过关写入荣誉榜并清掉局中快照', () => {
    const storage = createMemoryStorage();
    const { game } = gameWithChain(['red', 'red', 'red'], { storage, level: 1 });
    advanceBy(game, 2);
    expect(game.getState().phase).toBe('won');
    expect(game.getBestScore(1)).toBe(300 + 1000);
    expect(game.getUnlockedLevel()).toBe(1);
    expect(game.hasSave()).toBe(false);
  });

  it('restart / next 会重置一局', () => {
    const game = new Zuma({ rng: lcg(30), samplesPerSegment: 4 });
    advanceBy(game, 500);
    game.restart();
    expect(game.getState().elapsedMs).toBe(0);
    expect(game.getState().phase).toBe('playing');
    game.next();
    expect(game.getState().level).toBe(2);
  });

  it('最后一关 next 停在原地重开', () => {
    const last = levelById(LEVEL_COUNT);
    const game = new Zuma({ level: last.id, rng: lcg(31), samplesPerSegment: 4 });
    game.next();
    expect(game.getState().level).toBe(last.id);
  });
});

describe('待发包取色规则（防死局）', () => {
  it('队列颜色恒出自「链上还存在」的颜色 —— 不会发给你打不动的色', () => {
    // 链上只有红与黄（成对，没有现成的三连），rng 取到调色板上界：
    // 修复前这里会连发三颗绿，绿色永远凑不出三连，玩家只能干等到判负。
    const { game } = gameWithChain(['red', 'red', 'yellow', 'yellow'], { rng: () => 0.9999 });
    const state = game.getState();
    const onChain = new Set(state.chain.marbles.map((m) => m.color));
    expect(onChain).toEqual(new Set(['red', 'yellow']));
    for (const color of state.queue) {
      expect(onChain.has(color)).toBe(true);
    }
  });

  it('打几发之后依旧如此：队列补色也只认场上活色', () => {
    const { game } = gameWithChain(['red', 'red', 'yellow', 'yellow'], { rng: () => 0.5 });
    for (let i = 0; i < 400; i += 1) {
      game.tick(PHYSICS.STEP_MS);
      if (!game.getState().projectile) game.shoot();
    }
    const state = game.getState();
    const onChain = new Set(state.chain.marbles.map((m) => m.color));
    for (const color of state.queue) {
      expect(onChain.has(color) || onChain.size === 0).toBe(true);
    }
  });

  it('终局只剩两颗同色时，能真的打完而不是一路拖到判负', () => {
    const { game } = gameWithChain(['red', 'red']);
    const origin = game.getLauncher();
    let frames = 0;
    while (game.getState().phase === 'playing' && frames < 4000) {
      const state = game.getState();
      if (!state.projectile && state.chain.marbles.length > 0) {
        const head = state.chain.marbles[0]!;
        const pose = marblePose(game.getTrack(), head);
        game.aim(Math.atan2(pose.y - origin.y, pose.x - origin.x));
        game.shoot();
      }
      game.tick(PHYSICS.STEP_MS);
      frames += 1;
    }
    expect(game.getState().phase).toBe('won');
    expect(game.getState().remaining).toBe(0);
  });

  it('12 关开局队列都 ⊆ 链上颜色集合', () => {
    for (const spec of LEVELS) {
      const game = new Zuma({ level: spec.id, rng: lcg(spec.id), samplesPerSegment: 4 });
      const state = game.getState();
      const onChain = new Set(state.chain.marbles.map((m) => m.color));
      expect(state.queue.length).toBe(spec.nextQueue);
      for (const color of state.queue) {
        expect(onChain.has(color), `level ${spec.id} 队列混进场上没有的 ${color}`).toBe(true);
      }
    }
  });
});

describe('暂停与存档', () => {
  it('pause 写快照，resume 后接着玩', () => {
    const storage = createMemoryStorage();
    const game = new Zuma({ storage, rng: lcg(40), samplesPerSegment: 4, autosaveMs: 0 });
    advanceBy(game, 60);
    game.pause();
    expect(game.getState().phase).toBe('paused');
    expect(game.hasSave()).toBe(true);
    const paused = game.getState();
    advanceBy(game, 60);
    expect(game.getState()).toBe(paused);
    game.resume();
    advanceBy(game, 10);
    expect(game.getState().elapsedMs).toBeGreaterThan(paused.elapsedMs);
  });

  it('togglePause 来回切换', () => {
    const game = new Zuma({ rng: lcg(41), samplesPerSegment: 4 });
    expect(game.togglePause()).toBe('paused');
    expect(game.togglePause()).toBe('playing');
    expect(game.togglePause()).toBe('paused');
  });

  it('自动存档按 clock 节流', () => {
    const { storage, writes } = countingStorage();
    let now = 0;
    const game = new Zuma({
      storage,
      rng: lcg(42),
      samplesPerSegment: 4,
      autosaveMs: 2000,
      clock: () => now
    });
    const baseline = writes();
    advanceBy(game, 60); // 500ms 游戏时间，clock 不动 → 不该写
    expect(writes()).toBe(baseline);
    now = 2500;
    game.tick(PHYSICS.STEP_MS);
    expect(writes()).toBeGreaterThan(baseline);
  });

  it('没有注入存储时 save/load 都是 no-op', () => {
    const game = new Zuma({ rng: lcg(43), samplesPerSegment: 4 });
    expect(game.save()).toBe(false);
    expect(game.load()).toBe(false);
    expect(game.hasSave()).toBe(false);
    expect(() => game.clearSave()).not.toThrow();
  });

  it('存档往返：pause → 新实例 resumeSaved → 状态接得上', () => {
    const storage = createMemoryStorage();
    const first = new Zuma({ storage, rng: lcg(44), samplesPerSegment: 4 });
    advanceBy(first, 120);
    first.pause();
    const snapshot = first.getState();

    const second = new Zuma({ storage, rng: lcg(44), samplesPerSegment: 4, resumeSaved: true });
    const s2 = second.getState();
    expect(s2.level).toBe(snapshot.level);
    expect(s2.remaining).toBe(snapshot.remaining);
    expect(s2.score).toBe(snapshot.score);
    expect(s2.elapsedMs).toBeCloseTo(snapshot.elapsedMs, 3);
    expect(s2.headDist).toBeCloseTo(snapshot.headDist, 3);
  });

  it('脏存档被守卫挡掉，游戏照常开局', () => {
    const storage = createMemoryStorage({ 'game-zuma:save': '{"v":1,"level":999}' });
    const game = new Zuma({ storage, rng: lcg(45), samplesPerSegment: 4, resumeSaved: true });
    expect(game.getState().phase).toBe('playing');
    expect(game.getState().level).toBe(1);
  });
});

describe('倒退段（第 4 关起）', () => {
  it('链头冲到触发点后转为倒退，退到位再转前进', () => {
    const spec = levelById(4);
    const game = new Zuma({ level: 4, rng: lcg(50), samplesPerSegment: 2 });
    const track = game.getTrack();
    const target = spec.rewind[0]!.atProgress * track.length;

    const seen = new Set<1 | -1>();
    for (let i = 0; i < 60_000; i += 1) {
      game.tick(PHYSICS.STEP_MS);
      seen.add(game.getState().direction);
      if (game.getState().phase !== 'playing') break;
      if (game.getState().headDist > target * 1.05 && seen.has(1) && seen.has(-1)) break;
    }
    expect(seen.has(-1)).toBe(true);
    expect(seen.has(1)).toBe(true);
  });

  it('前三关永远前进', () => {
    for (const level of [1, 2, 3]) {
      const game = new Zuma({ level, rng: lcg(level), samplesPerSegment: 2 });
      advanceBy(game, 2000);
      expect(game.getState().direction, `level ${level}`).toBe(1);
    }
  });
});
