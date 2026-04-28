import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.14.0'

// Helper: HMAC-SHA256 using built-in Web Crypto (no external imports needed)
async function hmacSHA256Hex(secret: string, data: string): Promise<string> {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    "raw", encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false, ["sign"]
  )
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(data))
  return Array.from(new Uint8Array(signature))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

serve(async (req) => {
  try {
    // Webhook from Razorpay
    const bodyText = await req.text()
    const rzpSignature = req.headers.get('x-razorpay-signature')

    const secret = Deno.env.get('RAZORPAY_WEBHOOK_SECRET')
    if (!secret || !rzpSignature) {
      throw new Error("Missing secret or signature")
    }

    // Verify HMAC using built-in crypto
    const expectedSignature = await hmacSHA256Hex(secret, bodyText)
    
    if (expectedSignature !== rzpSignature) {
      throw new Error("Invalid signature")
    }

    const payload = JSON.parse(bodyText)
    const payment = payload.payload.payment.entity
    const order = payload.payload.order.entity

    // The notes object contains the user data we passed in create-order
    const { name, email, phone, gender, occupation } = order.notes

    // 1. Save to Supabase DB
    const supabaseUrl = "https://ehnxtthhtjyijerayfqn.supabase.co"
    const supabaseKey = Deno.env.get('SERVICE_ROLE_KEY') || ''
    const supabase = createClient(supabaseUrl, supabaseKey)

    const { data: dbData, error: dbError } = await supabase
      .from('registrations')
      .insert([
        {
          name,
          email,
          phone,
          gender,
          occupation,
          workshop: 'AI & ChatGPT',
          razorpay_payment_id: payment.id,
          razorpay_order_id: order.id,
          amount: payment.amount,
          payment_status: payment.status,
        }
      ])
      .select()

    if (dbError) throw dbError

    // 2. Append to Google Sheets
    const googleAppScriptUrl = Deno.env.get('GOOGLE_APPS_SCRIPT_URL')
    if (googleAppScriptUrl) {
      console.log("Preparing to send data to Google Sheets...")
      try {
        await fetch(googleAppScriptUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name,
            email,
            phone,
            gender,
            occupation,
            order_id: order.id,
            payment_status: payment.status
          })
        })
      } catch (err) {
        console.error("Google Sheets Webhook Error:", err.message)
      }
    }

    // 3. Send Email via Resend
    const resendApiKey = Deno.env.get('RESEND_API_KEY')
    if (resendApiKey) {
      console.log(`Preparing to send email to ${email} via Resend...`)
      try {
        await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${resendApiKey}`
          },
          body: JSON.stringify({
            from: "IHRC Workshops <support@ihrcmahaedu.in>",
            to: [email],
            subject: "Workshop Registration Confirmed - IHRC Maharashtra (Education Department)",
            html: `
              <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eaeaec; border-radius: 8px;">
                <h2 style="color: #001F3F;">Registration Confirmed!</h2>
                <p>Dear <strong>${name}</strong>,</p>
                <p>Thank you for registering for the <strong>AI &amp; ChatGPT Workshop</strong>.</p>
                <p>Your payment was successful and your seat is confirmed.</p>
                <div style="background-color: #f9f9f9; padding: 15px; border-radius: 5px; margin: 20px 0;">
                  <p style="margin: 5px 0;"><strong>Order ID:</strong> ${order.id}</p>
                  <p style="margin: 5px 0;"><strong>Payment ID:</strong> ${payment.id}</p>
                </div>
                <p>We look forward to seeing you!</p>
                <p>Regards,<br>IHRC Maharashtra (Education Department)</p>
              </div>
            `
          })
        })
      } catch (err) {
        console.error("Resend Email Error:", err.message)
      }
    }

    return new Response(JSON.stringify({ status: "ok" }), {
      headers: { 'Content-Type': 'application/json' },
      status: 200,
    })

  } catch (error) {
    console.error("Webhook Error:", error.message)
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { 'Content-Type': 'application/json' },
      status: 400,
    })
  }
})
