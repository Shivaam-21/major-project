"""Local, model-agnostic explanations for fraud predictions.

Uses mean-baseline occlusion: each feature (already standard-scaled, so the
training mean is 0.0) is replaced by its baseline one at a time and the
ensemble is re-scored. The drop in fraud probability is that feature's
contribution to the current prediction. Positive values push the prediction
toward fraud, negative values pull it toward legitimate.
"""

from typing import Callable

import numpy as np

from app.utils.preprocess import FEATURE_COLUMNS


def explain_contributions(
    scaled_features: np.ndarray,
    base_probability: float,
    probability_fn: Callable[[np.ndarray], float],
) -> dict:
    contributions: dict[str, float] = {}
    for index, feature in enumerate(FEATURE_COLUMNS):
        occluded = np.array(scaled_features, dtype=float, copy=True)
        occluded[0, index] = 0.0
        contributions[feature] = round(base_probability - probability_fn(occluded), 4)

    baseline_probability = probability_fn(np.zeros_like(scaled_features, dtype=float))
    return {
        "method": "mean_baseline_occlusion",
        "baselineProbability": round(float(baseline_probability), 4),
        "contributions": contributions,
    }
