"""Add epo_lot_items table for per-lot breakdown of multi-lot EPOs.

Revision ID: 006
Revises: 005
Create Date: 2026-04-19 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '006'
down_revision = '005'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'epo_lot_items',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('epo_id', sa.Integer(), sa.ForeignKey('epos.id'), nullable=False, index=True),
        sa.Column('company_id', sa.Integer(), sa.ForeignKey('companies.id'), nullable=False, index=True),
        sa.Column('lot_number', sa.String(50), nullable=False),
        sa.Column('amount', sa.Float(), nullable=True),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table('epo_lot_items')
