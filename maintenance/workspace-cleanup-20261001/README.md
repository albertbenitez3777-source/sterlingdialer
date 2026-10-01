# Workspace cleanup — prepared, not published

Removes the globally mounted chat/camera modules and the embedded agent-home chat/camera controls. Keeps the independent phone module mounted in the same place. Navigation emphasizes daily call work and groups secondary tools under More tools. Owner shortcuts are grouped the same way; agent performance moves above tool shortcuts and uses the full available width.

Call cards now show Today / Earlier call, an explicit year, and Costa Rica time. Old transfer records no longer display CALL NOW merely because they remain in the transferred queue. No historical record, transcript, recording, routing, campaign, credential, or permission is changed.

Validation: TypeScript check, 42 stability/date tests, and production build pass. Phone engine, call controller, dial request, PhoneModule, IPhone, RecordingPlayer, and login files are byte-identical to the starting commit. Built phone-DsagajMR.js and call-controller-BAf8MI55.js remain unchanged. The built app contains no chat/camera widgets or their polling action names.

Publication is pending. Automatic approval rejected the source upload to the existing public GitHub repository. The connected Bolt editor automatically syncs source to that repository, so editing there is not an alternative around that restriction. A later database read was not executed because the approval service reported a usage limit. No production changes were made during this work.

Before publication: obtain explicit owner approval for the public source update, ensure approval service availability, verify the current frontend has not changed, apply only these frontend files, run the existing gates, then publish through Bolt. Do not deploy backend functions or activate calling.
