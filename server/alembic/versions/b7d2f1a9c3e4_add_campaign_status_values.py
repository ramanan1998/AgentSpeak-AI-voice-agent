"""add campaign_status paused/stopped values

Revision ID: b7d2f1a9c3e4
Revises: ce2e64605874
Create Date: 2026-06-13 12:00:00.000000
"""
from alembic import op


revision = "b7d2f1a9c3e4"
down_revision = "ce2e64605874"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # SQLAlchemy stores this enum by MEMBER NAME, so the labels are uppercase (PAUSED/STOPPED),
    # matching CREATED/RUNNING/DONE — not the lowercase values.
    op.execute("ALTER TYPE campaign_status ADD VALUE IF NOT EXISTS 'PAUSED'")
    op.execute("ALTER TYPE campaign_status ADD VALUE IF NOT EXISTS 'STOPPED'")


def downgrade() -> None:
    # PostgreSQL cannot drop enum values; downgrade is a no-op.
    pass
