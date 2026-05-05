// supabase/functions/issue-relay-token/index.ts
//
// Request:  POST {} (auth via forwarded JWT — caller must be signed in)
// Response: 200 { token: string, user_email: string }
//
// Generates a fresh plaintext relay token for the calling user and upserts
// relay_secrets keyed on user_email. Plaintext token returned in the response.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { cors, json } from "../_shared/helpers.ts";
import { createUserClient } from "../_shared/supabase-client.ts";
import { newPlaintextToken } from "../_shared/hmac.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors() });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  try {
    const supabase = createUserClient(req);

    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userData.user?.email) {
      return json({ error: "Not signed in" }, 401);
    }
    const email = userData.user.email;

    const token = newPlaintextToken();

    const { error } = await supabase
      .from("relay_secrets")
      .upsert(
        { user_email: email, secret: token, revoked_at: null },
        { onConflict: "user_email" },
      );
    if (error) return json({ error: error.message }, 500);

    return json({ token, user_email: email });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return json({ error: msg }, 500);
  }
});
