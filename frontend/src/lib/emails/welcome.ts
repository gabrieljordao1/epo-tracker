/**
 * Welcome email template for Onyx early access waitlist signups.
 * Sent automatically when someone joins through www.onyxepos.com
 */

export function getWelcomeEmailHtml(name: string): string {
  const firstName = name.split(" ")[0];

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Welcome to Onyx</title>
</head>
<body style="margin:0;padding:0;background-color:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#0a0a0a;padding:40px 20px;">
    <tr>
      <td align="center">
        <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">

          <!-- Logo -->
          <tr>
            <td align="center" style="padding-bottom:32px;">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" fill="none" width="48" height="48">
                <line x1="20" y1="4" x2="33" y2="13" stroke="#34d399" stroke-width="1.2" opacity="0.6"/>
                <line x1="33" y1="13" x2="33" y2="27" stroke="#34d399" stroke-width="1.2" opacity="0.6"/>
                <line x1="33" y1="27" x2="20" y2="36" stroke="#34d399" stroke-width="1.2" opacity="0.6"/>
                <line x1="20" y1="36" x2="7" y2="27" stroke="#34d399" stroke-width="1.2" opacity="0.6"/>
                <line x1="7" y1="27" x2="7" y2="13" stroke="#34d399" stroke-width="1.2" opacity="0.6"/>
                <line x1="7" y1="13" x2="20" y2="4" stroke="#34d399" stroke-width="1.2" opacity="0.6"/>
                <circle cx="20" cy="4" r="2.5" fill="#34d399"/>
                <circle cx="33" cy="13" r="2.5" fill="#34d399"/>
                <circle cx="33" cy="27" r="2.5" fill="#34d399"/>
                <circle cx="20" cy="36" r="2.5" fill="#34d399"/>
                <circle cx="7" cy="27" r="2.5" fill="#34d399"/>
                <circle cx="7" cy="13" r="2.5" fill="#34d399"/>
                <circle cx="20" cy="20" r="3.5" fill="#34d399"/>
              </svg>
              <div style="color:#ffffff;font-size:22px;font-weight:600;letter-spacing:0.05em;margin-top:12px;">ONYX</div>
            </td>
          </tr>

          <!-- Main card -->
          <tr>
            <td style="background-color:#111111;border-radius:12px;padding:40px 36px;border:1px solid rgba(255,255,255,0.06);">

              <!-- Greeting -->
              <p style="color:#ffffff;font-size:20px;font-weight:600;margin:0 0 8px 0;">
                Hey ${firstName},
              </p>
              <p style="color:rgba(255,255,255,0.7);font-size:15px;line-height:1.7;margin:0 0 24px 0;">
                Thanks for signing up for early access to Onyx. You're one of the first people to see what we're building and that means a lot.
              </p>

              <!-- What Onyx is -->
              <p style="color:rgba(255,255,255,0.7);font-size:15px;line-height:1.7;margin:0 0 24px 0;">
                Onyx is EPO tracking built specifically for trade contractors. If you've ever lost track of an EPO buried in an email thread, chased a builder for a confirmation that never came, or watched extra work revenue slip through the cracks, that's exactly what we're here to fix.
              </p>

              <!-- Divider -->
              <div style="border-top:1px solid rgba(255,255,255,0.08);margin:28px 0;"></div>

              <!-- What's next -->
              <p style="color:#ffffff;font-size:16px;font-weight:600;margin:0 0 12px 0;">
                What happens next
              </p>
              <p style="color:rgba(255,255,255,0.7);font-size:15px;line-height:1.7;margin:0 0 24px 0;">
                We're rolling out access in small batches over the coming weeks. When your spot opens up, you'll get an email with everything you need to get started. In the meantime, if you have any questions about Onyx, how it works, or anything at all, just reply to this email. I read every one of them.
              </p>

              <!-- CTA -->
              <table role="presentation" cellpadding="0" cellspacing="0" style="margin:28px 0;">
                <tr>
                  <td style="background-color:rgba(52,211,153,0.1);border:1px solid rgba(52,211,153,0.3);border-radius:8px;padding:16px 24px;">
                    <p style="color:#34d399;font-size:14px;font-weight:500;margin:0 0 4px 0;">Have questions?</p>
                    <p style="color:rgba(255,255,255,0.6);font-size:13px;margin:0;">
                      Just hit reply. I'm happy to chat about how Onyx can help your team.
                    </p>
                  </td>
                </tr>
              </table>

              <!-- Sign off -->
              <p style="color:rgba(255,255,255,0.7);font-size:15px;line-height:1.7;margin:0 0 4px 0;">
                Talk soon,
              </p>
              <p style="color:#ffffff;font-size:15px;font-weight:600;margin:0 0 2px 0;">
                Gabriel Jordao
              </p>
              <p style="color:rgba(255,255,255,0.4);font-size:13px;margin:0;">
                Founder, Onyx
              </p>

            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td align="center" style="padding-top:28px;">
              <p style="color:rgba(255,255,255,0.25);font-size:12px;margin:0 0 4px 0;">
                Onyx &mdash; EPO Tracking for Trade Contractors
              </p>
              <p style="color:rgba(255,255,255,0.2);font-size:11px;margin:0;">
                <a href="https://www.onyxepos.com" style="color:rgba(52,211,153,0.5);text-decoration:none;">www.onyxepos.com</a>
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
}

export function getWelcomeEmailText(name: string): string {
  const firstName = name.split(" ")[0];

  return `Hey ${firstName},

Thanks for signing up for early access to Onyx. You're one of the first people to see what we're building and that means a lot.

Onyx is EPO tracking built specifically for trade contractors. If you've ever lost track of an EPO buried in an email thread, chased a builder for a confirmation that never came, or watched extra work revenue slip through the cracks, that's exactly what we're here to fix.

What happens next:

We're rolling out access in small batches over the coming weeks. When your spot opens up, you'll get an email with everything you need to get started. In the meantime, if you have any questions about Onyx, how it works, or anything at all, just reply to this email. I read every one of them.

Talk soon,
Gabriel Jordao
Founder, Onyx

---
Onyx — EPO Tracking for Trade Contractors
www.onyxepos.com`.trim();
}
