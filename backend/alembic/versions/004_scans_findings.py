"""scans and findings tables

Revision ID: 004_scans_findings
Revises: 003_snapshots_dependencies
Create Date: 2026-11-14 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '004_scans_findings'
down_revision: Union[str, None] = '003_snapshots_dependencies'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'scans',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('project_id', sa.Integer(), nullable=False),
        sa.Column('snapshot_id', sa.String(length=36), nullable=False),
        sa.Column('status', sa.String(length=20), nullable=False),
        sa.Column('started_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('finished_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('files_analyzed', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('finding_count', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('error', sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['snapshot_id'], ['snapshots.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_scans_project_id'), 'scans', ['project_id'], unique=False)
    op.create_index(op.f('ix_scans_snapshot_id'), 'scans', ['snapshot_id'], unique=False)

    op.create_table(
        'findings',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('scan_id', sa.String(length=36), nullable=False),
        sa.Column('type', sa.String(length=20), nullable=False),
        sa.Column('severity', sa.String(length=20), nullable=False),
        sa.Column('rule', sa.String(length=100), nullable=False),
        sa.Column('file', sa.String(length=500), nullable=False),
        sa.Column('line', sa.Integer(), nullable=False),
        sa.Column('column', sa.Integer(), nullable=False),
        sa.Column('message', sa.Text(), nullable=False),
        sa.Column('snippet', sa.Text(), nullable=False, server_default=''),
        sa.Column('source_tool', sa.String(length=50), nullable=False, server_default='triage-analyzer'),
        sa.ForeignKeyConstraint(['scan_id'], ['scans.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_findings_scan_id'), 'findings', ['scan_id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_findings_scan_id'), table_name='findings')
    op.drop_table('findings')

    op.drop_index(op.f('ix_scans_snapshot_id'), table_name='scans')
    op.drop_index(op.f('ix_scans_project_id'), table_name='scans')
    op.drop_table('scans')
