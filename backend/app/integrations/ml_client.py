from datetime import datetime, timezone

import requests

from app.core.config import settings


def fetch_ml_scores(
    *,
    amount: float,
    transaction_frequency: int,
    device_change: bool,
    location_change: bool,
    transaction_time: datetime | None = None,
) -> dict:
    effective_time = transaction_time or datetime.now(timezone.utc)
    payload = {
        "amount": amount,
        "transaction_frequency": transaction_frequency,
        "device_change": device_change,
        "location_change": location_change,
        "transaction_time": effective_time.isoformat(),
    }

    try:
        response = requests.post(
            settings.ml_api_url,
            json=payload,
            timeout=settings.ml_timeout_seconds,
        )
        response.raise_for_status()
        data = response.json()
        return {
            "ml_score": float(data.get("fraud_probability", 0.35)),
            "anomaly_score": float(data.get("anomaly_score", 0.35)),
            "model_breakdown": data.get("model_breakdown", {}) or {},
            "anomaly_breakdown": data.get("anomaly_breakdown", {}) or {},
            "explanation": data.get("explanation", {}) or {},
            "metadata": data.get("metadata", {}) or {},
            "used_live_model": True,
        }
    except (requests.RequestException, TypeError, ValueError):
        fallback = min(max(amount / 20000, 0.1), 0.9)
        anomaly = min(max(transaction_frequency / 10, 0.1), 0.9)
        return {
            "ml_score": round(fallback, 4),
            "anomaly_score": round(anomaly, 4),
            "model_breakdown": {},
            "anomaly_breakdown": {},
            "explanation": {},
            "metadata": {},
            "used_live_model": False,
        }
