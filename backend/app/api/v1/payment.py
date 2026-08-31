from __future__ import annotations

from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
import json
import logging
import secrets
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.dependencies import get_current_admin, get_current_user
from app.api.v1.live import broadcast_event
from app.core.config import settings
from app.db.session import get_db
from app.integrations.email_client import EmailNotConfiguredError, send_email
from app.models.alert import Alert
from app.models.otp_state import OtpState
from app.models.transaction import Transaction
from app.models.user import User
from app.services.risk_engine import evaluate_risk

router = APIRouter(prefix="/payment", tags=["payment"])
logger = logging.getLogger(__name__)

_CATEGORIES = (
    "Transfers",
    "Shopping",
    "Subscriptions",
    "Bills",
    "Food",
)
MODEL_METRICS_PATH = Path(__file__).resolve().parents[4] / "ml-engine" / "models" / "metrics.json"


class PaymentRequest(BaseModel):
    amount: float = Field(gt=0)
    receiver_name: str = Field(min_length=2, max_length=120)
    receiver_account: str = Field(min_length=4, max_length=64)
    failed_attempts: int = Field(default=0, ge=0)
    transaction_frequency: int = Field(default=1, ge=1, le=100)
    device_change: bool = False
    location_change: bool = False
    hour_of_day: int | None = Field(default=None, ge=0, le=23)


class PaymentResponse(BaseModel):
    transaction_id: str
    decision: str
    risk_score: float
    risk_level: str
    message: str


class OtpSendRequest(BaseModel):
    transaction_id: str = Field(min_length=8, max_length=64)


class OtpVerifyRequest(BaseModel):
    transaction_id: str = Field(min_length=8, max_length=64)
    otp_code: str = Field(min_length=6, max_length=6, pattern="^[0-9]{6}$")


class AlertUpdateRequest(BaseModel):
    status: str = Field(pattern="^(open|investigating|resolved|dismissed)$")
    assignee: str | None = Field(default=None, max_length=120)
    note: str | None = Field(default=None, max_length=500)


def _severity_from_score(score: float, status: str) -> str:
    if status == "failed" or score >= 70:
        return "high"
    if score >= 45:
        return "medium"
    return "low"


def _serialize_transaction(transaction: Transaction) -> dict:
    return {
        "id": transaction.id,
        "userId": transaction.user_id,
        "amount": transaction.amount,
        "receiverName": transaction.receiver_name,
        "receiverAccount": transaction.receiver_account,
        "status": transaction.status,
        "riskScore": transaction.risk_score,
        "riskLevel": transaction.risk_level,
        "decision": transaction.decision,
        "message": transaction.message,
        "date": transaction.date,
        "category": transaction.category,
        "features": transaction.features or {},
        "explanation": transaction.explanation or {},
        "otpSentAt": transaction.otp_sent_at.isoformat() if transaction.otp_sent_at else None,
    }


def _serialize_alert(alert: Alert) -> dict:
    return {
        "id": alert.id,
        "transactionId": alert.transaction_id,
        "userId": alert.user_id,
        "message": alert.message,
        "severity": alert.severity,
        "timestamp": alert.timestamp.isoformat(),
        "updatedAt": alert.updated_at.isoformat(),
        "status": alert.status,
        "assignee": alert.assignee,
        "notes": alert.notes or [],
        "riskScore": alert.risk_score,
        "explanation": alert.explanation or {},
        "features": alert.features or {},
    }


def _transaction_scope_query(current_user: User):
    stmt = select(Transaction)
    if current_user.role != "admin":
        stmt = stmt.where(Transaction.user_id == current_user.id)
    return stmt


def _alert_scope_query(current_user: User):
    stmt = select(Alert)
    if current_user.role != "admin":
        stmt = stmt.where(Alert.user_id == current_user.id)
    return stmt


def _get_transaction_for_user(db: Session, transaction_id: str, current_user: User) -> Transaction | None:
    tx = db.get(Transaction, transaction_id)
    if tx is None:
        return None
    if current_user.role != "admin" and tx.user_id != current_user.id:
        return None
    return tx


def _as_utc(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _build_alert(db: Session, transaction: Transaction) -> Alert | None:
    risk_score = float(transaction.risk_score or 0)
    if risk_score < 40 and transaction.status != "failed":
        return None

    existing = db.scalar(select(Alert).where(Alert.transaction_id == transaction.id))
    severity = _severity_from_score(risk_score, transaction.status)
    explanation = transaction.explanation or {}
    features = transaction.features or {}
    title = "High risk score transaction detected" if severity == "high" else "Suspicious transaction requires review"
    if transaction.status == "failed":
        title = "Transaction blocked due to fraud risk"

    if existing:
        existing.severity = severity
        existing.message = title
        existing.risk_score = risk_score
        existing.explanation = explanation
        existing.features = features
        existing.user_id = transaction.user_id
        db.add(existing)
        db.flush()
        return existing

    alert = Alert(
        id=f"alert_{uuid4().hex[:12]}",
        transaction_id=transaction.id,
        user_id=transaction.user_id,
        message=title,
        severity=severity,
        status="open",
        assignee=None,
        notes=[],
        risk_score=risk_score,
        explanation=explanation,
        features=features,
    )
    db.add(alert)
    db.flush()
    return alert


@router.post("/create", response_model=PaymentResponse)
def create_payment(
    payload: PaymentRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> PaymentResponse:
    created_at = datetime.now(timezone.utc)
    transaction_time = created_at
    if payload.hour_of_day is not None:
        transaction_time = created_at.replace(
            hour=payload.hour_of_day,
            minute=0,
            second=0,
            microsecond=0,
        )

    risk = evaluate_risk(
        amount=payload.amount,
        failed_attempts=payload.failed_attempts,
        transaction_frequency=payload.transaction_frequency,
        device_change=payload.device_change,
        location_change=payload.location_change,
        transaction_time=transaction_time,
    )

    transaction_count = db.scalar(select(func.count()).select_from(Transaction)) or 0
    category = _CATEGORIES[transaction_count % len(_CATEGORIES)]
    transaction_id = uuid4().hex

    status = "completed"
    if risk.decision == "OTP_REQUIRED":
        status = "pending"
    elif risk.decision == "BLOCK":
        status = "failed"

    risk_percent = round(risk.score * 100, 2)
    transaction = Transaction(
        id=transaction_id,
        user_id=current_user.id,
        amount=float(payload.amount),
        receiver_name=payload.receiver_name,
        receiver_account=payload.receiver_account,
        status=status,
        risk_score=risk_percent,
        risk_level=risk.level,
        decision=risk.decision,
        message=risk.message,
        date=created_at.astimezone(timezone.utc).strftime("%Y-%m-%d"),
        category=category,
        features={
            "amount": payload.amount,
            "transaction_frequency": payload.transaction_frequency,
            "device_change": payload.device_change,
            "location_change": payload.location_change,
            "hour_of_day": transaction_time.hour,
        },
        explanation={
            "mlScore": round(risk.ml_score * 100, 2),
            "anomalyScore": round(risk.anomaly_score * 100, 2),
            "ruleScore": round(risk.rule_score * 100, 2),
            "ruleHits": list(risk.rule_hits),
            "modelBreakdown": risk.model_breakdown,
            "anomalyBreakdown": risk.anomaly_breakdown,
            "featureContributions": risk.feature_contributions,
            "modelMetadata": risk.model_metadata,
            "usedLiveModel": risk.used_live_model,
            "reason": risk.reason,
        },
    )
    db.add(transaction)
    db.flush()
    alert = _build_alert(db, transaction)
    db.commit()

    broadcast_event("NEW_TRANSACTION", transaction=_serialize_transaction(transaction))
    if alert is not None:
        broadcast_event("FRAUD_ALERT", alert=_serialize_alert(alert))

    if risk.decision == "OTP_REQUIRED":
        return PaymentResponse(
            transaction_id=transaction_id,
            decision=risk.decision,
            risk_score=risk_percent,
            risk_level=risk.level,
            message="Risk score is high. Click 'Send OTP' to receive the code on your email and complete the payment.",
        )

    return PaymentResponse(
        transaction_id=transaction_id,
        decision=risk.decision,
        risk_score=risk_percent,
        risk_level=risk.level,
        message=risk.message,
    )


@router.post("/otp/send", response_model=PaymentResponse)
def send_payment_otp(
    payload: OtpSendRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> PaymentResponse:
    tx = _get_transaction_for_user(db, payload.transaction_id, current_user)
    if tx is None:
        raise HTTPException(status_code=404, detail="Transaction not found")
    if tx.decision != "OTP_REQUIRED" or tx.status != "pending":
        raise HTTPException(status_code=400, detail="OTP can only be sent for pending OTP-required transactions")

    otp_code = f"{secrets.randbelow(1_000_000):06d}"
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=settings.otp_expiry_minutes)
    state = db.get(OtpState, tx.id)
    if state is None:
        state = OtpState(
            transaction_id=tx.id,
            code=otp_code,
            expires_at=expires_at,
            attempts=0,
            verified=False,
            sent_at=datetime.now(timezone.utc),
        )
    else:
        state.code = otp_code
        state.expires_at = expires_at
        state.attempts = 0
        state.verified = False
        state.sent_at = datetime.now(timezone.utc)
    tx.otp_sent_at = state.sent_at
    db.add(state)
    db.add(tx)
    db.flush()

    try:
        send_email(
            to_email=current_user.email,
            subject="Your transaction OTP",
            body=(
                "Your OTP for the transaction is:\n\n"
                f"{otp_code}\n\n"
                f"It expires in {settings.otp_expiry_minutes} minutes."
            ),
        )
        tx.message = "OTP sent to your email. Enter it to complete the payment."
        db.add(tx)
        db.commit()
        return PaymentResponse(
            transaction_id=tx.id,
            decision="OTP_REQUIRED",
            risk_score=float(tx.risk_score),
            risk_level=str(tx.risk_level),
            message=tx.message,
        )
    except EmailNotConfiguredError as exc:
        if not settings.allow_otp_response_fallback:
            db.rollback()
            raise HTTPException(status_code=503, detail=str(exc)) from exc

        logger.warning(
            "SMTP is not configured; returning OTP in API response for local testing. transaction_id=%s user_id=%s",
            tx.id,
            current_user.id,
        )
        tx.message = (
            "SMTP is not configured on the backend, so the OTP could not be emailed. "
            f"Use this OTP for local testing: {otp_code}"
        )
        db.add(tx)
        db.commit()
        return PaymentResponse(
            transaction_id=tx.id,
            decision="OTP_REQUIRED",
            risk_score=float(tx.risk_score),
            risk_level=str(tx.risk_level),
            message=tx.message,
        )
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=502, detail="Failed to send OTP email") from exc


@router.post("/otp/verify", response_model=PaymentResponse)
def verify_payment_otp(
    payload: OtpVerifyRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> PaymentResponse:
    tx = _get_transaction_for_user(db, payload.transaction_id, current_user)
    if tx is None:
        raise HTTPException(status_code=404, detail="Transaction not found")
    if tx.decision != "OTP_REQUIRED" or tx.status != "pending":
        raise HTTPException(status_code=400, detail="OTP verification is only available for pending OTP transactions")

    state = db.get(OtpState, tx.id)
    if state is None or not state.code:
        raise HTTPException(status_code=404, detail="OTP not generated yet. Click 'Send OTP' first.")
    if state.verified:
        raise HTTPException(status_code=400, detail="OTP already used")
    if _as_utc(state.expires_at) < datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="OTP expired. Click 'Resend OTP'.")
    if state.attempts >= settings.otp_max_attempts:
        tx.status = "failed"
        tx.message = "Maximum OTP attempts exceeded"
        db.add(tx)
        alert = _build_alert(db, tx)
        db.commit()
        broadcast_event("TRANSACTION_UPDATED", transaction=_serialize_transaction(tx))
        if alert is not None:
            broadcast_event("FRAUD_ALERT", alert=_serialize_alert(alert))
        raise HTTPException(status_code=400, detail="Maximum OTP attempts exceeded")

    state.attempts += 1
    if payload.otp_code != state.code:
        db.add(state)
        db.commit()
        raise HTTPException(status_code=400, detail="Invalid OTP")

    state.verified = True
    tx.status = "completed"
    tx.decision = "ALLOW"
    tx.message = "Payment processed successfully"
    db.add(state)
    db.add(tx)
    _build_alert(db, tx)
    db.commit()

    broadcast_event("TRANSACTION_UPDATED", transaction=_serialize_transaction(tx))

    return PaymentResponse(
        transaction_id=tx.id,
        decision="ALLOW",
        risk_score=float(tx.risk_score),
        risk_level=str(tx.risk_level),
        message="OTP verified. Payment completed successfully.",
    )


@router.get("/transactions")
def get_transactions(
    limit: int | None = Query(default=None, ge=1, le=200),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[dict]:
    stmt = _transaction_scope_query(current_user).order_by(Transaction.created_at.desc())
    if limit is not None:
        stmt = stmt.limit(limit)
    transactions = db.scalars(stmt).all()
    return [_serialize_transaction(item) for item in transactions]


@router.get("/alerts")
def get_alerts(
    limit: int = Query(default=50, ge=1, le=200),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[dict]:
    alerts = db.scalars(_alert_scope_query(current_user).order_by(Alert.updated_at.desc()).limit(limit)).all()
    return [_serialize_alert(item) for item in alerts]


@router.post("/alerts/{alert_id}")
def update_alert(
    alert_id: str,
    payload: AlertUpdateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    alert = db.get(Alert, alert_id)
    if alert is None:
        raise HTTPException(status_code=404, detail="Alert not found")
    if current_user.role != "admin" and alert.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Alert not found")

    alert.status = payload.status
    alert.assignee = payload.assignee
    notes = list(alert.notes or [])
    if payload.note:
        notes.append(
            {
                "message": payload.note,
                "createdAt": datetime.now(timezone.utc).isoformat(),
            }
        )
    alert.notes = notes
    db.add(alert)
    db.commit()
    db.refresh(alert)
    serialized = _serialize_alert(alert)
    broadcast_event("ALERT_UPDATED", alert=serialized)
    return serialized


@router.get("/model-metrics")
def get_model_metrics() -> dict:
    if not MODEL_METRICS_PATH.exists():
        return {"available": False, "metrics": {}}
    with MODEL_METRICS_PATH.open("r", encoding="utf-8") as handle:
        metrics = json.load(handle)
    return {"available": True, "metrics": metrics}


def _is_fraudulent(tx: Transaction) -> bool:
    return tx.decision == "BLOCK" or tx.status == "failed" or float(tx.risk_score or 0) >= 70


@router.get("/fraud-ring")
def get_fraud_ring(
    _admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
) -> dict:
    """Builds a user-to-receiver transaction graph. Flags receiver accounts
    shared across multiple senders (a classic money-mule / collusion signal)
    and marks every detected fraud — blocked or high-risk transactions — so
    fraudulent money flows and the accounts involved stand out in the graph.
    """
    transactions = db.scalars(
        select(Transaction).where(Transaction.receiver_account.is_not(None))
    ).all()

    if not transactions:
        return {
            "nodes": [],
            "edges": [],
            "suspiciousReceivers": 0,
            "fraudulentTransactions": 0,
            "flaggedSenders": 0,
        }

    user_ids = {tx.user_id for tx in transactions}
    users_by_id = {
        user.id: user for user in db.scalars(select(User).where(User.id.in_(user_ids))).all()
    }

    senders_by_receiver: dict[str, set[int]] = defaultdict(set)
    receiver_names: dict[str, str] = {}
    for tx in transactions:
        account = tx.receiver_account
        if not account:
            continue
        senders_by_receiver[account].add(tx.user_id)
        if tx.receiver_name:
            receiver_names[account] = tx.receiver_name

    nodes: dict[str, dict] = {}
    edges: list[dict] = []
    suspicious_receivers = 0
    fraudulent_transactions = 0

    for tx in transactions:
        account = tx.receiver_account
        if not account:
            continue
        user_node_id = f"user:{tx.user_id}"
        receiver_node_id = f"receiver:{account}"
        sender_count = len(senders_by_receiver[account])
        is_shared = sender_count >= 2
        is_fraud = _is_fraudulent(tx)
        if is_fraud:
            fraudulent_transactions += 1

        if user_node_id not in nodes:
            user = users_by_id.get(tx.user_id)
            nodes[user_node_id] = {
                "id": user_node_id,
                "type": "user",
                "label": user.email if user else f"user #{tx.user_id}",
                "maxRiskScore": 0.0,
                "flagged": False,
                "fraudulent": False,
                "fraudCount": 0,
            }
        if receiver_node_id not in nodes:
            if is_shared:
                suspicious_receivers += 1
            nodes[receiver_node_id] = {
                "id": receiver_node_id,
                "type": "receiver",
                "label": receiver_names.get(account, account),
                "account": account,
                "senderCount": sender_count,
                "maxRiskScore": 0.0,
                "flagged": is_shared,
                "fraudulent": False,
                "fraudCount": 0,
            }

        risk_score = float(tx.risk_score or 0)
        for node_id in (user_node_id, receiver_node_id):
            node = nodes[node_id]
            if risk_score > node["maxRiskScore"]:
                node["maxRiskScore"] = risk_score
            if is_fraud:
                node["fraudulent"] = True
                node["fraudCount"] += 1

        edges.append(
            {
                "source": user_node_id,
                "target": receiver_node_id,
                "transactionId": tx.id,
                "amount": tx.amount,
                "riskScore": risk_score,
                "riskLevel": tx.risk_level,
                "decision": tx.decision,
                "status": tx.status,
                "date": tx.date,
                "shared": is_shared,
                "fraud": is_fraud,
            }
        )

    flagged_senders = sum(
        1 for node in nodes.values() if node["type"] == "user" and node["fraudulent"]
    )

    return {
        "nodes": list(nodes.values()),
        "edges": edges,
        "suspiciousReceivers": suspicious_receivers,
        "fraudulentTransactions": fraudulent_transactions,
        "flaggedSenders": flagged_senders,
    }


@router.get("/stats")
def get_stats(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    transactions = db.scalars(_transaction_scope_query(current_user)).all()
    if not transactions:
        return {
            "totalSpent": 0,
            "spentChange": 0,
            "transactionCount": 0,
            "txChange": 0,
            "avgRiskScore": 0,
            "monthlySpend": 0,
            "monthlyChange": 0,
        }

    total_spent = sum(tx.amount for tx in transactions if tx.status != "failed")
    avg_risk = sum(tx.risk_score for tx in transactions) / len(transactions)
    current_month_key = datetime.now(timezone.utc).strftime("%Y-%m")
    monthly_spend = sum(
        tx.amount for tx in transactions if tx.status != "failed" and str(tx.date).startswith(current_month_key)
    )
    return {
        "totalSpent": round(total_spent, 2),
        "spentChange": 0,
        "transactionCount": len(transactions),
        "txChange": 0,
        "avgRiskScore": round(avg_risk, 2),
        "monthlySpend": round(monthly_spend, 2),
        "monthlyChange": 0,
    }


@router.get("/analytics/spending-trend")
def get_spending_trend(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[dict]:
    now = datetime.now(timezone.utc)
    months: list[str] = []
    for offset in range(5, -1, -1):
        month_dt = datetime(now.year, now.month, 1, tzinfo=timezone.utc)
        month_index = (month_dt.month - 1) - offset
        year = month_dt.year + (month_index // 12)
        month = (month_index % 12) + 1
        months.append(datetime(year, month, 1, tzinfo=timezone.utc).strftime("%Y-%m"))

    totals_by_month: dict[str, float] = defaultdict(float)
    categories_by_month: dict[str, Counter[str]] = defaultdict(Counter)
    for tx in db.scalars(_transaction_scope_query(current_user)).all():
        month_key = str(tx.date)[:7]
        totals_by_month[month_key] += float(tx.amount)
        categories_by_month[month_key][tx.category or "Transfers"] += 1

    trend: list[dict] = []
    for month_key in months:
        trend.append(
            {
                "month": datetime.strptime(month_key, "%Y-%m").strftime("%b"),
                "amount": round(totals_by_month.get(month_key, 0.0), 2),
            }
        )

    latest_month = months[-1]
    if trend:
        trend[-1]["categories"] = [
            {"name": name, "value": count}
            for name, count in categories_by_month.get(latest_month, Counter()).most_common()
        ]
    return trend


@router.get("/analytics/risk-distribution")
def get_risk_distribution(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[dict]:
    buckets = {"Low": 0, "Medium": 0, "High": 0}
    for tx in db.scalars(_transaction_scope_query(current_user)).all():
        score = float(tx.risk_score or 0)
        if score > 70:
            buckets["High"] += 1
        elif score > 40:
            buckets["Medium"] += 1
        else:
            buckets["Low"] += 1
    return [{"name": key, "value": value} for key, value in buckets.items()]
