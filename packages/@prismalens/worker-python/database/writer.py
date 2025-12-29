"""Database writer for persisting analysis results."""

import os
import json
import sqlite3
from datetime import datetime
from typing import Optional
from dataclasses import dataclass
import logging

logger = logging.getLogger(__name__)


@dataclass
class Recommendation:
    """Recommendation data structure."""

    title: str
    description: Optional[str] = None
    priority: str = "medium"
    category: Optional[str] = None


@dataclass
class AnalysisResult:
    """Analysis result data structure."""

    analysis_run_id: str
    status: str  # "completed" or "failed"
    summary: Optional[str] = None
    root_cause: Optional[str] = None
    recommendations: Optional[list[Recommendation]] = None
    error: Optional[str] = None


class DatabaseWriter:
    """Writes analysis results to the SQLite database."""

    def __init__(self, database_url: Optional[str] = None):
        """Initialize the database writer.

        Args:
            database_url: SQLite database URL (file:./path/to/db.db format)
                         If not provided, uses DATABASE_URL env var or defaults to
                         the API's database location.
        """
        self.database_url = database_url or os.getenv(
            "DATABASE_URL",
            "file:../../../api/prisma/dev.db",
        )

        # Convert file: URL to path
        if self.database_url.startswith("file:"):
            self.db_path = self.database_url[5:]
            # Handle relative paths - resolve from worker-python directory
            if not os.path.isabs(self.db_path):
                worker_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
                self.db_path = os.path.normpath(os.path.join(worker_dir, self.db_path))
        else:
            self.db_path = self.database_url

        logger.info(f"Database writer initialized with path: {self.db_path}")

    def _get_connection(self) -> sqlite3.Connection:
        """Get a database connection."""
        if not os.path.exists(self.db_path):
            raise FileNotFoundError(f"Database file not found: {self.db_path}")

        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def update_analysis_status(
        self,
        analysis_run_id: str,
        status: str,
        started_at: Optional[datetime] = None,
    ) -> bool:
        """Update analysis run status.

        Args:
            analysis_run_id: The analysis run ID
            status: New status (pending, running, completed, failed)
            started_at: When the analysis started

        Returns:
            True if update successful, False otherwise
        """
        try:
            conn = self._get_connection()
            cursor = conn.cursor()

            update_fields = ["status = ?", "updatedAt = ?"]
            values = [status, datetime.utcnow().isoformat()]

            if started_at:
                update_fields.append("startedAt = ?")
                values.append(started_at.isoformat())

            if status in ("completed", "failed"):
                update_fields.append("completedAt = ?")
                values.append(datetime.utcnow().isoformat())

            values.append(analysis_run_id)

            query = f"""
                UPDATE analysis_runs
                SET {', '.join(update_fields)}
                WHERE id = ?
            """

            cursor.execute(query, values)
            conn.commit()

            updated = cursor.rowcount > 0
            conn.close()

            if updated:
                logger.info(f"Updated analysis run {analysis_run_id} to status: {status}")
            else:
                logger.warning(f"Analysis run {analysis_run_id} not found")

            return updated

        except Exception as e:
            logger.error(f"Failed to update analysis status: {e}")
            return False

    def write_result(self, result: AnalysisResult) -> bool:
        """Write analysis result to database.

        Args:
            result: The analysis result to write

        Returns:
            True if write successful, False otherwise
        """
        try:
            conn = self._get_connection()
            cursor = conn.cursor()

            # Update the analysis run
            raw_output = None
            if result.error:
                raw_output = json.dumps({"error": result.error})

            cursor.execute(
                """
                UPDATE analysis_runs
                SET status = ?,
                    summary = ?,
                    rootCause = ?,
                    rawOutput = ?,
                    completedAt = ?,
                    updatedAt = ?
                WHERE id = ?
                """,
                (
                    result.status,
                    result.summary,
                    result.root_cause,
                    raw_output,
                    datetime.utcnow().isoformat(),
                    datetime.utcnow().isoformat(),
                    result.analysis_run_id,
                ),
            )

            if cursor.rowcount == 0:
                logger.warning(f"Analysis run {result.analysis_run_id} not found")
                conn.close()
                return False

            # Insert recommendations if provided
            if result.recommendations:
                import uuid

                for rec in result.recommendations:
                    cursor.execute(
                        """
                        INSERT INTO recommendations (
                            id, analysisRunId, title, description,
                            priority, category, status, createdAt, updatedAt
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        (
                            str(uuid.uuid4()),
                            result.analysis_run_id,
                            rec.title,
                            rec.description,
                            rec.priority,
                            rec.category,
                            "pending",
                            datetime.utcnow().isoformat(),
                            datetime.utcnow().isoformat(),
                        ),
                    )

            conn.commit()
            conn.close()

            logger.info(
                f"Wrote result for analysis run {result.analysis_run_id}: "
                f"{result.status}, {len(result.recommendations or [])} recommendations"
            )
            return True

        except Exception as e:
            logger.error(f"Failed to write analysis result: {e}")
            return False

    def update_alert_status(self, alert_id: str, status: str) -> bool:
        """Update alert status.

        Args:
            alert_id: The alert ID
            status: New status (new, acknowledged, analyzing, resolved)

        Returns:
            True if update successful, False otherwise
        """
        try:
            conn = self._get_connection()
            cursor = conn.cursor()

            cursor.execute(
                """
                UPDATE alerts
                SET status = ?, updatedAt = ?
                WHERE id = ?
                """,
                (status, datetime.utcnow().isoformat(), alert_id),
            )

            conn.commit()
            updated = cursor.rowcount > 0
            conn.close()

            if updated:
                logger.info(f"Updated alert {alert_id} to status: {status}")

            return updated

        except Exception as e:
            logger.error(f"Failed to update alert status: {e}")
            return False

    def get_alert(self, alert_id: str) -> Optional[dict]:
        """Get alert by ID.

        Args:
            alert_id: The alert ID

        Returns:
            Alert dict or None if not found
        """
        try:
            conn = self._get_connection()
            cursor = conn.cursor()

            cursor.execute("SELECT * FROM alerts WHERE id = ?", (alert_id,))
            row = cursor.fetchone()
            conn.close()

            if row:
                return dict(row)
            return None

        except Exception as e:
            logger.error(f"Failed to get alert: {e}")
            return None

    def get_analysis_run(self, analysis_run_id: str) -> Optional[dict]:
        """Get analysis run by ID.

        Args:
            analysis_run_id: The analysis run ID

        Returns:
            Analysis run dict or None if not found
        """
        try:
            conn = self._get_connection()
            cursor = conn.cursor()

            cursor.execute("SELECT * FROM analysis_runs WHERE id = ?", (analysis_run_id,))
            row = cursor.fetchone()
            conn.close()

            if row:
                return dict(row)
            return None

        except Exception as e:
            logger.error(f"Failed to get analysis run: {e}")
            return None
