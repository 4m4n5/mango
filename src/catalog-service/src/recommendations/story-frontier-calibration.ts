export const STORY_FRONTIER_CALIBRATION_VERSION = 'vod-story-frontier-calibration-v1' as const;
export const STORY_FRONTIER_CALIBRATION_ALPHA = 0.1;
export const STORY_FRONTIER_MIN_STRATUM = 20;

export type StoryFrontierCalibrationSample = {
  stratum: string;
  partial_score: number;
  full_score: number;
};

export type StoryFrontierCalibrationBand = {
  stratum: string;
  sample_count: number;
  lower_residual: number;
  upper_residual: number;
  empirical_coverage: number;
  status: 'calibrated' | 'pooled' | 'provisional' | 'insufficient';
};

function finiteSamples(samples: readonly StoryFrontierCalibrationSample[]): StoryFrontierCalibrationSample[] {
  return samples.filter((sample) => (
    sample.stratum.length > 0
      && Number.isFinite(sample.partial_score)
      && Number.isFinite(sample.full_score)
  ));
}

/** Conservative split-conformal order statistic (ceil((n + 1)q)). */
function conformalQuantile(values: readonly number[], quantile: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const rank = Math.max(1, Math.min(sorted.length, Math.ceil((sorted.length + 1) * quantile)));
  return sorted[rank - 1]!;
}

function bandFor(
  label: string,
  own: readonly StoryFrontierCalibrationSample[],
  source: readonly StoryFrontierCalibrationSample[],
  status: StoryFrontierCalibrationBand['status'],
  alpha: number,
): StoryFrontierCalibrationBand {
  if (source.length === 0) {
    return {
      stratum: label,
      sample_count: own.length,
      lower_residual: 0,
      upper_residual: 0,
      empirical_coverage: 0,
      status: 'insufficient',
    };
  }
  const residuals = source.map((sample) => sample.full_score - sample.partial_score);
  const lower = conformalQuantile(residuals, alpha / 2);
  const upper = conformalQuantile(residuals, 1 - alpha / 2);
  const covered = own.filter((sample) => {
    const residual = sample.full_score - sample.partial_score;
    return residual >= lower && residual <= upper;
  }).length;
  return {
    stratum: label,
    sample_count: own.length,
    lower_residual: lower,
    upper_residual: upper,
    empirical_coverage: own.length > 0 ? covered / own.length : 0,
    status,
  };
}

/**
 * Computes local score-error bands from masked/full StoryDNA replay. These are
 * calibration diagnostics and acquisition bounds, never learned rank weights.
 */
export function buildStoryFrontierCalibration(
  rawSamples: readonly StoryFrontierCalibrationSample[],
  options: { alpha?: number; min_stratum?: number } = {},
): StoryFrontierCalibrationBand[] {
  const samples = finiteSamples(rawSamples);
  const alpha = options.alpha ?? STORY_FRONTIER_CALIBRATION_ALPHA;
  const minimum = options.min_stratum ?? STORY_FRONTIER_MIN_STRATUM;
  if (!(alpha > 0 && alpha < 1)) throw new Error('calibration alpha must be between zero and one');
  if (!Number.isInteger(minimum) || minimum < 2) throw new Error('minimum stratum must be an integer >= 2');

  const pooledStatus: StoryFrontierCalibrationBand['status'] = samples.length >= minimum
    ? 'calibrated'
    : samples.length > 0 ? 'provisional' : 'insufficient';
  const output = [bandFor('__pooled__', samples, samples, pooledStatus, alpha)];
  const strata = [...new Set(samples.map((sample) => sample.stratum))].sort();
  for (const stratum of strata) {
    const own = samples.filter((sample) => sample.stratum === stratum);
    output.push(own.length >= minimum
      ? bandFor(stratum, own, own, 'calibrated', alpha)
      : bandFor(stratum, own, samples, samples.length >= minimum ? 'pooled' : 'provisional', alpha));
  }
  return output;
}

export function storyFrontierBandFor(
  bands: readonly StoryFrontierCalibrationBand[],
  stratum: string,
): StoryFrontierCalibrationBand | null {
  return bands.find((band) => band.stratum === stratum)
    ?? bands.find((band) => band.stratum === '__pooled__')
    ?? null;
}
