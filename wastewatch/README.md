# 🗑️ WasteWatch

A role-based waste management system built with **Django + PostgreSQL** (backend) and **React Vite** (frontend).

---

## Project Structure

```
wastewatch/
├── backend/                    ← Django project
│   ├── manage.py
│   ├── requirements.txt
│   ├── media/                  ← Uploaded report images (gitignore this)
│   ├── wastewatch/             ← Django settings & root URLs
│   │   ├── settings.py
│   │   ├── urls.py
│   │   ├── api_urls.py         ← All /api/* JSON endpoints
│   │   └── wsgi.py
│   ├── accounts/               ← Custom User, Barangay, auth views
│   │   ├── models.py           ★ User + Barangay models
│   │   ├── forms.py            ★ Registration + Login forms
│   │   ├── views.py            ★ HTML template views (login, register)
│   │   ├── api_views.py        ★ JSON API views (for React)
│   │   ├── urls.py
│   │   └── admin.py
│   ├── watcher/                ← Watcher module (first feature)
│   │   ├── models.py           ★ GarbageReport + CollectionConfirmation
│   │   ├── forms.py
│   │   ├── views.py            ★ HTML template views
│   │   ├── api_views.py        ★ JSON API views (for React)
│   │   ├── urls.py
│   │   └── admin.py
│   └── templates/              ← Django HTML templates
│       ├── base.html
│       ├── accounts/
│       │   ├── login.html
│       │   └── register.html
│       └── watcher/
│           ├── dashboard.html
│           ├── report_form.html
│           ├── confirm_collection.html
│           └── report_detail.html
│
└── frontend/                   ← React Vite project
    ├── index.html
    ├── package.json
    ├── vite.config.js          ← Proxy: /api/* → Django :8000
    └── src/
        ├── main.jsx
        ├── App.jsx             ★ Router + AuthProvider
        ├── index.css           ★ Design system (CSS variables)
        ├── api/
        │   └── client.js       ★ Axios instance with CSRF + session
        ├── context/
        │   └── AuthContext.jsx ★ Login state shared across all pages
        ├── components/
        │   ├── Navbar.jsx
        │   └── PrivateRoute.jsx
        └── pages/
            ├── Login.jsx
            ├── Register.jsx
            ├── Dashboard.jsx   ★ Matches Home.png design
            └── ReportForm.jsx
```

---

## ⚙️ Setup Guide

### Prerequisites

- Python 3.11+
- Node.js 18+
- PostgreSQL 14+

---

### 1. PostgreSQL — Create Database

```sql
-- Run in psql as postgres superuser
CREATE DATABASE wastewatch_db;
CREATE USER wastewatch_user WITH PASSWORD 'your_password_here';
GRANT ALL PRIVILEGES ON DATABASE wastewatch_db TO wastewatch_user;
```

---

### 2. Django Backend

```bash
cd wastewatch/backend

# Create and activate virtual environment
python -m venv venv
source venv/bin/activate          # Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Update DB password in settings.py
# → DATABASES > PASSWORD = 'your_password_here'

# Run migrations (creates all tables)
python manage.py makemigrations accounts watcher
python manage.py migrate

# Create a superuser (for /admin/ panel)
python manage.py createsuperuser

# Seed some barangays (optional but useful for dropdowns)
python manage.py shell -c "
from accounts.models import Barangay
names = ['Isabang', 'Gulang-Gulang', 'Ilayang Dupay', 'Kanlurang Mayao', 'Market View', 'Ibabang Dupay']
for name in names:
    Barangay.objects.get_or_create(name=name)
print('Barangays created!')
"

# Start Django dev server
python manage.py runserver
# → http://localhost:8000
```

**Django is now running. Try:**
- `http://localhost:8000/admin/` — Django admin panel
- `http://localhost:8000/accounts/login/` — HTML login page

---

### 3. React Vite Frontend

```bash
cd wastewatch/frontend

# Install dependencies
npm install

# Start dev server
npm run dev
# → http://localhost:5173
```

The Vite dev server proxies all `/api/*` calls to Django at `:8000` automatically — no CORS issues.

---

## 🔑 User Roles

| Role                |               Access                |                    How to assign |
|------               |--------                             |                   ---------------|
| `citizen`           | Default for new registrations       |                        Automatic |
| `watcher`           | Submit reports, confirm collections | Admin panel → User → Change role |
| `driver`            | *(Future)* View assigned routes     | TBD |
| `barangay_official` | *(Future)* Approve/reject reports   | TBD |
| `admin`             | Full system access                  | Admin panel |

> **Important:** The role field is **hidden** from the public registration form. Only Django admin (`/admin/`) can change a user's role. This prevents self-promotion attacks.

---

## 📡 API Reference

All endpoints require a valid Django session cookie (set by `/api/auth/login/`).

### Auth

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET`  | `/api/auth/me/` | Get current user (also sets CSRF cookie) |
| `POST` | `/api/auth/login/` | `{ email, password }` → session + user JSON |
| `POST` | `/api/auth/logout/` | Destroy session |
| `POST` | `/api/auth/register/` | `{ full_name, email, password, password2, barangay? }` |
| `GET`  | `/api/barangays/` | List all barangays |

### Watcher

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET`  | `/api/watcher/reports/` | List my reports |
| `POST` | `/api/watcher/reports/` | Submit new report (multipart/form-data) |
| `GET`  | `/api/watcher/reports/<id>/` | Single report detail |
| `GET`  | `/api/watcher/stats/` | `{ total, pending_approval, resolved, rejected }` |
| `POST` | `/api/watcher/confirm/` | Confirm a truck collection |

---

## 🗺️ Future Roadmap

The project is structured so these can be added without breaking existing code:

```
Phase 2 — Driver Module
  → driver/models.py      (Truck, Route, Assignment)
  → driver/api_views.py   (route list, mark collected)
  → Add path('driver/...') to api_urls.py

Phase 3 — Barangay Official
  → Can approve/reject GarbageReports (just update status field)
  → Add permission check: @role_required('barangay_official')

Phase 4 — Map Integration
  → Replace map placeholder in Dashboard with Leaflet.js
  → Plot report lat/lng as markers colored by status

Phase 5 — Notifications
  → Add Notification model (FK to User + Report)
  → Trigger on status change via Django signals
```


---

## 🔒 Security Notes (for Production)

1. Change `SECRET_KEY` in settings.py to a strong random value
2. Set `DEBUG = False`
3. Use environment variables for DB credentials (use `python-decouple` or `django-environ`)
4. Add `ALLOWED_HOSTS = ['your-domain.com']`
5. Run `python manage.py collectstatic` and serve via Nginx
6. Use HTTPS — Django sessions use cookies which need Secure flag
