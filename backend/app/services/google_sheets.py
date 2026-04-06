import json
from typing import List
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
import gspread
from google.auth.service_account import Credentials

from ..models.models import EPO, GoogleSheetConnection


class GoogleSheetsService:
    """Service to export EPO data to Google Sheets"""

    SCOPES = [
        "https://www.googleapis.com/auth/spreadsheets",
        "https://www.googleapis.com/auth/drive",
    ]

    def __init__(self, service_account_json: str):
        """Initialize Google Sheets service with service account credentials"""
        try:
            credentials_dict = json.loads(service_account_json)
            credentials = Credentials.from_service_account_info(
                credentials_dict, scopes=self.SCOPES
            )
            self.client = gspread.authorize(credentials)
        except Exception as e:
            raise ValueError(f"Invalid service account JSON: {str(e)}")

    async def export_epos(
        self,
        spreadsheet_id: str,
        sheet_name: str,
        epos: List[EPO],
        session: AsyncSession = None,
    ) -> bool:
        """Export EPOs to Google Sheets"""
        try:
            spreadsheet = self.client.open_by_key(spreadsheet_id)

            # Get or create worksheet
            try:
                worksheet = spreadsheet.worksheet(sheet_name)
            except gspread.exceptions.WorksheetNotFound:
                worksheet = spreadsheet.add_worksheet(title=sheet_name, rows=1, cols=14)

            # Prepare headers
            headers = [
                "Vendor Name",
                "Vendor Email",
                "Lot Number",
                "Community",
                "Amount",
                "Currency",
                "Description",
                "Confirmation Number",
                "Contact Person",
                "Phone",
                "Website",
                "Status",
                "Needs Review",
                "Created Date",
            ]

            # Clear existing data
            worksheet.clear()

            # Write headers
            worksheet.append_row(headers, table_range="A1:N1")

            # Prepare rows
            rows = []
            for epo in epos:
                row = [
                    epo.vendor_name,
                    epo.vendor_email,
                    epo.lot_number,
                    epo.community,
                    epo.amount,
                    epo.currency,
                    epo.description,
                    epo.confirmation_number,
                    epo.contact_person,
                    epo.phone,
                    epo.website,
                    epo.status.value if epo.status else "",
                    "Yes" if epo.needs_review else "No",
                    epo.created_at.isoformat() if epo.created_at else "",
                ]
                rows.append(row)

            # Write data rows
            if rows:
                worksheet.append_rows(rows, table_range=f"A2:N{len(rows) + 1}")

            # Format header row
            self._format_header_row(worksheet)

            return True

        except gspread.exceptions.GspreadException as e:
            raise Exception(f"Google Sheets error: {str(e)}")
        except Exception as e:
            raise Exception(f"Error exporting to Google Sheets: {str(e)}")

    def _format_header_row(self, worksheet):
        """Format the header row with bold text and background color"""
        try:
            # This requires additional formatting, basic version shown
            worksheet.format(
                "A1:N1",
                {
                    "textFormat": {"bold": True, "foregroundColor": {"red": 1, "green": 1, "blue": 1}},
                    "backgroundColor": {"red": 0.2, "green": 0.2, "blue": 0.2},
                },
            )
        except Exception:
            # Formatting might not be critical, continue if it fails
            pass

    async def sync_company_epos(
        self,
        connection: GoogleSheetConnection,
        session: AsyncSession,
    ) -> bool:
        """Sync all EPOs for a company to Google Sheets"""
        try:
            # Get all EPOs for the company
            query = select(EPO).where(EPO.company_id == connection.company_id)
            result = await session.execute(query)
            epos = result.scalars().all()

            # Export to Google Sheets
            success = await self.export_epos(
                connection.spreadsheet_id,
                connection.sheet_name,
                epos,
                session,
            )

            if success:
                # Update last sync time
                connection.last_sync = datetime.utcnow()
                connection.sync_error = None
                await session.commit()

            return success

        except Exception as e:
            # Update error message
            connection.sync_error = str(e)
            await session.commit()
            raise
