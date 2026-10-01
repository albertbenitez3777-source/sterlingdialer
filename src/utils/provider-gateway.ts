// Public project identifier for the existing JWT gateway, not a user credential.
// The backend must still validate the PIN session and account permissions.
const PROJECT_ORIGIN = 'https://rqvpthnackbulnywwgix.supabase.co';
const PUBLIC_GATEWAY_JWT = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJxdnB0aG5hY2tidWxueXd3Z2l4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY2NjkwNzYsImV4cCI6MjEwMjI0NTA3Nn0.y6A7DtSDztvkp1oapVyYA6gHqZnh-lRl3r3JxqoihrI";

export function providerGatewayHeaders(url: string, input?: HeadersInit): Headers {
  const headers = new Headers(input);
  const direct = url === `${PROJECT_ORIGIN}/functions/v1/wolf-provider`;
  const preview = import.meta.env.DEV && url === '/functions/v1/wolf-provider';
  if (!direct && !preview) return headers;
  if (!headers.has('Authorization')) headers.set('Authorization', `Bearer ${PUBLIC_GATEWAY_JWT}`);
  if (!headers.has('apikey')) headers.set('apikey', PUBLIC_GATEWAY_JWT);
  return headers;
}
