/**
 * The model/effort rules the Models editor uses (extracted from V1's `Settings.tsx`, VS-252/VS-284):
 * a model outside a runtime's known list is "custom" with a free-text id; a non-empty effort list is
 * a picker, an empty one hides the control, and an unknown list (or a custom model) is free text.
 */
import type { ModelSetting, RuntimeModel } from '../../api/types';

export function isCustomModel(model: string | null, known: RuntimeModel[]): boolean {
  return model !== null && known.length > 0 && !known.some((m) => m.id === model);
}

export function effortsForModel(model: string | null, known: RuntimeModel[], custom: boolean): string[] | undefined {
  if (custom || model == null) return undefined;
  return known.find((m) => m.id === model)?.efforts;
}

export type EffortMode = 'picker' | 'hidden' | 'freetext';

export function effortModeFor(efforts: string[] | undefined, stored: string | undefined): EffortMode {
  if (efforts && efforts.length > 0) return !stored || efforts.includes(stored) ? 'picker' : 'freetext';
  if (efforts && efforts.length === 0) return 'hidden';
  return 'freetext';
}

/** Drop a stored effort the new model does not list; keep it when the new model is unknown. */
export function settingAfterModelChange(setting: ModelSetting, model: string | null, known: RuntimeModel[]): ModelSetting {
  const custom = isCustomModel(model, known);
  const efforts = effortsForModel(model, known, custom);
  let effort = setting.effort;
  if (effort && efforts && (efforts.length === 0 || !efforts.includes(effort))) effort = undefined;
  return { ...setting, model, effort };
}
