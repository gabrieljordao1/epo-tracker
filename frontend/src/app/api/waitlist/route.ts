import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import {
  getWelcomeEmailHtml,
  getWelcomeEmailText,
} from "@/lib/emails/welcome";

// Validate email format
function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, email, company } = body;

    // Validate all fields are present
    if (!name || !email || !company) {
      return NextResponse.json(
        { error: "All fields (name, email, company) are required" },
        { status: 400 }
      );
    }

    // Validate email format
    if (!isValidEmail(email)) {
      return NextResponse.json(
        { error: "Please provide a valid email address" },
        { status: 400 }
      );
    }

    // Validate field lengths
    if (name.trim().length === 0 || name.length > 255) {
      return NextResponse.json(
        { error: "Name must be between 1 and 255 characters" },
        { status: 400 }
      );
    }

    if (company.trim().length === 0 || company.length > 255) {
      return NextResponse.json(
        { error: "Company must be between 1 and 255 characters" },
        { status: 400 }
      );
    }

    // Get Supabase credentials from environment variables
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseKey) {
      console.error("Supabase credentials are not configured");
      return NextResponse.json(
        { error: "Server configuration error" },
        { status: 500 }
      );
    }

    // POST to Supabase REST API
    const response = await fetch(`${supabaseUrl}/rest/v1/waitlist`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
      },
      body: JSON.stringify({
        name: name.trim(),
        email: email.toLowerCase().trim(),
        company: company.trim(),
      }),
    });

    // Check for duplicate email (Supabase returns 409 for constraint violations)
    if (response.status === 409) {
      return NextResponse.json(
        {
          error:
            "This email is already on our waitlist. We'll be in touch soon!",
        },
        { status: 409 }
      );
    }

    if (!response.ok) {
      const errorData = await response.text();
      console.error("Supabase error:", response.status, errorData);

      if (response.status === 400) {
        return NextResponse.json(
          { error: "Invalid data provided. Please check your inputs." },
          { status: 400 }
        );
      }

      return NextResponse.json(
        { error: "Failed to add you to the waitlist. Please try again." },
        { status: response.status }
      );
    }

    // Send welcome email via Resend (non-blocking — don't fail the signup if email fails)
    const resendApiKey = process.env.RESEND_API_KEY;
    if (resendApiKey) {
      try {
        const resend = new Resend(resendApiKey);
        await resend.emails.send({
          from: "Gabriel from Onyx <hello@onyxepos.com>",
          to: email.toLowerCase().trim(),
          replyTo: "hello@onyxepos.com",
          subject: "Welcome to Onyx — you're on the list",
          html: getWelcomeEmailHtml(name.trim()),
          text: getWelcomeEmailText(name.trim()),
        });
      } catch (emailError) {
        // Log the error but don't fail the signup
        console.error("Failed to send welcome email:", emailError);
      }
    } else {
      console.warn(
        "RESEND_API_KEY not configured — skipping welcome email"
      );
    }

    return NextResponse.json(
      { success: true, message: "Successfully joined the waitlist" },
      { status: 201 }
    );
  } catch (error) {
    console.error("Waitlist API error:", error);

    if (error instanceof SyntaxError) {
      return NextResponse.json(
        { error: "Invalid request format" },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: "An unexpected error occurred. Please try again later." },
      { status: 500 }
    );
  }
}
