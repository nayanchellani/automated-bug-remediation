"""vuln_audits and vulnerabilities tables

Revision ID: 005_vuln_audits
Revises: 004_scans_findings
Create Date: 2026-11-20 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '005_vuln_audits'
down_revision: Union[str, None] = '003_snapshots_dependencies'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'vuln_audits',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('project_id', sa.Integer(), sa.ForeignKey('projects.id', ondelete='CASCADE'), nullable=False),
        sa.Column('snapshot_id', sa.String(36), sa.ForeignKey('snapshots.id', ondelete='CASCADE'), nullable=False),
        sa.Column('status', sa.String(20), nullable=False),
        sa.Column('started_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('finished_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('vuln_count', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('error', sa.Text(), nullable=True),
    )
    op.create_index('ix_vuln_audits_project_id', 'vuln_audits', ['project_id'])
    op.create_index('ix_vuln_audits_snapshot_id', 'vuln_audits', ['snapshot_id'])

    op.create_table(
        'vulnerabilities',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('audit_id', sa.String(36), sa.ForeignKey('vuln_audits.id', ondelete='CASCADE'), nullable=False),
        sa.Column('osv_id', sa.String(100), nullable=False),
        sa.Column('package_name', sa.String(200), nullable=False),
        sa.Column('ecosystem', sa.String(20), nullable=False),
        sa.Column('installed_version', sa.String(100), nullable=True),
        sa.Column('fixed_version', sa.String(100), nullable=True),
        sa.Column('severity', sa.String(20), nullable=False),
        sa.Column('summary', sa.Text(), nullable=False),
        sa.Column('details', sa.Text(), nullable=True),
    )
    op.create_index('ix_vulnerabilities_audit_id', 'vulnerabilities', ['audit_id'])


def downgrade() -> None:
    op.drop_table('vulnerabilities')
    op.drop_table('vuln_audits')
