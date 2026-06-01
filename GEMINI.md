# WasteWatch 🗑️

WasteWatch is a Progressive Web-Based Solid Waste Management System tailored for Lucena City. It features hotspot mapping, truck tracking, and route optimization.

## Project Overview

- **Architecture:** Decoupled architecture with a Django REST backend and a React (Vite) frontend.
- **Backend:** Django 4.2+, PostgreSQL (or SQLite for development).
- **Frontend:** React 18.3+ with Vite, React Router 6, and Axios for API communication.
- **Key Features:**
    - Role-based access control (Citizen, Watcher, Driver, Barangay Official, Admin).
    - Waste reporting with image uploads.
    - Collection confirmation.
    - Public announcements and statistics.
    - (Future) Hotspot mapping and truck tracking.

## Directory Structure

```text
wastewatch/
├── backend/                    # Django project root
│   ├── accounts/               # User and Barangay management
│   ├── driver/                 # Truck and route management (in development)
│   ├── watcher/                # Waste reporting and collection confirmation
│   ├── wastewatch/             # Project settings and root URLs
│   ├── manage.py               # Django CLI
│   └── requirements.txt        # Backend dependencies
└── frontend/                   # React Vite project root
    ├── src/                    # Frontend source code
    ├── public/                 # Static assets
    ├── package.json            # Frontend dependencies and scripts
    └── vite.config.js          # Vite configuration and API proxying
```

## Getting Started

### Prerequisites
- Python 3.11+
- Node.js 18+
- PostgreSQL 14+ (Optional for local dev, uses SQLite by default)

### Backend Setup
1.  Navigate to `wastewatch/backend`.
2.  Create and activate a virtual environment:
    ```bash
    python -m venv venv
    .\venv\Scripts\activate  # Windows
    source venv/bin/activate # Unix/macOS
    ```
3.  Install dependencies:
    ```bash
    pip install -r requirements.txt
    ```
4.  Run migrations:
    ```bash
    python manage.py migrate
    ```
5.  (Optional) Seed barangay data:
    ```bash
    python manage.py shell -c "from accounts.models import Barangay; [Barangay.objects.get_or_create(name=n) for n in ['Isabang', 'Gulang-Gulang', 'Ilayang Dupay', 'Kanlurang Mayao', 'Market View', 'Ibabang Dupay']]"
    ```
6.  Start the development server:
    ```bash
    python manage.py runserver
    ```

### Frontend Setup
1.  Navigate to `wastewatch/frontend`.
2.  Install dependencies:
    ```bash
    npm install
    ```
3.  Start the development server:
    ```bash
    npm run dev
    ```
    The frontend will be available at `http://localhost:3000`.

## Development Conventions

- **API Communication:** Use the Axios client in `frontend/src/api/client.js`. It is pre-configured with CSRF and session support.
- **Proxying:** The Vite dev server proxies requests starting with `/api`, `/accounts`, `/watcher`, and `/media` to the Django backend at `http://127.0.0.1:8000`.
- **User Roles:**
    - `citizen`: Default role, can view public data.
    - `watcher`: Can submit reports and confirm collections.
    - `driver`: *(Future)* Will view assigned routes.
    - `brgy_official`: *(Future)* Will approve/reject reports.
    - `admin`: Full system access via `/admin/`.
- **Database:** Development uses SQLite by default. For production or advanced local testing, use PostgreSQL as described in `wastewatch/README.md`.
- **Media:** Uploaded images are stored in `wastewatch/backend/media`. This directory should be excluded from version control in production.

## Commands Reference

| Action | Command | Directory |
| :--- | :--- | :--- |
| Run Backend | `python manage.py runserver` | `wastewatch/backend` |
| Make Migrations | `python manage.py makemigrations` | `wastewatch/backend` |
| Migrate DB | `python manage.py migrate` | `wastewatch/backend` |
| Create Admin | `python manage.py createsuperuser` | `wastewatch/backend` |
| Run Frontend | `npm run dev` | `wastewatch/frontend` |
| Build Frontend | `npm run build` | `wastewatch/frontend` |
| Lint Frontend | `npm run lint` | `wastewatch/frontend` |
