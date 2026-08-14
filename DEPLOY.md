# Relative Estate — Material Pricing System
# Complete Deployment Guide

================================================================
OVERVIEW
================================================================

You will deploy this once. After that, every new project is just
data — no code changes, no redeployment, no rebuilding anything.

Tools you need:
- GitHub account (you already have this)
- Supabase account (free) — supabase.com
- Vercel account (free) — vercel.com
- Resend account (free) — resend.com
- Node.js installed on your computer — nodejs.org

Time required: 45–60 minutes total, mostly waiting for things to load.

================================================================
STEP 1 — SET UP YOUR COMPUTER (5 minutes)
================================================================

1. Check if Node.js is installed. Open Terminal and type:
      node --version

   If you see a version number (like v18.0.0), you're good.
   If not, go to nodejs.org, download and install the LTS version.

2. Check if you have npm:
      npm --version

   This comes with Node.js so it should be there.

================================================================
STEP 2 — CREATE YOUR GITHUB REPO (5 minutes)
================================================================

1. Go to github.com and sign in.

2. Click the "+" in the top right → "New repository"

3. Fill in:
   - Repository name: relative-estates-pricing
   - Visibility: Private
   - Do NOT check "Add a README file"
   - Click "Create repository"

4. On your computer, open Terminal and run these commands
   one at a time:

   cd ~/Desktop
   mkdir relative-estates-pricing
   cd relative-estates-pricing

5. Copy ALL the code files from this package into the folder.
   The structure should look like:

   relative-estates-pricing/
   ├── package.json
   ├── next.config.js
   ├── .gitignore
   ├── .env.local          ← you'll fill this in later
   ├── supabase-schema.sql ← you'll use this in Step 3
   ├── app/
   │   ├── layout.js
   │   ├── globals.css
   │   ├── page.js
   │   └── projects/
   │       └── [slug]/
   │           ├── dashboard/
   │           │   └── page.js
   │           └── form/
   │               └── [category]/
   │                   └── page.js
   │   └── api/
   │       ├── projects/
   │       │   └── route.js
   │       ├── submit/
   │       │   └── route.js
   │       └── approvals/
   │           └── route.js
   ├── lib/
   │   ├── supabase.js
   │   ├── categories.js
   │   └── utils.js

   IMPORTANT: The folder names with square brackets must be
   named EXACTLY as shown:
   - [slug]
   - [category]
   These are Next.js dynamic routes. The brackets must be included.

6. Push to GitHub:

   git init
   git add .
   git commit -m "initial commit"
   git branch -M main
   git remote add origin https://github.com/YOURUSERNAME/relative-estates-pricing.git
   git push -u origin main

   Replace YOURUSERNAME with your actual GitHub username.

================================================================
STEP 3 — SET UP SUPABASE (15 minutes)
================================================================

1. Go to supabase.com → Sign up (use GitHub login for easiest setup)

2. Click "New project"
   - Organization: your personal org
   - Project name: relative-estates
   - Database password: create a strong password, SAVE IT SOMEWHERE
   - Region: US East (N. Virginia) — closest to Kansas City
   - Click "Create new project"
   - Wait 2–3 minutes for it to set up

3. Once loaded, click "SQL Editor" in the left sidebar.

4. Click "New query" (top left of the editor)

5. Open the file "supabase-schema.sql" from this package.
   Copy the entire contents. Paste it into the SQL editor.
   Click "Run" (or press Cmd+Enter on Mac).

   You should see "Success. No rows returned" at the bottom.
   This means all 4 tables were created successfully.

6. Verify: Click "Table Editor" in the left sidebar.
   You should see 4 tables: projects, schedules, submissions, approvals.

   Then run "supabase-samples-migration.sql" the same way (New query →
   paste → Run). It adds the sample tracking columns to approvals, so you
   can track a sample you sent separately from the product itself. Safe to
   run on a database that already has data, and safe to run twice.

7. Get your API credentials:
   - Click "Project Settings" (gear icon) in the left sidebar
   - Click "API" in the settings menu
   - You need TWO values:
     a. "Project URL" — looks like https://xxxxxxxxxxxx.supabase.co
     b. "anon public" key — a long string starting with eyJ

   COPY BOTH AND SAVE THEM. You need these in the next step.

================================================================
STEP 4 — SET UP RESEND FOR EMAIL (5 minutes)
================================================================

1. Go to resend.com → Sign up (free)

2. Click "API Keys" in the left sidebar

3. Click "Create API Key"
   - Name: relative-estates
   - Permission: Full access
   - Click "Add"

4. Copy the API key shown (starts with "re_"). You only see this once.
   Save it somewhere safe.

5. Important: Verify your sending domain.
   - Click "Domains" in Resend's sidebar
   - Click "Add Domain"
   - Add "relativeestates.com" (your domain)
   - Follow the DNS instructions to verify it
   - This lets you send from notifications@relativeestates.com
   - If you skip this for now, emails will come from a Resend address

================================================================
STEP 5 — DEPLOY TO VERCEL (10 minutes)
================================================================

1. Go to vercel.com → Sign up using your GitHub account.
   (This automatically connects Vercel to GitHub.)

2. Click "Add New..." → "Project"

3. Find "relative-estates-pricing" in the list. Click "Import".

4. BEFORE clicking Deploy, scroll down to "Environment Variables".
   Click "Add" and enter each of these four, one at a time:

   Name: NEXT_PUBLIC_SUPABASE_URL
   Value: (paste your Supabase Project URL from Step 3)

   Name: NEXT_PUBLIC_SUPABASE_ANON_KEY
   Value: (paste your Supabase anon public key from Step 3)

   Name: RESEND_API_KEY
   Value: (paste your Resend API key from Step 4)

   Name: NOTIFY_EMAIL
   Value: emma@relativeestates.com

   Name: NEXT_PUBLIC_APP_URL
   Value: https://relative-estates-pricing.vercel.app
   (you'll update this later if you add a custom domain)

5. Click "Deploy".

6. Wait about 60–90 seconds. Vercel builds and deploys the app.

7. When done, you'll see a URL like:
   https://relative-estates-pricing.vercel.app

   Open it. You should see the Relative Estate admin home page.

================================================================
STEP 6 — TEST IT END TO END (10 minutes)
================================================================

1. Go to your Vercel URL.
   You should see the admin home with "No projects yet".

2. Click "New Project". Fill in:
   - Project Name: Test Project
   - Client: Test Client
   - Click Continue

3. Select "Stone" as the category. Click Continue.

4. Enter a manufacturer name: Stone Source International
   Upload the sample CSV (Stone_w_Locations.csv from earlier)
   Click "Create Project"

5. You should see your project card appear.

6. Click the project card → it takes you to the owner dashboard.

7. You should see the intro screen with the project name.
   Click "Begin Review" to enter the dashboard.

8. You should see the material schedule table.
   Try approving a few items, entering quantities.
   The projected cost should update in the top bar.

9. Now test the manufacturer form:
   - Click "Copy Form Link" in the schedule header
   - Open that link in a new browser tab
   - You should see the manufacturer pricing form
   - Fill in a few prices and click "Submit Pricing"
   - Check that emma@relativeestates.com received a notification email

10. Go back to the dashboard and refresh.
    The manufacturer's pricing should now appear in the table.

================================================================
STEP 7 — CUSTOM DOMAIN (5 minutes, optional)
================================================================

To use app.relativeestates.com instead of the Vercel URL:

1. In Vercel → your project → Settings → Domains

2. Type: app.relativeestates.com
   Click "Add"

3. Vercel gives you a CNAME record to add. It looks like:
   Type: CNAME
   Name: app
   Value: cname.vercel-dns.com

4. Log into wherever your domain is registered (GoDaddy, Cloudflare,
   Namecheap, etc.) and add that DNS record.

5. Come back to Vercel in 10–30 minutes. The domain will show as verified.

6. Update your NEXT_PUBLIC_APP_URL environment variable in Vercel:
   - Settings → Environment Variables
   - Find NEXT_PUBLIC_APP_URL
   - Change the value to: https://app.relativeestates.com
   - Vercel will redeploy automatically.

================================================================
STEP 8 — HOW TO USE IT GOING FORWARD
================================================================

Every new project:
1. Log in to your app
2. Click "New Project"
3. Enter project name, client name
4. Select which categories apply to this project
   (Stone, Doors, Hardware, Lighting, etc.)
5. For each category: enter manufacturer name, upload CSV
6. Click "Create Project"
7. Copy each category's form link → email to the manufacturer
8. When manufacturer submits → Emma gets notified automatically
9. Dashboard updates automatically
10. Share the dashboard link with owners before the meeting

================================================================
TROUBLESHOOTING
================================================================

Build fails on Vercel:
→ Check that your environment variables are set correctly
→ Make sure folder names [slug] and [category] have brackets
→ Check the Vercel build logs for the specific error

"Project not found" error on the form or dashboard:
→ The slug in the URL must match the project slug in Supabase
→ Go to Supabase → Table Editor → projects → check the slug column

Emails not arriving:
→ Check your Resend dashboard for send logs
→ Make sure your domain is verified in Resend
→ Check that NOTIFY_EMAIL is set correctly in Vercel

Supabase connection errors:
→ Double-check NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY
→ Make sure you copied the "anon public" key, not the "service_role" key

================================================================
ADDING A NEW CATEGORY LATER
================================================================

When you're ready to add Doors, Hardware, Lighting, or any other category:

1. Open lib/categories.js
2. Find the category you want to activate (e.g. "doors")
3. Change: status: 'coming_soon'
   To:     status: 'live'
4. Review the csvColumns and formFields — update them to match
   your actual CSV format
5. Save the file
6. Push to GitHub: git add . && git commit -m "activate doors" && git push
7. Vercel redeploys automatically in about 60 seconds
8. The category is now live for all new and existing projects

================================================================
SUPPORT
================================================================

If you get stuck, the most helpful resources are:

Next.js docs: nextjs.org/docs
Supabase docs: supabase.com/docs
Vercel docs: vercel.com/docs
Resend docs: resend.com/docs

For the most common issues, the Vercel build log tells you exactly
what went wrong. Always check that first.
