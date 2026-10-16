import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.14.0'

// CORS Headers for browser requests
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Helper: HMAC-SHA256 using built-in Web Crypto
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
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const body = await req.json()
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      // Registrant details passed from the frontend
      name,
      email,
      phone,
      gender,
      occupation,
      workshop,
      amount,
    } = body

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      throw new Error("Missing required payment fields: order_id, payment_id, or signature.")
    }

    const key_secret = Deno.env.get('RAZORPAY_KEY_SECRET')
    if (!key_secret) {
      throw new Error("Razorpay key secret is not configured on the server.")
    }

    // Razorpay signs: razorpay_order_id + "|" + razorpay_payment_id
    const payload = `${razorpay_order_id}|${razorpay_payment_id}`
    const expectedSignature = await hmacSHA256Hex(key_secret, payload)

    if (expectedSignature !== razorpay_signature) {
      // Signature mismatch — payment is not genuine
      return new Response(
        JSON.stringify({ verified: false, error: "Payment signature verification failed." }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 400,
        }
      )
    }

    // ✅ Signature is valid — now save to Supabase DB
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
    const supabaseKey = Deno.env.get('SERVICE_ROLE_KEY') || ''

    if (supabaseUrl && supabaseKey) {
      try {
        const supabase = createClient(supabaseUrl, supabaseKey)
        const { error: dbError } = await supabase
          .from('registrations')
          .insert([
            {
              name,
              email,
              phone,
              gender,
              occupation,
              workshop: workshop || 'Effective Communication',
              razorpay_payment_id,
              razorpay_order_id,
              amount: amount || 9900,
              payment_status: 'captured',
            }
          ])
        if (dbError) {
          console.error("Supabase DB insert error:", dbError.message)
        } else {
          console.log("Registration saved to Supabase successfully.")
        }
      } catch (dbErr) {
        console.error("Supabase error:", dbErr.message)
      }
    } else {
      console.warn("Supabase credentials not set — skipping DB insert.")
    }

    // ✅ Append to Google Sheets
    const googleAppScriptUrl = Deno.env.get('GOOGLE_APPS_SCRIPT_URL')
    if (googleAppScriptUrl) {
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
            workshop: workshop || 'Effective Communication',
            order_id: razorpay_order_id,
            payment_id: razorpay_payment_id,
            payment_status: 'captured',
            amount: amount || 9900,
          })
        })
        console.log("Data sent to Google Sheets successfully.")
      } catch (sheetsErr) {
        console.error("Google Sheets error:", sheetsErr.message)
      }
    }

    // ✅ Send Confirmation Email via Resend
    const resendApiKey = Deno.env.get('RESEND_API_KEY')
    if (resendApiKey && email) {
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
                <p>Thank you for registering for the <strong>${workshop || 'Effective Communication'} Workshop</strong>.</p>
                <p>Your payment was successful and your seat is confirmed.</p>
                <div style="background-color: #f9f9f9; padding: 15px; border-radius: 5px; margin: 20px 0;">
                  <p style="margin: 5px 0;"><strong>Order ID:</strong> ${razorpay_order_id}</p>
                  <p style="margin: 5px 0;"><strong>Payment ID:</strong> ${razorpay_payment_id}</p>
                </div>
                <p>We look forward to seeing you!</p>
                <p>Regards,<br>IHRC Maharashtra (Education Department)</p>
              </div>
            `
          })
        })
        console.log(`Confirmation email sent to ${email}`)
      } catch (emailErr) {
        console.error("Resend Email Error:", emailErr.message)
      }
    }

    // Return verified: true
    return new Response(
      JSON.stringify({ verified: true }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    )

  } catch (error) {
    console.error("verify-payment-frontend error:", error.message)
    return new Response(
      JSON.stringify({ verified: false, error: error.message }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      }
    )
  }
})
