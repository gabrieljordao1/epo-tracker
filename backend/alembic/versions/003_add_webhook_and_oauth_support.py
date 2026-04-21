"""Add webhook and OAuth token support.

Revision ID: 003
Revises: 002
Create Date: 2024-04-04 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

# revision identifiers, used by Alembic.
revision = '003'
down_revision = '002'
branch_labels = None
depends_on = None


def _column_exists(table_name: str, column_name: str) -> bool:
    """Check if a column already exists (idempotent migration helper)."""
    bind = op.get_bind()
    insp = inspect(bind)
    columns = [c["name"] for c in insp.get_columns(table_name)]
    return column_name in columns


def _table_exists(table_name: str) -> bool:
    """Check if a table already exists."""
    bind = op.get_bind()
    insp = inspect(bind)
    return table_name in insp.get_table_names()


def upgrade() -> None:
    # Add OAuth token fields to email_connections
    if not _column_exists('email_connections', 'access_token'):
        op.add_column('email_connections', sa.Column('access_token', sa.String(1024), nullable=True))
    if not _column_exists('email_connections', 'refresh_token'):
        op.add_column('email_connections', sa.Column('refresh_token', sa.String(1024), nullable=True))
    if not _column_exists('email_connections', 'token_expires_at'):
        op.add_column('email_connections', sa.Column('token_expires_at', sa.DateTime(timezone=True), nullable=True))

    # Add Gmail watch tracking
    if not _column_exists('email_connections', 'gmail_history_id'):
        op.add_column('email_connections', sa.Column('gmail_history_id', sa.String(255), nullable=True))
    if not _column_exists('email_connections', 'watch_expiration'):
        op.add_column('email_connections', sa.Column('watch_expiration', sa.DateTime(timezone=True), nullable=True))

    # Create webhook_logs table
    if not _table_exists('webhook_logs'):
        op.create_table(
            'webhook_logs',
            sa.Column('id', sa.Integer(), nullable=False),
            sa.Column('company_id', sa.Integer(), nullable=False),
            sa.Column('source', sa.String(50), nullable=False),
            sa.Column('payload_hash', sa.String(64), nullable=False),
            sa.Column('status', sa.String(50), nullable=False),
            sa.Column('error_message', sa.Text(), nullable=True),
            sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.ForeignKeyConstraint(['company_id'], ['companies.id'], ),
            sa.PrimaryKeyConstraint('id'),
            sa.Index('ix_webhook_logs_created_at', 'created_at'),
        )


def downgrade() -> None:
    # Drop webhook_logs table
    op.drop_table('webhook_logs')

    # Remove OAuth token fields
    op.drop_column('email_connections', 'watch_expiration')
    op.drop_column('email_connections', 'gmail_history_id')
    op.drop_column('email_connections', 'token_expires_at')
    op.drop_column('email_connections', 'refresh_token')
    op.drop_column('email_connections', 'access_token')
