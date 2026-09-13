import { describe, expect, it } from 'vitest';
import { inferMagnificRebuildRecipe } from '../src/magnific-rebuild.js';

describe('Magnific rebuild recipes', () => {
  it('maps multi-surface stationery to four editable slots', () => {
    const recipe = inferMagnificRebuildRecipe('05_stationery_mockup.jpeg');
    expect(recipe.slots).toHaveLength(4);
    expect(recipe.slots.map((slot) => slot.label)).toEqual(['LETTERHEAD', 'CARD FRONT', 'CARD BACK', 'ENVELOPE']);
  });

  it('uses a round-sign surface for circular signage', () => {
    const recipe = inferMagnificRebuildRecipe('10_round_store_sign.jpeg');
    expect(recipe.slots).toEqual([{ label: 'ROUND SIGN', hint: 'round-sign' }]);
  });

  it('uses native cylindrical intent for cans and jars', () => {
    expect(inferMagnificRebuildRecipe('14_cold_white_can.jpeg').slots[0].hint).toBe('cylinder');
    expect(inferMagnificRebuildRecipe('20_supplement_jar.jpeg').slots[0].hint).toBe('cylinder');
  });

  it('creates two screen slots for a device workspace', () => {
    const recipe = inferMagnificRebuildRecipe('17_device_workspace.jpeg');
    expect(recipe.slots).toEqual([
      { label: 'TABLET SCREEN', hint: 'screen' },
      { label: 'PHONE SCREEN', hint: 'screen' },
    ]);
  });
});
