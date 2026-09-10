/** Shared Google OAuth config. Client ID is public; the secret stays server-side. */
export function googleConfig() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const base = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  return {
    clientId,
    clientSecret,
    redirectUri: `${base}/auth/google/callback`,
    configured: Boolean(clientId && clientSecret),
  };
}
