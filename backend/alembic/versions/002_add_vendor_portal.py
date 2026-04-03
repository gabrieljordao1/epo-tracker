"""Add vendor portal — vendor_token on EPOs and vendor_actions table

Revision ID: 002
Revises: 001
Create Date: 2026-04-03

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = "002"
down_revision: Union[str, None] = "001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add vendor_token to epos
    op.add_column("epos", sa.Column("vendor_token", sa.String(64), unique=True, nullable=True, index=True))

    # Create vendor_actions table
    op.create_table(
        "vendor_actions",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("epo_id", sa.Integer(), sa.ForeignKey("epos.id"), nullable=False),
        sa.Column("company_id", sa.Integer(), sa.ForeignKey("companies.id"), nullable=False, index=True),
        sa.Column("action_type", sa.String(50), nullable=False),
        sa.Column("vendor_note", sa.Text(), nullable=True),
        sa.Column("confirmation_number", sa.String(255), nullable=True),
        sa.Column("ip_address", sa.String(45), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("vendor_actions")
    op.drop_column("epos", "vendor_token")
