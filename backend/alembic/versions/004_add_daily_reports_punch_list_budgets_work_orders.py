"""Add daily reports, punch list, budgets, and work orders tables.

Revision ID: 004
Revises: 003
Create Date: 2026-04-07 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = '004'
down_revision = '003'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ─── Daily Reports ────────────────────────────────────────
    op.create_table(
        'daily_reports',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('company_id', sa.Integer(), sa.ForeignKey('companies.id'), nullable=False, index=True),
        sa.Column('created_by_id', sa.Integer(), sa.ForeignKey('users.id'), nullable=False, index=True),
        sa.Column('report_date', sa.DateTime(timezone=True), nullable=False, index=True),
        sa.Column('community', sa.String(255), nullable=False, index=True),
        sa.Column('lot_number', sa.String(255), nullable=True),
        sa.Column('work_performed', sa.Text(), nullable=True),
        sa.Column('phase', sa.String(100), nullable=True),
        sa.Column('units_completed', sa.Integer(), nullable=True),
        sa.Column('percent_complete', sa.Float(), nullable=True),
        sa.Column('crew_size', sa.Integer(), nullable=True),
        sa.Column('crew_hours', sa.Float(), nullable=True),
        sa.Column('weather', sa.String(20), nullable=True),
        sa.Column('temperature_high', sa.Integer(), nullable=True),
        sa.Column('work_delayed', sa.Boolean(), default=False, nullable=False),
        sa.Column('delay_reason', sa.Text(), nullable=True),
        sa.Column('issues_noted', sa.Text(), nullable=True),
        sa.Column('safety_incidents', sa.Boolean(), default=False, nullable=False),
        sa.Column('safety_notes', sa.Text(), nullable=True),
        sa.Column('materials_needed', sa.Text(), nullable=True),
        sa.Column('materials_delivered', sa.Text(), nullable=True),
        sa.Column('inspections_passed', sa.Integer(), nullable=True),
        sa.Column('inspections_failed', sa.Integer(), nullable=True),
        sa.Column('rework_needed', sa.Text(), nullable=True),
        sa.Column('status', sa.String(20), default='draft', nullable=False),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    # ─── Punch Items ──────────────────────────────────────────
    op.create_table(
        'punch_items',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('company_id', sa.Integer(), sa.ForeignKey('companies.id'), nullable=False, index=True),
        sa.Column('created_by_id', sa.Integer(), sa.ForeignKey('users.id'), nullable=False, index=True),
        sa.Column('assigned_to_id', sa.Integer(), sa.ForeignKey('users.id'), nullable=True, index=True),
        sa.Column('community', sa.String(255), nullable=False, index=True),
        sa.Column('lot_number', sa.String(255), nullable=False, index=True),
        sa.Column('location', sa.String(255), nullable=True),
        sa.Column('title', sa.String(500), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('category', sa.String(30), default='other', nullable=False),
        sa.Column('priority', sa.String(20), default='medium', nullable=False),
        sa.Column('status', sa.String(20), default='open', nullable=False, index=True),
        sa.Column('reported_by', sa.String(255), nullable=True),
        sa.Column('builder_name', sa.String(255), nullable=True),
        sa.Column('resolution_notes', sa.Text(), nullable=True),
        sa.Column('completed_by_id', sa.Integer(), sa.ForeignKey('users.id'), nullable=True),
        sa.Column('completed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('verified_by_id', sa.Integer(), sa.ForeignKey('users.id'), nullable=True),
        sa.Column('verified_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('due_date', sa.DateTime(timezone=True), nullable=True),
        sa.Column('scheduled_date', sa.DateTime(timezone=True), nullable=True),
        sa.Column('photo_url', sa.String(1024), nullable=True),
        sa.Column('completion_photo_url', sa.String(1024), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False, index=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    # ─── Community Budgets ────────────────────────────────────
    op.create_table(
        'community_budgets',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('company_id', sa.Integer(), sa.ForeignKey('companies.id'), nullable=False, index=True),
        sa.Column('created_by_id', sa.Integer(), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('community', sa.String(255), nullable=False, index=True),
        sa.Column('budget_amount', sa.Float(), nullable=False),
        sa.Column('period_start', sa.DateTime(timezone=True), nullable=False),
        sa.Column('period_end', sa.DateTime(timezone=True), nullable=False),
        sa.Column('labor_budget', sa.Float(), nullable=True),
        sa.Column('materials_budget', sa.Float(), nullable=True),
        sa.Column('equipment_budget', sa.Float(), nullable=True),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('is_active', sa.Boolean(), default=True, nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    # ─── Work Orders ─────────────────────────────────────────
    op.create_table(
        'work_orders',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('company_id', sa.Integer(), sa.ForeignKey('companies.id'), nullable=False, index=True),
        sa.Column('created_by_id', sa.Integer(), sa.ForeignKey('users.id'), nullable=False, index=True),
        sa.Column('assigned_to_id', sa.Integer(), sa.ForeignKey('users.id'), nullable=True, index=True),
        sa.Column('title', sa.String(500), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('community', sa.String(255), nullable=False, index=True),
        sa.Column('lot_number', sa.String(255), nullable=True),
        sa.Column('work_type', sa.String(30), default='other', nullable=False),
        sa.Column('priority', sa.String(20), default='normal', nullable=False),
        sa.Column('status', sa.String(20), default='open', nullable=False, index=True),
        sa.Column('scheduled_date', sa.DateTime(timezone=True), nullable=True),
        sa.Column('due_date', sa.DateTime(timezone=True), nullable=True),
        sa.Column('started_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('completed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('estimated_hours', sa.Float(), nullable=True),
        sa.Column('actual_hours', sa.Float(), nullable=True),
        sa.Column('crew_size_needed', sa.Integer(), nullable=True),
        sa.Column('estimated_cost', sa.Float(), nullable=True),
        sa.Column('actual_cost', sa.Float(), nullable=True),
        sa.Column('builder_name', sa.String(255), nullable=True),
        sa.Column('builder_contact', sa.String(255), nullable=True),
        sa.Column('epo_id', sa.Integer(), sa.ForeignKey('epos.id'), nullable=True, index=True),
        sa.Column('completion_notes', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False, index=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table('work_orders')
    op.drop_table('community_budgets')
    op.drop_table('punch_items')
    op.drop_table('daily_reports')
