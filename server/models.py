"""
models.py — SQLAlchemy ORM models.

Five tables mirror the five in-memory stores from server.py:
  agents            ← agents_store
  contacts          ← contacts_store
  workflows         ← workflows_store
  campaigns         ← Campaign singleton
  campaign_contacts ← Campaign.contacts list
  human_transfers   ← human_transfers list
"""

import enum
import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean, DateTime, Enum, ForeignKey,
    Integer, String, Text, func, Float,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from database import Base


# ── Agents ────────────────────────────────────────────────────────────────────

class Agent(Base):
    __tablename__ = "agents"

    # Natural primary key chosen by the user (e.g. "realty-outbound")
    workflow_name: Mapped[str] = mapped_column(String(120), primary_key=True)
    agent_name: Mapped[str] = mapped_column(String(120), nullable=False)
    agent_role: Mapped[str] = mapped_column(String(200), nullable=False, server_default="")
    instruction_prompt: Mapped[str] = mapped_column(Text, nullable=False, default="")
    tone: Mapped[list] = mapped_column(ARRAY(String(60)), nullable=False, server_default="{}")
    negative_instructions: Mapped[str] = mapped_column(Text, nullable=False, default="")
    greeting: Mapped[str] = mapped_column(Text, nullable=False, default="")
    sign_off: Mapped[str] = mapped_column(Text, nullable=False, default="")
    outcomes: Mapped[list] = mapped_column(ARRAY(String(80)), nullable=False, server_default="{}")

    # Persona / behavior detail (required free-text).
    persona: Mapped[str] = mapped_column(Text, nullable=False, server_default="")
    communication_style: Mapped[str] = mapped_column(Text, nullable=False, server_default="")
    conversation_flow: Mapped[str] = mapped_column(Text, nullable=False, server_default="")
    knowledge_context: Mapped[str] = mapped_column(Text, nullable=False, server_default="")
    handoff_rules: Mapped[str] = mapped_column(Text, nullable=False, server_default="")
    safety_rules: Mapped[str] = mapped_column(Text, nullable=False, server_default="")

    # Optional structured config (nullable JSONB).
    # [{"name": "Email", "example": "xxx@xxx.xxx"}, ...]
    data_fields: Mapped[list] = mapped_column(JSONB, nullable=False, server_default="[]")
    # [{"name": "Busy professional", "description": "..."}, ...]
    caller_personas: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    # [{"objection": "Too expensive", "response": "..."}, ...]
    objection_rules: Mapped[list | None] = mapped_column(JSONB, nullable=True)


# ── Contacts ──────────────────────────────────────────────────────────────────

class Contact(Base):
    __tablename__ = "contacts"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(200), nullable=False, default="(unknown)")
    # E.164 format, unique across the master list
    phone: Mapped[str] = mapped_column(String(20), nullable=False, unique=True, index=True)
    tags: Mapped[list] = mapped_column(ARRAY(String(100)), nullable=False, server_default="{}")


# ── Workflows ─────────────────────────────────────────────────────────────────

class Workflow(Base):
    __tablename__ = "workflows"

    name: Mapped[str] = mapped_column(String(200), primary_key=True)
    # Full stage + routing definition stored as JSONB so it can evolve freely. Each stage:
    # {"agent": "...", "routing": {"INTERESTED": {"target": "...", "retry_after_days": null}},
    #  "focus": ["Budget", ...]}  — focus = catalog field names this stage leads on.
    stages: Mapped[list] = mapped_column(JSONB, nullable=False, server_default="[]")
    # Master catalog of fields collected across the whole workflow: [{"name","example"}, ...]
    data_fields: Mapped[list] = mapped_column(JSONB, nullable=False, server_default="[]")


# ── Campaigns ─────────────────────────────────────────────────────────────────

class CampaignStatus(str, enum.Enum):
    CREATED = "created"
    RUNNING = "running"
    PAUSED  = "paused"
    STOPPED = "stopped"
    DONE    = "done"


class Campaign(Base):
    __tablename__ = "campaigns"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    workflow_name: Mapped[str] = mapped_column(
        String(200), ForeignKey("workflows.name", ondelete="RESTRICT"), nullable=False
    )
    status: Mapped[CampaignStatus] = mapped_column(
        Enum(CampaignStatus, name="campaign_status"),
        nullable=False, default=CampaignStatus.CREATED,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    contacts: Mapped[list["CampaignContact"]] = relationship(
        "CampaignContact",
        back_populates="campaign",
        order_by="CampaignContact.sno",
        cascade="all, delete-orphan",
    )


# ── Campaign contacts (per-call execution state) ──────────────────────────────

class ContactStatus(str, enum.Enum):
    NOT_INITIATED = "Not Initiated"
    CALLING       = "Calling"
    ANSWERED      = "Answered"
    FINISHED      = "Finished"
    NO_ANSWER     = "No Answer"
    FAILED        = "Failed"


class CampaignContact(Base):
    __tablename__ = "campaign_contacts"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    campaign_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("campaigns.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    # Keep master contact id for reference; SET NULL if the contact is deleted
    contact_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("contacts.id", ondelete="SET NULL"), nullable=True,
    )
    # Snapshot so records survive contact deletion
    name:  Mapped[str] = mapped_column(String(200), nullable=False)
    phone: Mapped[str] = mapped_column(String(20),  nullable=False)
    sno:   Mapped[int] = mapped_column(Integer, nullable=False)   # 1-based display order

    status: Mapped[ContactStatus] = mapped_column(
        Enum(ContactStatus, name="contact_status"),
        nullable=False, default=ContactStatus.NOT_INITIATED,
    )
    current_agent: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    current_stage: Mapped[str] = mapped_column(String(200), nullable=False, default="")
    last_outcome:  Mapped[str] = mapped_column(String(80),  nullable=False, default="")
    final_outcome: Mapped[str] = mapped_column(String(80),  nullable=False, default="")
    attempts:      Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    done:          Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    summary:        Mapped[str]  = mapped_column(Text,  nullable=False, default="")
    transcript:     Mapped[list] = mapped_column(JSONB, nullable=False, server_default="[]")
    collected:      Mapped[dict] = mapped_column(JSONB, nullable=False, server_default="{}")
    stages_history: Mapped[list] = mapped_column(JSONB, nullable=False, server_default="[]")
    callback_note:  Mapped[str]  = mapped_column(Text,  nullable=False, default="")

    # Buying Intent Score — post-call analysis of the transcript + summary (0-100 + 3-line reason).
    buying_intent_score:  Mapped[int | None] = mapped_column(Integer, nullable=True)
    buying_intent_reason: Mapped[str] = mapped_column(Text, nullable=False, server_default="")

    recording_url: Mapped[str] = mapped_column(Text, nullable=False, server_default="")
    # The in-flight egress id, so we can stop it cleanly at call end.
    recording_egress_id: Mapped[str] = mapped_column(String(120), nullable=False, server_default="")

    campaign: Mapped["Campaign"] = relationship("Campaign", back_populates="contacts")


# ── Human transfers ───────────────────────────────────────────────────────────

class HumanTransfer(Base):
    __tablename__ = "human_transfers"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name:          Mapped[str]  = mapped_column(String(200), nullable=False)
    phone:         Mapped[str]  = mapped_column(String(20),  nullable=False)
    workflow_name: Mapped[str]  = mapped_column(String(200), nullable=False, default="")
    final_outcome: Mapped[str]  = mapped_column(String(80),  nullable=False, default="")
    collected:     Mapped[dict] = mapped_column(JSONB, nullable=False, server_default="{}")
    summary:       Mapped[str]  = mapped_column(Text,  nullable=False, default="")
    campaign_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("campaigns.id", ondelete="SET NULL"),
        nullable=True, index=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True,
    )

class TestSession(Base):
    __tablename__ = "test_sessions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    mode:  Mapped[str] = mapped_column(String(20),  nullable=False)              # "phone" | "browser"
    agent_workflow: Mapped[str] = mapped_column(String(120), nullable=False)     # which agent was tested
    agent_name:     Mapped[str] = mapped_column(String(120), nullable=False, server_default="")
    phone: Mapped[str] = mapped_column(String(20), nullable=False, server_default="")  # phone tests only

    status:  Mapped[str] = mapped_column(String(20), nullable=False, server_default="active")  # active|finished|failed
    summary: Mapped[str] = mapped_column(Text, nullable=False, server_default="")
    transcript: Mapped[list] = mapped_column(JSONB, nullable=False, server_default="[]")

    recording_url:       Mapped[str] = mapped_column(Text,        nullable=False, server_default="")
    recording_egress_id: Mapped[str] = mapped_column(String(120), nullable=False, server_default="")

    stt_audio_seconds:     Mapped[float] = mapped_column(Float,   nullable=False, server_default="0")
    llm_prompt_tokens:     Mapped[int]   = mapped_column(Integer, nullable=False, server_default="0")
    llm_completion_tokens: Mapped[int]   = mapped_column(Integer, nullable=False, server_default="0")
    tts_characters:        Mapped[int]   = mapped_column(Integer, nullable=False, server_default="0")
    turns:                 Mapped[int]   = mapped_column(Integer, nullable=False, server_default="0")
    duration_seconds:      Mapped[float] = mapped_column(Float,   nullable=False, server_default="0")
    ttft_samples:          Mapped[list]  = mapped_column(JSONB,   nullable=False, server_default="[]")

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True,
    )