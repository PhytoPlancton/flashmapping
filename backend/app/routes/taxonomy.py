"""Taxonomy utility routes."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends

from ..auth import get_current_user
from ..models import TaxonomyRequest, TaxonomyResponse
from ..taxonomy import classify

router = APIRouter(prefix="/api/taxonomy", tags=["taxonomy"])


@router.post("/classify", response_model=TaxonomyResponse)
async def classify_title(
    payload: TaxonomyRequest,
    user: dict[str, Any] = Depends(get_current_user),
) -> TaxonomyResponse:
    return TaxonomyResponse.model_validate(classify(payload.title))
