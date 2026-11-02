# Putting CRAVE online (no coding needed)

CRAVE runs as a **web app**: people open a link on their phone, and can tap *Share → Add to Home Screen* so it opens like a normal app. No App Store needed.

For this first test, people can **sign up, watch, swipe, crave, follow, comment and post their own food videos**. Ordering shows "coming soon". You approve every video before it appears.

You'll create two free accounts. Claude does the rest.

---

## Step 1 — Supabase (the app's database and logins) · about 10 minutes

1. Go to **supabase.com** → **Start your project** → sign up (GitHub sign-in is easiest).
2. Click **New project**.
   - Name: `crave`
   - Database password: click **Generate a password** (you won't need to remember it).
   - Region: **Sydney** (closest to Brisbane).
   - Plan: **Free**.
3. Wait for it to finish setting up (a couple of minutes).
4. Collect these values — you'll paste them into **Claude's environment settings**, never into the chat:

| Name to use | Where to find it in Supabase |
|---|---|
| `SUPABASE_URL` | Project Settings → API → **Project URL** (looks like `https://abcd1234.supabase.co`) |
| `SUPABASE_ANON_KEY` | Project Settings → API Keys → **anon / public** key |
| `SUPABASE_SERVICE_ROLE_KEY` | Project Settings → API Keys → **service_role** key (secret — keep it private) |
| `SUPABASE_ACCESS_TOKEN` | Your avatar (top right) → **Account preferences** → **Access Tokens** → **Generate new token**, name it `claude` |

### Add them to Claude
1. In this Claude session, open the **environment menu in the title bar** → **Edit**.
2. Under **Network secrets** (or Environment variables), add each of the four values above using exactly those names.
3. Under **Network access → Allowed domains**, add these two (leave "Allow package managers" ticked):
   - `api.supabase.com`
   - your project's address without `https://`, e.g. `abcd1234.supabase.co`
4. Save, then **start a new session** and tell Claude "Supabase is ready".

Claude will then set up the database (tables, security rules, video storage) and check everything worked.

---

## Step 2 — Render (puts the app online) · about 10 minutes

Do this after Claude confirms Supabase is set up.

1. Go to **render.com** → **Get Started** → sign up **with GitHub** (use the GitHub account that owns `mo3yusuf/Moe`).
2. Click **New** → **Blueprint**.
3. Choose the **Moe** repository and click **Connect**. Render reads the plan Claude prepared (`render.yaml`) and shows three services: `crave-app`, `crave-api` and `crave-dashboard`.
4. Render asks for a few values. Paste the same Supabase values from Step 1:
   - `SUPABASE_URL` and `SUPABASE_ANON_KEY` (asked for each service)
   - `SUPABASE_SERVICE_ROLE_KEY` (only for `crave-api`)
5. Click **Apply**. Building takes about 5–10 minutes.
6. When it's done, click **crave-app** — its address (like `https://crave-app.onrender.com`) **is your app's link**. Send it to Claude.

Claude will then connect the sign-up emails to that address and test the live app.

---

## Step 3 — Make yourself the admin

1. Open your app link on your phone and **create an account**.
2. Tell Claude the email you used. Claude makes you the admin.
3. Open the **dashboard** link (`crave-dashboard` in Render) on a computer and sign in with the same account. New videos waiting for approval appear under **Admin → Video moderation**: press **Publish** or **Reject**.

---

## Good to know

- **Free plan limits:** after about 15 minutes with no visitors, the free server goes to sleep and the next visit takes about a minute to load. Before inviting lots of people, upgrade **crave-api** on Render to the cheapest paid plan (about US$7/month). Supabase's free plan pauses after a week with no activity — upgrade to Pro (about US$25/month) for a real launch.
- **Videos:** only approved videos appear. Uploads are limited to 3 minutes. Encourage people to name the restaurant and suburb in their caption.
- **Privacy:** the sign-up screen shows draft Terms and Privacy Policy notices. Have a lawyer review them before inviting the public.
- **Adding to the home screen:** iPhone — open the link in Safari → Share → *Add to Home Screen*. Android — Chrome menu → *Add to Home screen* / *Install app*.
- **Turning ordering on later:** tell Claude. It's a switch, plus setting up restaurants (and Stripe if you want card payments).
