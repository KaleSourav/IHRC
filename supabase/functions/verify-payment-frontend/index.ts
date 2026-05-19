import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

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
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = await req.json()

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

    // Signature is valid — payment is genuine
    return new Response(
      JSON.stringify({ verified: true }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    )

  } catch (error) {
    return new Response(
      JSON.stringify({ verified: false, error: error.message }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      }
    )
  }
})
