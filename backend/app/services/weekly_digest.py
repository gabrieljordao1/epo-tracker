"""
Weekly digest service for EPO Tracker.
Generates and sends comprehensive digest emails to admins/managers.
"""

from datetime import datetime, timedelta
from typing import Dict, Any, List
from sqlalchemy import select, and_, func, case
from sqlalchemy.ext.asyncio import AsyncSession
import logging

from ..core.database import async_session_maker
from ..core.config import get_settings
from ..models.models import EPO, User, Company, EPOStatus, UserRole
from .email_sender import EmailSenderService

logger = logging.getLogger(__name__)
settings = get_settings()


async def generate_weekly_digest(session: AsyncSession, company_id: int) -> Dict[str, Any]:
    """
    Generate weekly digest data for a company.
    Queries EPOs created/updated in the last 7 days and aggregates metrics.
    """
    # Get company
    company_stmt = select(Company).where(Company.id == company_id)
    company_result = await session.execute(company_stmt)
    company = company_result.scalar_one_or_none()

    if not company:
        logger.warning(f"Company {company_id} not found for digest generation")
        return {}

    # Time range: last 7 days
    now = datetime.utcnow()
    one_week_ago = now - timedelta(days=7)

    # Query EPOs for this company in the last 7 days
    epos_stmt = select(EPO).where(
        and_(
            EPO.company_id == company_id,
            EPO.created_at >= one_week_ago
        )
    )
    epos_result = await session.execute(epos_stmt)
    epos_list = epos_result.scalars().all()

    # Count by status
    new_epos_count = len(epos_list)
    confirmed_count = sum(1 for epo in epos_list if epo.status == EPOStatus.CONFIRMED)
    denied_count = sum(1 for epo in epos_list if epo.status == EPOStatus.DENIED)

    # Calculate values
    total_value = sum(epo.amount or 0 for epo in epos_list)
    pending_at_risk = sum(
        epo.amount or 0 for epo in epos_list
        if epo.status == EPOStatus.PENDING and (epo.days_open or 0) > 5
    )
    overdue_count = sum(
        1 for epo in epos_list
        if epo.status == EPOStatus.PENDING and (epo.days_open or 0) > 7
    )

    # Calculate capture rate (confirmed / total)
    capture_rate = (confirmed_count / new_epos_count * 100) if new_epos_count > 0 else 0

    # Top builders/vendors by EPO count
    vendor_counts: Dict[str, int] = {}
    vendor_confirmations: Dict[str, int] = {}
    for epo in epos_list:
        if epo.vendor_name:
            vendor_counts[epo.vendor_name] = vendor_counts.get(epo.vendor_name, 0) + 1
            if epo.status == EPOStatus.CONFIRMED:
                vendor_confirmations[epo.vendor_name] = vendor_confirmations.get(epo.vendor_name, 0) + 1

    # Sort vendors by count, take top 5
    top_vendors = sorted(vendor_counts.items(), key=lambda x: x[1], reverse=True)[:5]
    top_builders = [
        {
            "name": vendor,
            "epo_count": count,
            "confirmed": vendor_confirmations.get(vendor, 0),
            "confirmation_rate": (vendor_confirmations.get(vendor, 0) / count * 100) if count > 0 else 0
        }
        for vendor, count in top_vendors
    ]

    # Community breakdown
    community_stats: Dict[str, Dict[str, Any]] = {}
    for epo in epos_list:
        community = epo.community or "Unknown"
        if community not in community_stats:
            community_stats[community] = {
                "name": community,
                "epo_count": 0,
                "confirmed": 0,
                "denied": 0,
                "pending": 0,
                "value": 0
            }

        community_stats[community]["epo_count"] += 1
        community_stats[community]["value"] += epo.amount or 0

        if epo.status == EPOStatus.CONFIRMED:
            community_stats[community]["confirmed"] += 1
        elif epo.status == EPOStatus.DENIED:
            community_stats[community]["denied"] += 1
        elif epo.status == EPOStatus.PENDING:
            community_stats[community]["pending"] += 1

    communities = sorted(
        community_stats.values(),
        key=lambda x: x["value"],
        reverse=True
    )

    # Overdue EPOs needing attention (sorted by days open, descending)
    overdue_epos = [
        {
            "id": epo.id,
            "vendor": epo.vendor_name,
            "community": epo.community or "Unknown",
            "lot": epo.lot_number or "N/A",
            "amount": epo.amount or 0,
            "days_open": epo.days_open or 0,
            "description": epo.description or ""
        }
        for epo in epos_list
        if epo.status == EPOStatus.PENDING and (epo.days_open or 0) > 7
    ]
    overdue_epos.sort(key=lambda x: x["days_open"], reverse=True)

    # Calculate average response time (pending_at_risk vs total pending)
    pending_epos = [epo for epo in epos_list if epo.status == EPOStatus.PENDING]
    avg_response_time = 0
    if pending_epos:
        avg_response_time = sum(epo.days_open or 0 for epo in pending_epos) / len(pending_epos)

    return {
        "company_name": company.name,
        "period_start": one_week_ago.strftime("%b %d, %Y"),
        "period_end": now.strftime("%b %d, %Y"),
        "new_epos_count": new_epos_count,
        "confirmed_count": confirmed_count,
        "denied_count": denied_count,
        "pending_count": new_epos_count - confirmed_count - denied_count,
        "total_value": total_value,
        "pending_at_risk": pending_at_risk,
        "overdue_count": overdue_count,
        "capture_rate": round(capture_rate, 1),
        "avg_response_time": round(avg_response_time, 1),
        "top_builders": top_builders,
        "communities": communities,
        "overdue_epos": overdue_epos[:10],  # Top 10 oldest overdue
    }


def build_digest_html(digest_data: Dict[str, Any], company_name: str, recipient_name: str) -> str:
    """
    Build a beautiful, dark-themed HTML email with Onyx branding.

    Design uses:
    - Dark header (#0C1B2A) with emerald accent (#10B981)
    - KPI grid with key metrics
    - Top builders table with confirmation rates
    - Community breakdown
    - Action items for overdue EPOs
    - CTA button to dashboard
    """

    if not digest_data:
        return "<p>No digest data available.</p>"

    new_epos = digest_data.get("new_epos_count", 0)
    confirmed = digest_data.get("confirmed_count", 0)
    pending_risk = digest_data.get("pending_at_risk", 0)
    total_value = digest_data.get("total_value", 0)
    capture_rate = digest_data.get("capture_rate", 0)
    avg_response = digest_data.get("avg_response_time", 0)
    overdue = digest_data.get("overdue_count", 0)
    period_start = digest_data.get("period_start", "")
    period_end = digest_data.get("period_end", "")
    top_builders = digest_data.get("top_builders", [])
    communities = digest_data.get("communities", [])
    overdue_epos = digest_data.get("overdue_epos", [])

    # Build top builders table
    builders_html = ""
    if top_builders:
        builders_html = "<table style=\"width: 100%; border-collapse: collapse;\">"
        builders_html += "<tr style=\"border-bottom: 1px solid #e5e7eb;\">"
        builders_html += "<th style=\"text-align: left; padding: 12px; color: #374151; font-size: 13px; font-weight: 600;\">Vendor</th>"
        builders_html += "<th style=\"text-align: center; padding: 12px; color: #374151; font-size: 13px; font-weight: 600;\">EPOs</th>"
        builders_html += "<th style=\"text-align: left; padding: 12px; color: #374151; font-size: 13px; font-weight: 600;\">Confirm Rate</th>"
        builders_html += "</tr>"

        for builder in top_builders:
            rate = builder.get("confirmation_rate", 0)
            bar_width = int(rate / 100 * 80)
            builders_html += "<tr style=\"border-bottom: 1px solid #f3f4f6;\">"
            builders_html += f"<td style=\"padding: 12px; color: #1f2937; font-weight: 500;\">{builder.get('name', 'Unknown')}</td>"
            builders_html += f"<td style=\"text-align: center; padding: 12px; color: #1f2937;\">{builder.get('epo_count', 0)}</td>"
            builders_html += f"<td style=\"padding: 12px;\">"
            builders_html += f"<div style=\"background: #e5e7eb; border-radius: 4px; height: 6px; width: 80px; overflow: hidden;\">"
            builders_html += f"<div style=\"background: #10B981; height: 100%; width: {bar_width}px;\"></div>"
            builders_html += f"</div>"
            builders_html += f"<span style=\"font-size: 12px; color: #6b7280; margin-left: 6px;\">{rate:.0f}%</span>"
            builders_html += f"</td>"
            builders_html += "</tr>"

        builders_html += "</table>"

    # Build community breakdown
    communities_html = ""
    if communities:
        communities_html = "<table style=\"width: 100%; border-collapse: collapse;\">"
        communities_html += "<tr style=\"border-bottom: 1px solid #e5e7eb;\">"
        communities_html += "<th style=\"text-align: left; padding: 12px; color: #374151; font-size: 13px; font-weight: 600;\">Community</th>"
        communities_html += "<th style=\"text-align: center; padding: 12px; color: #374151; font-size: 13px; font-weight: 600;\">EPOs</th>"
        communities_html += "<th style=\"text-align: right; padding: 12px; color: #374151; font-size: 13px; font-weight: 600;\">Value</th>"
        communities_html += "</tr>"

        for comm in communities[:8]:  # Show top 8 communities
            communities_html += "<tr style=\"border-bottom: 1px solid #f3f4f6;\">"
            communities_html += f"<td style=\"padding: 12px; color: #1f2937; font-weight: 500;\">{comm.get('name', 'Unknown')}</td>"
            communities_html += f"<td style=\"text-align: center; padding: 12px; color: #1f2937;\">{comm.get('epo_count', 0)}</td>"
            communities_html += f"<td style=\"text-align: right; padding: 12px; color: #10B981; font-weight: 500;\">${comm.get('value', 0):,.0f}</td>"
            communities_html += "</tr>"

        communities_html += "</table>"

    # Build overdue EPOs section
    overdue_html = ""
    if overdue_epos:
        overdue_html = "<table style=\"width: 100%; border-collapse: collapse;\">"
        overdue_html += "<tr style=\"border-bottom: 1px solid #fee2e2;\">"
        overdue_html += "<th style=\"text-align: left; padding: 12px; color: #7f1d1d; font-size: 13px; font-weight: 600;\">Vendor</th>"
        overdue_html += "<th style=\"text-align: center; padding: 12px; color: #7f1d1d; font-size: 13px; font-weight: 600;\">Days Open</th>"
        overdue_html += "<th style=\"text-align: right; padding: 12px; color: #7f1d1d; font-size: 13px; font-weight: 600;\">Amount</th>"
        overdue_html += "</tr>"

        for epo in overdue_epos[:5]:  # Show top 5 overdue
            overdue_html += "<tr style=\"border-bottom: 1px solid #fee2e2;\">"
            overdue_html += f"<td style=\"padding: 12px; color: #1f2937;\"><strong>{epo.get('vendor', 'Unknown')}</strong><br><span style=\"font-size: 12px; color: #6b7280;\">{epo.get('lot', 'N/A')}</span></td>"
            overdue_html += f"<td style=\"text-align: center; padding: 12px; color: #dc2626; font-weight: 600;\">{epo.get('days_open', 0)} days</td>"
            overdue_html += f"<td style=\"text-align: right; padding: 12px; color: #1f2937; font-weight: 500;\">${epo.get('amount', 0):,.0f}</td>"
            overdue_html += "</tr>"

        overdue_html += "</table>"

    # Build conditional sections
    builders_section = ""
    if builders_html:
        builders_section = '<div class="section-title">Top Builders</div><div class="section-subtitle">Vendor performance by confirmation rate</div>' + builders_html

    communities_section = ""
    if communities_html:
        communities_section = '<div class="section-title">Communities</div><div class="section-subtitle">Activity and value by community</div>' + communities_html

    overdue_section = ""
    if overdue_html:
        overdue_msg = f"{overdue} EPOs need attention — {overdue} days or longer"
        overdue_section = '<div class="section-title" style="border-bottom-color: #ef4444; margin-top: 32px;">Action Items — Overdue EPOs</div><div class="section-subtitle" style="color: #dc2626;">' + overdue_msg + '</div>' + overdue_html

    app_url = settings.APP_URL
    dashboard_url = f"{app_url}/dashboard"
    settings_url = f"{app_url}/settings"
    support_url = f"{app_url}/support"

    # Complete HTML email
    html = f"""
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style type="text/css">
            body {{
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif;
                line-height: 1.6;
                color: #1f2937;
                background: #f9fafb;
                margin: 0;
                padding: 0;
            }}
            .container {{
                max-width: 700px;
                margin: 0 auto;
                padding: 20px;
            }}
            .header {{
                background: linear-gradient(135deg, #0C1B2A 0%, #1a2332 100%);
                color: white;
                padding: 32px 24px;
                border-radius: 12px 12px 0 0;
                text-align: center;
            }}
            .header h1 {{
                margin: 0;
                font-size: 28px;
                font-weight: 700;
                letter-spacing: -0.5px;
            }}
            .header p {{
                margin: 8px 0 0 0;
                font-size: 14px;
                opacity: 0.8;
            }}
            .onyx-accent {{
                color: #10B981;
                font-weight: 600;
            }}
            .content {{
                background: white;
                padding: 32px 24px;
                border: 1px solid #e5e7eb;
                border-top: none;
            }}
            .period {{
                text-align: center;
                color: #6b7280;
                font-size: 13px;
                margin-bottom: 24px;
                padding-bottom: 16px;
                border-bottom: 1px solid #f3f4f6;
            }}
            .kpi-grid {{
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 16px;
                margin-bottom: 32px;
            }}
            .kpi-card {{
                background: linear-gradient(135deg, #f8fafc 0%, #f0f9ff 100%);
                border: 1px solid #e0e7ff;
                border-radius: 8px;
                padding: 16px;
                text-align: center;
            }}
            .kpi-card.highlight {{
                background: linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%);
                border-color: #10B981;
            }}
            .kpi-card.warning {{
                background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%);
                border-color: #f59e0b;
            }}
            .kpi-card.danger {{
                background: linear-gradient(135deg, #fee2e2 0%, #fecaca 100%);
                border-color: #ef4444;
            }}
            .kpi-value {{
                font-size: 28px;
                font-weight: 700;
                color: #0C1B2A;
                margin: 8px 0;
            }}
            .kpi-card.highlight .kpi-value {{
                color: #10B981;
            }}
            .kpi-card.danger .kpi-value {{
                color: #dc2626;
            }}
            .kpi-label {{
                font-size: 12px;
                color: #6b7280;
                font-weight: 600;
                text-transform: uppercase;
                letter-spacing: 0.5px;
            }}
            .section-title {{
                font-size: 16px;
                font-weight: 700;
                color: #0C1B2A;
                margin: 24px 0 16px 0;
                padding-bottom: 8px;
                border-bottom: 2px solid #10B981;
            }}
            .section-subtitle {{
                font-size: 13px;
                color: #6b7280;
                margin-bottom: 12px;
            }}
            .cta-button {{
                display: inline-block;
                background: linear-gradient(135deg, #10B981 0%, #059669 100%);
                color: white;
                padding: 12px 32px;
                border-radius: 8px;
                text-decoration: none;
                font-weight: 600;
                font-size: 15px;
                text-align: center;
                margin: 24px 0;
            }}
            .footer {{
                background: #f9fafb;
                padding: 24px;
                border: 1px solid #e5e7eb;
                border-top: none;
                border-radius: 0 0 12px 12px;
                text-align: center;
                font-size: 12px;
                color: #6b7280;
            }}
            .footer a {{
                color: #10B981;
                text-decoration: none;
                font-weight: 600;
            }}
            @media (max-width: 600px) {{
                .kpi-grid {{
                    grid-template-columns: 1fr;
                }}
                .header h1 {{
                    font-size: 22px;
                }}
                .content {{
                    padding: 20px 16px;
                }}
            }}
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>Weekly EPO Digest</h1>
                <p>Performance summary for <span class="onyx-accent">{company_name}</span></p>
            </div>

            <div class="content">
                <div class="period">
                    {period_start} — {period_end}
                </div>

                <p>Hi {recipient_name},</p>
                <p>Here's your weekly EPO performance summary. Review key metrics, top vendors, and action items below.</p>

                <div class="kpi-grid">
                    <div class="kpi-card">
                        <div class="kpi-label">New EPOs</div>
                        <div class="kpi-value">{new_epos}</div>
                    </div>
                    <div class="kpi-card highlight">
                        <div class="kpi-label">Confirmed</div>
                        <div class="kpi-value">{confirmed}</div>
                    </div>
                    <div class="kpi-card warning">
                        <div class="kpi-label">At Risk</div>
                        <div class="kpi-value">${pending_risk:,.0f}</div>
                    </div>
                    <div class="kpi-card">
                        <div class="kpi-label">Total Value</div>
                        <div class="kpi-value">${total_value:,.0f}</div>
                    </div>
                    <div class="kpi-card highlight">
                        <div class="kpi-label">Capture Rate</div>
                        <div class="kpi-value">{capture_rate:.0f}%</div>
                    </div>
                    <div class="kpi-card">
                        <div class="kpi-label">Avg Response</div>
                        <div class="kpi-value">{avg_response:.0f}d</div>
                    </div>
                </div>

                {builders_section}

                {communities_section}

                {overdue_section}

                <center>
                    <a href="{dashboard_url}" class="cta-button">View Full Dashboard</a>
                </center>

                <p style="color: #6b7280; font-size: 13px; margin-top: 32px;">
                    You're receiving this email because you're an admin or manager on {company_name}.
                    If you'd like to adjust your notification preferences, visit your account settings.
                </p>
            </div>

            <div class="footer">
                <p style="margin: 0;"><strong>EPO Tracker</strong></p>
                <p style="margin: 4px 0 0 0;">
                    <a href="{app_url}">Visit Dashboard</a> |
                    <a href="{settings_url}">Settings</a> |
                    <a href="{support_url}">Support</a>
                </p>
                <p style="margin: 12px 0 0 0; opacity: 0.7;">© 2024 EPO Tracker. All rights reserved.</p>
            </div>
        </div>
    </body>
    </html>
    """

    return html


async def send_weekly_digest():
    """
    Send weekly digest emails to all admin/manager users across all companies.

    For each company:
    1. Generate digest data
    2. Get all admins/managers
    3. Build personalized HTML
    4. Send via EmailSenderService
    5. Log results
    """
    logger.info("Starting weekly digest email send...")

    email_service = EmailSenderService(
        api_key=settings.RESEND_API_KEY,
        from_address=settings.EMAIL_FROM_ADDRESS,
        from_name=settings.EMAIL_FROM_NAME,
    )

    sent_count = 0
    failed_count = 0

    async with async_session_maker() as session:
        # Get all companies
        companies_stmt = select(Company)
        companies_result = await session.execute(companies_stmt)
        companies = companies_result.scalars().all()

        logger.info(f"Processing {len(companies)} companies for weekly digest")

        for company in companies:
            try:
                # Generate digest data for this company
                digest_data = await generate_weekly_digest(session, company.id)

                if not digest_data:
                    logger.debug(f"No digest data for company {company.id} ({company.name})")
                    continue

                # Get all admins and managers for this company
                users_stmt = select(User).where(
                    and_(
                        User.company_id == company.id,
                        User.role.in_([UserRole.ADMIN, UserRole.MANAGER]),
                        User.is_active == True,
                        User.email_verified == True,
                    )
                )
                users_result = await session.execute(users_stmt)
                recipients = users_result.scalars().all()

                if not recipients:
                    logger.debug(f"No admin/manager recipients for company {company.id}")
                    continue

                logger.info(f"Sending digest to {len(recipients)} recipients in {company.name}")

                # Send to each recipient
                for user in recipients:
                    try:
                        # Build personalized HTML
                        html_body = build_digest_html(
                            digest_data,
                            company.name,
                            user.full_name.split()[0] if user.full_name else "There"
                        )

                        # Send email
                        result = await email_service._send(
                            to=user.email,
                            subject=f"Weekly EPO Digest — {company.name}",
                            html=html_body,
                        )

                        if result.get("success"):
                            sent_count += 1
                            logger.info(f"Digest sent to {user.email} ({company.name})")
                        else:
                            failed_count += 1
                            logger.warning(
                                f"Failed to send digest to {user.email}: {result.get('error', 'Unknown error')}"
                            )

                    except Exception as e:
                        failed_count += 1
                        logger.error(f"Error sending digest to {user.email}: {str(e)}")

            except Exception as e:
                logger.error(f"Error processing company {company.id} ({company.name}): {str(e)}")

    logger.info(f"Weekly digest send complete: {sent_count} sent, {failed_count} failed")
    return {
        "sent": sent_count,
        "failed": failed_count,
        "timestamp": datetime.utcnow().isoformat(),
    }
