from datetime import datetime, timezone
from dataclasses import dataclass

from app.integrations.ml_client import fetch_ml_scores


@dataclass(slots=True)
class RiskAssessment:
    decision: str
    score: float
    level: str
    reason: str
    message: str
    rule_hits: list[str]
    ml_score: float
    anomaly_score: float
    rule_score: float
    used_live_model: bool
    model_breakdown: dict[str, float]
    anomaly_breakdown: dict[str, float]
    feature_contributions: dict
    model_metadata: dict


def evaluate_risk(
    *_args,
    amount: float,
    failed_attempts: int = 0,
    transaction_frequency: int | None = None,
    device_change: bool | None = None,
    location_change: bool | None = None,
    transaction_time: datetime | None = None,
) -> RiskAssessment:
    resolved_frequency = max(transaction_frequency if transaction_frequency is not None else failed_attempts + 1, 1)
    resolved_device_change = failed_attempts > 0 if device_change is None else device_change
    resolved_location_change = amount > 15000 if location_change is None else location_change
    resolved_transaction_time = transaction_time or datetime.now(timezone.utc)
    hour_of_day = int(resolved_transaction_time.hour)

    rule_hits: list[str] = []
    rule_score = 0.0

    if amount >= 20000:
        rule_score += 0.45
        rule_hits.append("very_high_amount")
    elif amount >= 10000:
        rule_score += 0.25
        rule_hits.append("high_amount")

    if failed_attempts >= 3:
        rule_score += 0.3
        rule_hits.append("multiple_failed_attempts")
    elif failed_attempts > 0:
        rule_score += 0.1
        rule_hits.append("prior_failed_attempts")

    if resolved_frequency >= 5:
        rule_score += 0.15
        rule_hits.append("high_transaction_frequency")

    if resolved_device_change:
        rule_score += 0.1
        rule_hits.append("device_changed")

    if resolved_location_change:
        rule_score += 0.1
        rule_hits.append("location_changed")

    if hour_of_day <= 5 or hour_of_day >= 23:
        rule_score += 0.1
        rule_hits.append("off_hours_transaction")

    rule_score = min(rule_score, 1.0)

    ml_scores = fetch_ml_scores(
        amount=amount,
        transaction_frequency=resolved_frequency,
        device_change=resolved_device_change,
        location_change=resolved_location_change,
        transaction_time=resolved_transaction_time,
    )
    ml_score = max(0.0, min(float(ml_scores["ml_score"]), 1.0))
    anomaly_score = max(0.0, min(float(ml_scores["anomaly_score"]), 1.0))

    final_score = round((ml_score * 0.55) + (anomaly_score * 0.3) + (rule_score * 0.15), 4)

    if final_score >= 0.75:
        decision = "BLOCK"
        level = "high"
        reason = "High fraud probability detected by the ML engine."
        message = "Payment blocked due to high fraud risk."
    elif final_score >= 0.45:
        decision = "OTP_REQUIRED"
        level = "medium"
        reason = "Suspicious transaction pattern detected; additional verification required."
        message = "OTP verification is required for this payment."
    else:
        decision = "ALLOW"
        level = "low"
        reason = "Transaction risk is within the acceptable threshold."
        message = "Payment approved successfully."

    if not ml_scores.get("used_live_model", False):
        reason = f"{reason} Live ML service unavailable, fallback heuristic scoring was used."

    return RiskAssessment(
        decision=decision,
        score=final_score,
        level=level,
        reason=reason,
        message=message,
        rule_hits=rule_hits,
        ml_score=ml_score,
        anomaly_score=anomaly_score,
        rule_score=rule_score,
        used_live_model=bool(ml_scores.get("used_live_model", False)),
        model_breakdown={
            key: round(float(value), 4)
            for key, value in (ml_scores.get("model_breakdown", {}) or {}).items()
        },
        anomaly_breakdown={
            key: round(float(value), 4)
            for key, value in (ml_scores.get("anomaly_breakdown", {}) or {}).items()
        },
        feature_contributions=ml_scores.get("explanation", {}) or {},
        model_metadata=ml_scores.get("metadata", {}) or {},
    )
