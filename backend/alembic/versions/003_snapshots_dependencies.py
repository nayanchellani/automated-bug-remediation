"""snapshots and dependencies tables

Revision ID: 003_snapshots_dependencies
Revises: 002_error_events
Create Date: 2026-10-17 20:45:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = '003_snapshots_dependencies'
down_revision: Union[str, None] = '002_error_events'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'snapshots',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('project_id', sa.Integer(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('sha256', sa.String(length=64), nullable=False),
        sa.Column('file_count', sa.Integer(), nullable=False),
        sa.Column('total_bytes', sa.Integer(), nullable=False),
        sa.Column('tree', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column('archive_path', sa.String(length=500), nullable=False),
        sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_snapshots_project_id'), 'snapshots', ['project_id'], unique=False)

    op.create_table(
        'dependencies',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('snapshot_id', sa.String(length=36), nullable=False),
        sa.Column('ecosystem', sa.String(length=20), nullable=False),
        sa.Column('name', sa.String(length=200), nullable=False),
        sa.Column('version', sa.String(length=100), nullable=True),
        sa.Column('is_dev', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('source_file', sa.String(length=300), nullable=False),
        sa.ForeignKeyConstraint(['snapshot_id'], ['snapshots.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_dependencies_snapshot_id'), 'dependencies', ['snapshot_id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_dependencies_snapshot_id'), table_name='dependencies')
    op.drop_table('dependencies')

    op.drop_index(op.f('ix_snapshots_project_id'), table_name='snapshots')
    op.drop_table('snapshots')
