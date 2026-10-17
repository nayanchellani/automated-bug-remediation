"""error_events table

Revision ID: 002_error_events
Revises: 001_initial_schema
Create Date: 2026-10-11 16:15:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '002_error_events'
down_revision: Union[str, None] = '001_initial_schema'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'error_events',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('project_id', sa.Integer(), nullable=False),
        sa.Column('fingerprint', sa.String(length=64), nullable=False),
        sa.Column('name', sa.String(length=200), nullable=False),
        sa.Column('message', sa.Text(), nullable=False),
        sa.Column('stack', sa.Text(), nullable=False),
        sa.Column('file', sa.String(length=500), nullable=True),
        sa.Column('line', sa.Integer(), nullable=True),
        sa.Column('function', sa.String(length=200), nullable=True),
        sa.Column('route', sa.String(length=500), nullable=True),
        sa.Column('method', sa.String(length=10), nullable=True),
        sa.Column('environment', sa.String(length=50), nullable=True),
        sa.Column('release', sa.String(length=100), nullable=True),
        sa.Column('count', sa.Integer(), nullable=False, server_default='1'),
        sa.Column('first_seen', sa.DateTime(timezone=True), nullable=False),
        sa.Column('last_seen', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('project_id', 'fingerprint', name='uq_error_project_fingerprint')
    )
    op.create_index('ix_error_events_id', 'error_events', ['id'], unique=False)
    op.create_index('ix_error_events_project_id', 'error_events', ['project_id'], unique=False)
    op.create_index('ix_error_project_last_seen', 'error_events', ['project_id', 'last_seen'], unique=False)


def downgrade() -> None:
    op.drop_index('ix_error_project_last_seen', table_name='error_events')
    op.drop_index('ix_error_events_project_id', table_name='error_events')
    op.drop_index('ix_error_events_id', table_name='error_events')
    op.drop_table('error_events')
