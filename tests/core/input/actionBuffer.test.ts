import { beforeEach, describe, expect, it } from 'vitest';
import { ActionBuffer } from '@core/input/actionBuffer';

type Action = 'spell1' | 'spell2' | 'convergence';

describe('ActionBuffer', () => {
  let buffer: ActionBuffer<Action>;

  beforeEach(() => {
    buffer = new ActionBuffer<Action>();
  });

  it('returns false for an action that was never pressed', () => {
    buffer.update();
    expect(buffer.consume('spell1')).toBe(false);
  });

  it('consumes a press exactly once', () => {
    buffer.press('spell1');
    buffer.update();
    expect(buffer.consume('spell1')).toBe(true);
    expect(buffer.consume('spell1')).toBe(false);
  });

  it('counts several presses in one frame as one', () => {
    buffer.press('spell1');
    buffer.press('spell1');
    buffer.update();
    expect(buffer.consume('spell1')).toBe(true);
    expect(buffer.consume('spell1')).toBe(false);
  });

  it('catches a press and release within one frame, because only the press is buffered', () => {
    // A key that goes down and up between two updates only ever calls press().
    buffer.press('convergence');
    buffer.update();
    expect(buffer.consume('convergence')).toBe(true);
  });

  it('drops an unconsumed action after one frame', () => {
    buffer.press('convergence');
    buffer.update();
    buffer.update();
    expect(buffer.consume('convergence')).toBe(false);
  });

  it('does not show a press made after update until the next update', () => {
    buffer.update();
    buffer.press('spell2');
    expect(buffer.consume('spell2')).toBe(false);
    buffer.update();
    expect(buffer.consume('spell2')).toBe(true);
  });

  it('keeps a consumed press consumed after the next update', () => {
    buffer.press('spell1');
    buffer.update();
    expect(buffer.consume('spell1')).toBe(true);
    buffer.update();
    expect(buffer.consume('spell1')).toBe(false);
  });

  it('accepts a new press of the same action in the frame it was consumed', () => {
    buffer.press('spell1');
    buffer.update();
    expect(buffer.consume('spell1')).toBe(true);
    buffer.press('spell1');
    buffer.update();
    expect(buffer.consume('spell1')).toBe(true);
  });

  it('tracks different actions independently', () => {
    buffer.press('spell1');
    buffer.press('spell2');
    buffer.update();
    expect(buffer.consume('spell2')).toBe(true);
    expect(buffer.consume('convergence')).toBe(false);
    expect(buffer.consume('spell1')).toBe(true);
  });

  it('reset clears ready actions', () => {
    buffer.press('spell1');
    buffer.update();
    buffer.reset();
    expect(buffer.consume('spell1')).toBe(false);
  });

  it('reset clears pending actions', () => {
    buffer.press('spell2');
    buffer.reset();
    buffer.update();
    expect(buffer.consume('spell2')).toBe(false);
  });

  it('accepts new presses after reset', () => {
    buffer.press('spell1');
    buffer.reset();
    buffer.press('spell1');
    buffer.update();
    expect(buffer.consume('spell1')).toBe(true);
  });
});
