# AI context persistence and token recovery

Source: [Claude Chat](https://claude.ai/chat/c0a8e3cd-1640-46d0-a11c-870cb139548b)
Extracted: 2026-05-12T13:45:05.957Z
🚀 Exported with [Save my Chatbot](https://save.hugocolin.com)!

---

## User

==================================================== AI CONTEXT PERSISTENCE & TOKEN RECOVERY
This project is extremely large and modular.
If token/context limits are reached at any point during generation, the AI MUST:

Automatically generate a CONTEXT RECOVERY MARKDOWN FILE (`PROJECT_CONTEXT.md`)
The markdown file must contain:1. Current completed modules
2. Remaining modules
3. Database schema progress
4. API endpoints completed
5. Frontend pages completed
6. Backend services completed
7. Current architecture decisions
8. Folder structures
9. State management structure
10. Environment variables
11. Dependencies installed
12. Naming conventions
13. Pending tasks
14. Current implementation phase
15. Important system relationships
16. Realtime/WebSocket progress
17. Tracking SDK progress
18. The AI must summarize:
19. What has already been generated
20. What still needs to be generated
21. Current application flow
22. Existing API contracts
23. Existing component relationships
24. Existing database relationships
25. The AI must structure the recovery file so another AI session can CONTINUE the project seamlessly without re-explaining the system.
26. The AI must periodically maintain:
27. `/docs/PROJECT_CONTEXT.md`
28. `/docs/API_PROGRESS.md`
29. `/docs/ARCHITECTURE_NOTES.md`
30. `/docs/TODO.md`
31. Every generated module must update the context documentation automatically.
32. The AI must NEVER lose architectural continuity between generations.
If generation stops unexpectedly, the latest markdown context files must contain enough information to resume development immediately.
==================================================== OUTPUT CONTINUITY RULES
Before ending any response due to token limits:33. Summarize completed work
34. Summarize pending work
35. Generate updated context markdown
Provide continuation instructions for the next session
The AI must treat the markdown context files as persistent memory for the entire project lifecycle.

##### Inputs:
- pasted

## Claude

Check available skills

Check available skills

Given the enormous scope of this project, I'll generate a **complete, production-ready implementation** — starting with the full architecture, then core backend, then frontend. I'll create actual files and produce a React dashboard artifact as the centerpiece UI.

Let me build this systematically:

Created 7 files, ran a command

Created 7 files, ran a command

Create project directory structure

bash

mkdir -p /home/claude/analytics-platform/{backend,frontend,docs,docker,scripts} && \
mkdir -p /home/claude/analytics-platform/backend/{analytics_platform,accounts,websites,analytics,tracking,events,sessions,reports,notifications,realtime,common} && \
mkdir -p /home/claude/analytics-platform/backend/analytics_platform && \
mkdir -p /home/claude/analytics-platform/frontend/src/{components,pages,hooks,store,services,utils,types} && \
mkdir -p /home/claude/analytics-platform/frontend/src/components/{charts,layout,ui,realtime,analytics} && \
mkdir -p /home/claude/analytics-platform/frontend/src/pages/{auth,dashboard} && \
echo "Structure created"

Output

Structure created

Django main settings file

settings.py

Django URL configuration

urls.py

ASGI configuration for Django Channels WebSocket support

asgi.py

Custom User model for accounts app

models.py

Websites app models - tracking IDs and site management

models.py

Analytics core models - visitors, sessions, pageviews, events

models.py

Tracking app - data ingestion endpoint and bot filtering

views.py

Done

