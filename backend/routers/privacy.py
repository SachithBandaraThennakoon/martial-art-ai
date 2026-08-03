from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from auth_context import get_current_user
from database import get_db
from models.billing import BillingEvent, BillingSubscription
from models.body_calibration import BodyCalibration
from models.contact_message import ContactMessage
from models.password_reset_token import PasswordResetToken
from models.privacy import ConsentRecord
from models.refresh_session import RefreshSession
from models.training_memory import (
    PracticeRep,
    PracticeSession,
    PracticeSessionAnalytics,
    PracticeSessionTape,
    TemporalLabelingDraft,
    TrainingFeedbackEvent,
    TrainingSession,
    TrainingStepAttempt,
    UserTrainingMemory,
)
from models.user import User
from routers.auth import _clear_refresh_cookie, _require_trusted_browser_origin
from services.paypal_client import PayPalAPIError, cancel_subscription
from services.privacy import (
    EXPORT_SCHEMA_VERSION,
    generated_at,
    legal_documents_payload,
    model_payload,
    parsed_json,
)
from services.rate_limits import ACCOUNT_PRIVACY_USER, enforce_rate_limits
from services.tape_storage import delete_tape_blob
from utils.security import verify_password


router = APIRouter(tags=["privacy"])


class DeleteAccountRequest(BaseModel):
    password: str
    confirmation: str


@router.get("/legal/documents")
def legal_documents():
    return legal_documents_payload()


@router.get("/account/consents")
def account_consents(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    records = db.query(ConsentRecord).filter(ConsentRecord.user_id == user.id).all()
    return {"documents": legal_documents_payload(), "consents": [model_payload(row) for row in records]}


@router.get("/account/export")
def export_account(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    enforce_rate_limits(db, (ACCOUNT_PRIVACY_USER, str(user.id)))
    training_sessions = db.query(TrainingSession).filter(TrainingSession.user_id == user.id).all()
    training_ids = [row.id for row in training_sessions]
    practice_sessions = db.query(PracticeSession).filter(PracticeSession.user_id == user.id).all()
    practice_ids = [row.id for row in practice_sessions]
    subscriptions = db.query(BillingSubscription).filter(BillingSubscription.user_id == user.id).all()
    provider_ids = [row.provider_subscription_id for row in subscriptions]
    calibrations = db.query(BodyCalibration).filter(BodyCalibration.user_id == user.id).all()
    analytics = db.query(PracticeSessionAnalytics).filter(PracticeSessionAnalytics.practice_session_id.in_(practice_ids)).all() if practice_ids else []

    return {
        "export_schema_version": EXPORT_SCHEMA_VERSION,
        "generated_at": generated_at(),
        "profile": model_payload(user, exclude={"password_hash"}),
        "consents": [model_payload(row) for row in db.query(ConsentRecord).filter(ConsentRecord.user_id == user.id).all()],
        "sessions": [model_payload(row, exclude={"token_hash", "replaced_by_hash", "user_agent_hash"}) for row in db.query(RefreshSession).filter(RefreshSession.user_id == user.id).all()],
        "password_resets": [model_payload(row, exclude={"token_hash"}) for row in db.query(PasswordResetToken).filter(PasswordResetToken.user_id == user.id).all()],
        "body_calibrations": [{**model_payload(row, exclude={"ratios_json"}), "ratios": parsed_json(row.ratios_json)} for row in calibrations],
        "training": {
            "sessions": [model_payload(row) for row in training_sessions],
            "attempts": [model_payload(row) for row in db.query(TrainingStepAttempt).filter(TrainingStepAttempt.session_id.in_(training_ids)).all()] if training_ids else [],
            "feedback": [model_payload(row) for row in db.query(TrainingFeedbackEvent).filter(TrainingFeedbackEvent.session_id.in_(training_ids)).all()] if training_ids else [],
            "memory": [model_payload(row) for row in db.query(UserTrainingMemory).filter(UserTrainingMemory.user_id == user.id).all()],
        },
        "practice": {
            "sessions": [model_payload(row) for row in practice_sessions],
            "repetitions": [model_payload(row) for row in db.query(PracticeRep).filter(PracticeRep.practice_session_id.in_(practice_ids)).all()] if practice_ids else [],
            "analytics": [{**model_payload(row, exclude={"payload"}), "data": parsed_json(row.payload)} for row in analytics],
            "tapes": [{**model_payload(row, exclude={"payload", "blob_name"}), "download_path": f"/practice/sessions/{row.practice_session_id}/tape"} for row in db.query(PracticeSessionTape).filter(PracticeSessionTape.practice_session_id.in_(practice_ids)).all()] if practice_ids else [],
        },
        "billing": {
            "subscriptions": [model_payload(row) for row in subscriptions],
            "events": [model_payload(row, exclude={"payload_hash"}) for row in db.query(BillingEvent).filter(BillingEvent.provider_subscription_id.in_(provider_ids)).all()] if provider_ids else [],
        },
        "contact_messages": [model_payload(row) for row in db.query(ContactMessage).filter(func.lower(ContactMessage.email) == user.email.lower()).all()],
        "admin_labeling_drafts": [model_payload(row, exclude={"payload"}) for row in db.query(TemporalLabelingDraft).filter(TemporalLabelingDraft.admin_user_id == user.id).all()],
    }


@router.delete("/account")
async def delete_account(
    payload: DeleteAccountRequest,
    request: Request,
    response: Response,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_trusted_browser_origin(request)
    enforce_rate_limits(db, (ACCOUNT_PRIVACY_USER, str(user.id)))
    if payload.confirmation != "DELETE":
        raise HTTPException(status_code=400, detail="Type DELETE to confirm account deletion")
    if not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Your password is incorrect")
    if user.role == "admin":
        raise HTTPException(status_code=403, detail="Administrator accounts require an operational deletion process")

    subscriptions = db.query(BillingSubscription).filter(BillingSubscription.user_id == user.id).all()
    for subscription in subscriptions:
        if (subscription.status or "").upper() in {"ACTIVE", "SUSPENDED", "APPROVAL_PENDING"}:
            try:
                await cancel_subscription(subscription.provider_subscription_id, reason="Customer deleted account")
            except PayPalAPIError as exc:
                raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc

    training_ids = [row[0] for row in db.query(TrainingSession.id).filter(TrainingSession.user_id == user.id).all()]
    practice_ids = [row[0] for row in db.query(PracticeSession.id).filter(PracticeSession.user_id == user.id).all()]
    provider_ids = [row.provider_subscription_id for row in subscriptions]
    tapes = db.query(PracticeSessionTape).filter(PracticeSessionTape.practice_session_id.in_(practice_ids)).all() if practice_ids else []
    try:
        for tape in tapes:
            if tape.storage_provider == "azure" and tape.blob_name:
                delete_tape_blob(tape.blob_name)
    except Exception as exc:
        raise HTTPException(status_code=503, detail="Stored training data could not be deleted; no account changes were committed") from exc

    try:
        if practice_ids:
            db.query(PracticeSessionTape).filter(PracticeSessionTape.practice_session_id.in_(practice_ids)).delete(synchronize_session=False)
            db.query(PracticeSessionAnalytics).filter(PracticeSessionAnalytics.practice_session_id.in_(practice_ids)).delete(synchronize_session=False)
            db.query(PracticeRep).filter(PracticeRep.practice_session_id.in_(practice_ids)).delete(synchronize_session=False)
        db.query(PracticeSession).filter(PracticeSession.user_id == user.id).delete(synchronize_session=False)
        if training_ids:
            db.query(TrainingFeedbackEvent).filter(TrainingFeedbackEvent.session_id.in_(training_ids)).delete(synchronize_session=False)
            db.query(TrainingStepAttempt).filter(TrainingStepAttempt.session_id.in_(training_ids)).delete(synchronize_session=False)
        db.query(TrainingSession).filter(TrainingSession.user_id == user.id).delete(synchronize_session=False)
        for model, user_column in (
            (UserTrainingMemory, UserTrainingMemory.user_id),
            (BodyCalibration, BodyCalibration.user_id),
            (TemporalLabelingDraft, TemporalLabelingDraft.admin_user_id),
            (PasswordResetToken, PasswordResetToken.user_id),
            (RefreshSession, RefreshSession.user_id),
            (ConsentRecord, ConsentRecord.user_id),
            (BillingSubscription, BillingSubscription.user_id),
        ):
            db.query(model).filter(user_column == user.id).delete(synchronize_session=False)
        if provider_ids:
            db.query(BillingEvent).filter(BillingEvent.provider_subscription_id.in_(provider_ids)).delete(synchronize_session=False)
        db.query(ContactMessage).filter(func.lower(ContactMessage.email) == user.email.lower()).delete(synchronize_session=False)
        db.query(User).filter(User.id == user.id).delete(synchronize_session=False)
        db.commit()
    except Exception:
        db.rollback()
        raise

    _clear_refresh_cookie(response)
    return {"deleted": True}
