import numpy as np

from app.schemas.prediction_schema import PredictionRequest, PredictionResponse
from app.services.anomaly_detector import score_anomaly
from app.services.explainer import explain_contributions
from app.services.model_loader import (
    load_label_propagation_model,
    load_logistic_regression_model,
    load_random_forest_model,
    load_scaler,
    load_self_training_model,
)
from app.utils.preprocess import FEATURE_COLUMNS, build_feature_frame


def _safe_binary_probability(model, scaled_features, positive_class: int = 1) -> float:
    probabilities = np.asarray(model.predict_proba(scaled_features), dtype=float)
    probabilities = np.nan_to_num(probabilities, nan=0.0, posinf=1.0, neginf=0.0)
    row_sums = probabilities.sum(axis=1, keepdims=True)
    zero_rows = row_sums.squeeze(axis=1) == 0
    if np.any(zero_rows):
        predictions = model.predict(scaled_features[zero_rows])
        for row_index, prediction in zip(np.where(zero_rows)[0], predictions, strict=False):
            probabilities[row_index] = 0.0
            if prediction in model.classes_:
                class_index = int(np.where(model.classes_ == prediction)[0][0])
                probabilities[row_index, class_index] = 1.0
    row_sums = probabilities.sum(axis=1, keepdims=True)
    row_sums[row_sums == 0] = 1.0
    probabilities = probabilities / row_sums
    if positive_class not in model.classes_:
        return 0.0
    class_index = int(np.where(model.classes_ == positive_class)[0][0])
    return float(probabilities[0][class_index])


def _supervised_breakdown(scaled_features) -> dict[str, float]:
    return {
        "random_forest": _safe_binary_probability(load_random_forest_model(), scaled_features),
        "logistic_regression": _safe_binary_probability(load_logistic_regression_model(), scaled_features),
        "self_training": _safe_binary_probability(load_self_training_model(), scaled_features),
        "label_propagation": _safe_binary_probability(load_label_propagation_model(), scaled_features),
    }


def _ensemble_probability(scaled_features) -> float:
    return float(np.mean(list(_supervised_breakdown(scaled_features).values())))


def predict_fraud(payload: PredictionRequest) -> PredictionResponse:
    features = build_feature_frame(payload)
    scaler = load_scaler()
    scaled = scaler.transform(features[FEATURE_COLUMNS])
    supervised_breakdown = _supervised_breakdown(scaled)
    fraud_probability = round(float(np.mean(list(supervised_breakdown.values()))), 4)
    anomaly_score, anomaly_breakdown = score_anomaly(features)
    explanation = explain_contributions(scaled, fraud_probability, _ensemble_probability)
    return PredictionResponse(
        fraud_probability=fraud_probability,
        anomaly_score=anomaly_score,
        model_breakdown={key: round(value, 4) for key, value in supervised_breakdown.items()},
        anomaly_breakdown=anomaly_breakdown,
        explanation=explanation,
        metadata={
            "supervised_algorithms": [
                "Random Forest",
                "Logistic Regression",
                "Self-Training",
                "Label Propagation",
            ],
            "unsupervised_algorithms": [
                "Isolation Forest",
                "K-Means Clustering",
            ],
        },
    )
