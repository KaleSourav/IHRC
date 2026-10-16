import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { name, email, phone, gender, occupation, workshop } = await req.json()

    const key_id = Deno.env.get('RAZORPAY_KEY_ID')
    const key_secret = Deno.env.get('RAZORPAY_KEY_SECRET')

    if (!key_id || !key_secret) {
      throw new Error("Razorpay credentials are not set.")
    }

    const amount = 9900; // ₹99 in paise
    const currency = "INR";

    const basicAuth = btoa(`${key_id}:${key_secret}`)

    const rzpResponse = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Basic ${basicAuth}`
      },
      body: JSON.stringify({
        amount,
        currency,
        receipt: `receipt_${Date.now()}`,
        notes: {
          name,
          email,
          phone,
          gender,
          occupation,
          workshop: workshop || 'Workshop'
        }
      })
    })

    const rzpData = await rzpResponse.json()

    if (!rzpResponse.ok) {
      throw new Error(rzpData.error?.description || "Failed to create Razorpay order")
    }

    return new Response(
      JSON.stringify({
        order_id: rzpData.id,
        amount: amount,
        key_id: key_id
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      },
    )
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      },
    )
  }
})
