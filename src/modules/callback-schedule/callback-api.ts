import {SUPABASE_URL} from '@/app/shared';
// Callback reads and owner controls have an isolated, session-verified endpoint.
export const CALLBACK_WORKSPACE_URL=`${SUPABASE_URL}/functions/v1/wolf-callback-workspace`;
