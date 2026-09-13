# WhatsUp live video setup

The app contains the video room client and a session-authenticated token endpoint. A running LiveKit server is required before calls can connect. No public demo rooms are used.

Configure these server-side secrets on the existing `rqvpthnackbulnywwgix` project:

- `LIVEKIT_URL`: the server's secure `wss://` endpoint.
- `LIVEKIT_API_KEY`: its API key.
- `LIVEKIT_API_SECRET`: its matching secret.

Never put these credentials in Vite variables, chat messages, or GitHub. Use the project's protected secrets settings. The browser receives a short-lived, single-room join token; the API secret remains server-side.

Use a LiveKit Cloud project or a maintained self-hosted LiveKit server with working TLS and TURN connectivity. The app cannot provision this infrastructure automatically with its current connections.

After configuration, open WhatsUp → Live call. Confirm the setup error is gone. Use two authorized accounts on separate networks to test:

1. Join the Team call with explicitly chosen camera/microphone settings.
2. Confirm both participants appear, audio works both ways, and video renders.
3. Test mute, camera off/on, screen share/stop, and device-permission rejection.
4. Leave and confirm camera/microphone capture stops. Test a network interruption and reconnect.
5. Confirm a private conversation admits only its two participants. Owner chat-review access must not grant covert video access.
6. Confirm minimizing WhatsUp does not end a call, and logging out does.

The integration is not live-certified until these checks pass against the configured media server. No call recording is enabled by the application.
