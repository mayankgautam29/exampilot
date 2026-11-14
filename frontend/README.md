# ExamPilot web

Next.js App Router, strict TypeScript, Tailwind, shadcn/ui, Recharts, framer-motion, TanStack Query, zustand, cmdk, dnd-kit.

```bash
npm install
NEXT_PUBLIC_API_URL=http://localhost:8000 npm run dev
```

`NEXT_PUBLIC_API_URL` is the only setting and defaults to `http://localhost:8000`. It is read at build time. The browser talks to the API directly, including server-sent events; there are no Next.js API routes and no secrets here.

Pages: `/login`, `/admin` (Command Center), `/admin/copilot`, `/admin/timetable`, `/admin/seating`, `/admin/invigilation`, `/admin/scenarios`, `/admin/approvals`, `/admin/disruptions`, `/admin/regulations`, `/admin/audit`, `/admin/benchmark`, `/admin/outbox`, `/student`, `/faculty`, `/verify/[token]`.

`lib/api-types.ts` is generated from `docs/openapi.json` (`make openapi`).
