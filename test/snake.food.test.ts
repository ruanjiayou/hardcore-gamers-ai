import { describe, expect, test } from 'bun:test';
import { mergeFoodDelta, type BotFood } from '../src/engine/snake';

/**
 * 拾取物是**增量同步**的：服务端每帧只发 `foodAdd` / `foodDel`，
 * 每 200 tick（或开局/中途加入/落库）才发一次全量帧。
 *
 * 这个纯函数是机器人「看到食物」的唯一入口，错了会表现成：
 * - 机器人不吃东西（表永远是空的）；
 * - 场上凭空多出食物 / 吃掉的食物又出现。
 */
const food = (id: number, x = 100, y = 100): BotFood => ({ id, x, y, v: 6, k: 0 });

describe('拾取物增量合并（robot 侧）', () => {
  test('foodFull：整表替换（开局首帧）', () => {
    let foods: BotFood[] = [];
    foods = mergeFoodDelta(foods, { foodFull: true, food: [food(1), food(2)] });
    expect(foods.map(f => f.id)).toEqual([1, 2]);
    foods = mergeFoodDelta(foods, { foodFull: true, food: [food(9)] });
    expect(foods.map(f => f.id)).toEqual([9]);
  });

  test('没有 foodFull 标志但带 food 数组也当全量（兼容旧服务端）', () => {
    const foods = mergeFoodDelta([], { food: [food(1), food(2), food(3)] });
    expect(foods).toHaveLength(3);
  });

  test('增量帧：按 id 删除 + 追加新增', () => {
    let foods = mergeFoodDelta([], { foodFull: true, food: [food(1), food(2), food(3)] });
    foods = mergeFoodDelta(foods, { foodDel: [2], foodAdd: [food(4)] });
    expect(foods.map(f => f.id)).toEqual([1, 3, 4]);
  });

  test('增量帧不会让机器人看到空场地（旧实现直读 state.food 的坑）', () => {
    // 增量帧里既没有 food 数组也没有 foodFull —— 早期实现直接读 state.food 会拿到 undefined
    let foods = mergeFoodDelta([], { foodFull: true, food: [food(1), food(2)] });
    foods = mergeFoodDelta(foods, { foodFull: false, foodAdd: [food(3)] });
    expect(foods.map(f => f.id)).toEqual([1, 2, 3]);
  });

  test('重复的新增不会出现两个一样的拾取物', () => {
    let foods = mergeFoodDelta([], { foodFull: true, food: [food(1)] });
    foods = mergeFoodDelta(foods, { foodAdd: [food(1), food(2)] });
    expect(foods.map(f => f.id)).toEqual([1, 2]);
  });

  test('没有 id 的旧数据不会被 foodDel 误删', () => {
    let foods = mergeFoodDelta([], { food: [{ x: 10, y: 10, v: 6, k: 0 }] });
    foods = mergeFoodDelta(foods, { foodDel: [1, 2] });
    expect(foods).toHaveLength(1);
  });

  test('空增量帧：表保持不变（不能被清空）', () => {
    let foods = mergeFoodDelta([], { foodFull: true, food: [food(1), food(2)] });
    foods = mergeFoodDelta(foods, { foodFull: false });
    expect(foods.map(f => f.id)).toEqual([1, 2]);
  });

  test('全量帧会丢掉之前残留的条目（对局重开后不会带着旧食物）', () => {
    let foods = mergeFoodDelta([], { foodFull: true, food: [food(1), food(2), food(3)] });
    foods = mergeFoodDelta(foods, { foodFull: true, food: [] });
    expect(foods).toHaveLength(0);
  });

  test('纯函数：不改动传入的数组（原数组保持不变）', () => {
    const prev = [food(1), food(2)];
    const next = mergeFoodDelta(prev, { foodAdd: [food(3)] });
    expect(prev).toHaveLength(2);
    expect(next).toHaveLength(3);
  });

  test('foodMove：按 id 更新坐标（磁铁吸附）', () => {
    let foods = mergeFoodDelta([], { foodFull: true, food: [food(1, 100, 100)] });
    foods = mergeFoodDelta(foods, { foodMove: [{ id: 1, x: 140, y: 80 }] });
    expect(foods[0].x).toBe(140);
    expect(foods[0].y).toBe(80);
  });

  test('foodMove：id 不存在时忽略', () => {
    let foods = mergeFoodDelta([], { foodFull: true, food: [food(1)] });
    foods = mergeFoodDelta(foods, { foodMove: [{ id: 42, x: 1, y: 2 }] });
    expect(foods).toHaveLength(1);
    expect(foods[0].x).toBe(100);
  });
});
