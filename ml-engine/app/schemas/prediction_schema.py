from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


class PredictionRequest(BaseModel):
    amount: float = Field(gt=0)
    transaction_frequency: int = Field(ge=0)
    device_change: bool
    location_change: bool
    transaction_time: datetime


class PredictionResponse(BaseModel):
    fraud_probability: float
    anomaly_score: float
    model_breakdown: dict[str, float] = Field(default_factory=dict)
    anomaly_breakdown: dict[str, float] = Field(default_factory=dict)
    explanation: dict[str, Any] = Field(default_factory=dict)
    metadata: dict[str, Any] = Field(default_factory=dict)
