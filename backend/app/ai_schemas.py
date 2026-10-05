"""Pydantic models used as OpenAI Structured Outputs (strict): no defaults, no dicts."""

from typing import Literal

from pydantic import BaseModel

SignalType = Literal[
    "hiring",
    "funding",
    "expansion",
    "leadership_change",
    "tech_adoption",
    "pain_post",
    "rfp_tender",
    "competitor_mention",
    "event_participation",
]
Channel = Literal["web", "news", "x", "linkedin", "reddit", "facebook", "jobs"]
CHANNELS: list[str] = ["web", "news", "x", "linkedin", "reddit", "facebook", "jobs"]


class Product(BaseModel):
    name: str
    description: str
    category: str
    key_features: list[str]


class Citation(BaseModel):
    source_id: str
    claim: str
    quote: str


class CompanyProfile(BaseModel):
    name: str
    one_liner: str
    description: str
    industry: str
    sub_industries: list[str]
    products: list[Product]
    value_propositions: list[str]
    differentiators: list[str]
    target_markets: list[str]
    geographies: list[str]
    customer_examples: list[str]
    competitors: list[str]
    pricing_model: str | None
    company_size_hint: str | None
    source_citations: list[Citation]


class SourceSummary(BaseModel):
    summary: str
    key_facts: list[str]


class Firmographics(BaseModel):
    industries: list[str]
    employee_range: str
    revenue_range: str
    geographies: list[str]
    tech_stack: list[str]


class Persona(BaseModel):
    title: str
    seniority: str
    department: str
    goals: list[str]
    pains: list[str]


class ICP(BaseModel):
    summary: str
    firmographics: Firmographics
    personas: list[Persona]
    pain_points: list[str]
    buying_triggers: list[str]
    keywords: list[str]
    negative_keywords: list[str]
    exclusions: list[str]
    disqualifiers: list[str]


class SignalDef(BaseModel):
    name: str
    type: SignalType
    channels: list[Channel]
    description: str
    queries: list[str]
    weight: float
    lookback_days: int


class SignalSet(BaseModel):
    signals: list[SignalDef]


class HitQualification(BaseModel):
    hit_index: int
    evidence_quote: str
    shows_signal: bool
    seller_can_help: bool
    relevant: bool
    reason: str
    prospect_org: str | None
    prospect_domain: str | None
    contact_name: str | None
    contact_title: str | None
    prospect_industry: str | None
    prospect_location: str | None
    confidence: float
    icp_fit: Literal["strong", "medium", "weak", "none"]


class HitQualificationBatch(BaseModel):
    results: list[HitQualification]


class Draft(BaseModel):
    subject: str | None
    body: str
