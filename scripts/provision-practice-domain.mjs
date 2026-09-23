// Throwaway admin script for enabling a practice's own custom SES sending
// domain — NOT shipped as part of the app, not a self-service feature. See
// CLAUDE.md's "Email notifications" section for the full reasoning: a real
// self-service settings page (where a practice configures this itself) is
// a deferred future task; for now this is a manual, staff-run action, same
// shape as scripts/verify-tenant-isolation.mjs already establishes for
// this repo's admin-only scripts.
//
// This calls SES CreateEmailIdentity/GetEmailIdentity directly, under the
// SAME AWS account the Edge Functions already send through — no new AWS
// account, IAM user, or sandbox/production-access request needed per
// practice (see the discussion in CLAUDE.md: SES supports many verified
// domain identities under one account).
//
// Credentials: uses the AWS SDK's default credential provider chain (your
// own `aws configure` profile, or AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY/
// AWS_REGION env vars) — deliberately NOT the restricted send-only IAM
// user (SES_ACCESS_KEY_ID/SES_SECRET_ACCESS_KEY) the Edge Functions use via
// `supabase secrets set`, since this script needs broader permissions
// (ses:CreateEmailIdentity/ses:GetEmailIdentity) that a function-facing
// credential should never carry. Also needs SUPABASE_SERVICE_ROLE_KEY set
// (not committed anywhere — Project Settings -> API on the live project)
// to write practices.custom_domain_* columns, since those are behind RLS.
//
// Usage (run from the repo root):
//   Step 1 — provision the identity and get DNS instructions:
//     AWS_REGION=eu-central-1 SUPABASE_SERVICE_ROLE_KEY=... \
//       node scripts/provision-practice-domain.mjs --practice-id <id> --domain mail.example.com
//
//   Step 2 — after the practice has added the printed DKIM CNAME records to
//   their own DNS, check verification status (run again until it reports
//   SUCCESS — SES/DNS propagation can take anywhere from minutes to ~72h):
//     SUPABASE_SERVICE_ROLE_KEY=... node scripts/provision-practice-domain.mjs --practice-id <id> --check
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { SESv2Client, CreateEmailIdentityCommand, GetEmailIdentityCommand } from '@aws-sdk/client-sesv2';

function loadEnv(path) {
  const out = {};
  try {
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
    }
  } catch {
    // .env not found — fine, callers can rely on real env vars instead.
  }
  return out;
}

const fileEnv = loadEnv(fileURLToPath(new URL('../.env', import.meta.url)));
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || fileEnv.VITE_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || fileEnv.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Missing VITE_SUPABASE_URL (in .env) or SUPABASE_SERVICE_ROLE_KEY (env var — not stored in .env, paste from Project Settings -> API).');
  process.exit(1);
}

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, arg, i, all) => {
    if (arg.startsWith('--')) pairs.push([arg.slice(2), all[i + 1]?.startsWith('--') ? true : (all[i + 1] ?? true)]);
    return pairs;
  }, [])
);

const practiceId = args['practice-id'];
if (!practiceId) {
  console.error('Missing --practice-id <id>');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
const ses = new SESv2Client({ region: process.env.AWS_REGION || 'eu-central-1' });

async function provision(domain) {
  console.log(`Creating SES email identity for "${domain}" (practice ${practiceId}) ...`);
  const result = await ses.send(new CreateEmailIdentityCommand({ EmailIdentity: domain }));

  const dkimTokens = (result.DkimAttributes?.Tokens ?? []).map((token) => ({
    name: `${token}._domainkey.${domain}`,
    type: 'CNAME',
    value: `${token}.dkim.amazonses.com`,
  }));

  const { error } = await supabase
    .from('practices')
    .update({
      custom_domain: domain,
      custom_domain_dkim_tokens: dkimTokens,
      custom_domain_requested_at: new Date().toISOString(),
      custom_domain_verified: false,
    })
    .eq('id', practiceId);
  if (error) {
    console.error('Failed to save domain config to practices row:', error.message);
    process.exit(1);
  }

  console.log('\nDone. Give the practice these 3 DNS records to add (CNAME):\n');
  for (const t of dkimTokens) console.log(`  ${t.name}  ->  ${t.value}`);
  console.log(
    `\nOnce added, run:\n  SUPABASE_SERVICE_ROLE_KEY=... node scripts/provision-practice-domain.mjs --practice-id ${practiceId} --check\n` +
      'until it reports SUCCESS. custom_domain_verified stays false (so sending keeps falling back to the shared platform domain) until then.\n' +
      "Note: email_sending_mode on the practices row still needs to be set to 'custom_domain' by hand once verification succeeds — this script " +
      'only provisions/checks the identity, it deliberately does not flip the mode automatically.'
  );
}

async function check() {
  const { data: practice, error } = await supabase.from('practices').select('custom_domain').eq('id', practiceId).single();
  if (error || !practice?.custom_domain) {
    console.error('No custom_domain on file for this practice — run without --check first.');
    process.exit(1);
  }

  const result = await ses.send(new GetEmailIdentityCommand({ EmailIdentity: practice.custom_domain }));
  const status = result.VerificationStatus;
  console.log(`VerificationStatus for ${practice.custom_domain}: ${status}`);

  if (status === 'SUCCESS') {
    const { error: updateError } = await supabase
      .from('practices')
      .update({ custom_domain_verified: true, custom_domain_verified_at: new Date().toISOString() })
      .eq('id', practiceId);
    if (updateError) {
      console.error('Verified in SES, but failed to update practices row:', updateError.message);
      process.exit(1);
    }
    console.log(
      'custom_domain_verified is now true. Remember to also set email_sending_mode = \'custom_domain\' on this practices row ' +
        '(by hand, e.g. via the Supabase Table Editor) for sending to actually switch over — see the note above.'
    );
  }
}

if (args.check) {
  await check();
} else if (args.domain) {
  await provision(args.domain);
} else {
  console.error('Usage: node scripts/provision-practice-domain.mjs --practice-id <id> (--domain <domain> | --check)');
  process.exit(1);
}
