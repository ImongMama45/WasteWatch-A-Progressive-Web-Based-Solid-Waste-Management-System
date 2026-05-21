/**
 * pages/About.jsx
 * ----------------
 * Offline-first About page for WasteWatch — Lucena City CENRO.
 * Matches the existing ld-root light-mode design system exactly.
 *
 * Imports:
 *   import '../../styles/pages/About.css'
 *
 * Route: /about
 * No data fetching — fully static, works offline.
 */

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Navbar from '../components/Navbar'
import BottomNav from '../components/BottomNav'
import '../styles/pages/About.css'

// ─── Material Symbols Outlined Icons ──────────────────────────────────────────

const MaterialIcon = ({ name }) => (
    <span className="material-symbols-outlined" style={{ fontSize: 'inherit', verticalAlign: 'middle' }}>
        {name}
    </span>
);

const I = {
    Map: () => <MaterialIcon name="map" />,
    Truck: () => <MaterialIcon name="local_shipping" />,
    Calendar: () => <MaterialIcon name="calendar_month" />,
    Bell: () => <MaterialIcon name="notifications" />,
    Shield: () => <MaterialIcon name="shield" />,
    Users: () => <MaterialIcon name="group" />,
    Settings: () => <MaterialIcon name="settings" />,
    Route: () => <MaterialIcon name="route" />,
    BarChart: () => <MaterialIcon name="bar_chart" />,
    Eye: () => <MaterialIcon name="visibility" />,
    Smartphone: () => <MaterialIcon name="smartphone" />,
    Layers: () => <MaterialIcon name="layers" />,
    Globe: () => <MaterialIcon name="public" />,
    CheckCircle: () => <MaterialIcon name="check_circle" />,
    ClipboardList: () => <MaterialIcon name="assignment" />,
    Activity: () => <MaterialIcon name="monitoring" />,
    Wifi: () => <MaterialIcon name="wifi" />,
    WifiOff: () => <MaterialIcon name="wifi_off" />,
    Database: () => <MaterialIcon name="database" />,
    ChevronDown: () => <MaterialIcon name="expand_more" />,
    ArrowRight: () => <MaterialIcon name="arrow_forward" />,
    Star: () => <MaterialIcon name="star" />,
    Cpu: () => <MaterialIcon name="memory" />,
}

// ─── Data ─────────────────────────────────────────────────────────────────────

const WORKFLOW_STEPS = [
    { icon: 'ClipboardList', color: 'green', label: 'Schedule Planning', desc: 'CENRO staff create weekly and monthly collection schedules per barangay zone.' },
    { icon: 'Route', color: 'blue', label: 'Route Assignment', desc: 'Optimised routes are assigned to specific drivers and collection trucks.' },
    { icon: 'Truck', color: 'amber', label: 'Driver Deployment', desc: 'Drivers receive their daily route instructions through the Driver Operations Module.' },
    { icon: 'Activity', color: 'green', label: 'Collection Monitoring', desc: 'Real-time progress is tracked via GIS. Admins monitor coverage and completion.' },
    { icon: 'Bell', color: 'blue', label: 'Public Notifications', desc: 'Citizens receive schedule updates and alerts through the Public Dashboard.' },
    { icon: 'CheckCircle', color: 'amber', label: 'Completion Reports', desc: 'Drivers submit collection confirmation. Data feeds into the analytics dashboard.' },
    { icon: 'BarChart', color: 'green', label: 'Administrative Review', desc: 'Admins analyse performance, identify missed pickups, and refine future schedules.' },
]

const CITIZEN_FEATURES = [
    { icon: 'Calendar', color: 'green', title: 'Collection Schedule Viewer', desc: 'Check exact pickup days and times for your barangay — updated in real time.' },
    { icon: 'Bell', color: 'blue', title: 'Public Announcements', desc: 'Stay informed on service changes, cancelled routes, and CENRO advisories.' },
    { icon: 'Map', color: 'amber', title: 'Barangay Zone Updates', desc: "Know which zones are being serviced today and what's scheduled next." },
    { icon: 'Eye', color: 'green', title: 'Route Transparency', desc: 'View active collection routes on the live GIS map at any time.' },
    { icon: 'Activity', color: 'blue', title: 'Collection Status', desc: "See whether today's pickup has been completed, is in progress, or missed." },
    { icon: 'Smartphone', color: 'amber', title: 'Offline Access', desc: 'All schedule and announcement data is cached — accessible without internet.' },
    { icon: 'Globe', color: 'green', title: 'Environmental Awareness', desc: 'Understand collection frequency, waste volumes, and environmental context.' },
    { icon: 'Users', color: 'blue', title: 'Community Awareness', desc: 'Participate in a smarter, more transparent public waste management system.' },
]

const MODULES = [
    { icon: 'Globe', color: 'green', title: 'Public Dashboard', desc: 'Citizen-facing portal for schedules, announcements, and waste reporting.' },
    { icon: 'Settings', color: 'blue', title: 'Admin Management', desc: 'Full control over routes, drivers, schedules, and operational data.' },
    { icon: 'Truck', color: 'amber', title: 'Driver Operations', desc: 'Mobile-ready module for daily route guidance and collection confirmation.' },
    { icon: 'Route', color: 'green', title: 'Route Monitoring', desc: 'Live tracking and status of every active collection route.' },
    { icon: 'Map', color: 'blue', title: 'GIS Monitoring', desc: 'Geospatial overlay of collection zones, hotspots, and truck positions.' },
    { icon: 'Bell', color: 'amber', title: 'Announcement System', desc: 'Targeted public announcements pushed through the citizen dashboard.' },
    { icon: 'BarChart', color: 'green', title: 'Collection Analytics', desc: 'Performance metrics, completion rates, and trend dashboards for admins.' },
]

const STATS = [
    { value: '33', label: 'Barangays Covered' },
    { value: '12', label: 'Collection Routes' },
    { value: '8', label: 'Registered Drivers' },
    { value: '240+', label: 'Collection Operations' },
    { value: '50+', label: 'Public Announcements' },
]

const TRANSPARENCY_POINTS = [
    { icon: 'Eye', color: 'green', title: 'Public Schedule Visibility', desc: 'Every citizen can view the current and upcoming collection schedule for their zone — no phone calls required.' },
    { icon: 'Route', color: 'blue', title: 'Route Monitoring', desc: 'Active collection routes are visible on the GIS map so the public knows where trucks are operating.' },
    { icon: 'Activity', color: 'amber', title: 'Live Status Updates', desc: 'Collection status — in-progress, completed, or missed — is updated in near real-time.' },
    { icon: 'Shield', color: 'green', title: 'Administrative Oversight', desc: 'Every operation is logged and auditable, ensuring accountability at every level.' },
]

const FAQS = [
    {
        q: 'How do I check my barangay\'s collection schedule?',
        a: 'Open the Public Dashboard and tap "Collection Schedule". Select your barangay from the zone selector to see your weekly pickup days and times.'
    },
    {
        q: 'How are public announcements updated?',
        a: 'CENRO administrators publish announcements directly through the Admin Management System. They appear instantly on the Public Dashboard and are cached offline.'
    },
    {
        q: 'Can collection routes change?',
        a: 'Yes. Routes may change due to road conditions, vehicle availability, or special events. Changes are announced via the Public Announcements section.'
    },
    {
        q: 'How does the monitoring system work?',
        a: 'Drivers confirm collection completion through the Driver Operations Module. This updates the GIS map and the collection status visible to citizens and admins.'
    },
    {
        q: 'Who manages the platform?',
        a: 'The City Environment and Natural Resources Office (CENRO) of Lucena City oversees the platform. The system was developed as a capstone project by BS IT students of CSTC.'
    },
    {
        q: 'How are drivers assigned to routes?',
        a: 'Administrators assign drivers to specific routes through the Admin Management System. Drivers receive their assignments in the Driver Operations Module.'
    },
]

// ─── Sub-components ───────────────────────────────────────────────────────────

function Eyebrow({ children }) {
    return (
        <div className="ab-eyebrow">
            <span className="ab-eyebrow__dot" />
            {children}
        </div>
    )
}

function SectionHead({ eyebrow, title, sub, center }) {
    return (
        <div className={`ab-section-head${center ? ' ab-section-head--center' : ''}`}>
            <Eyebrow>{eyebrow}</Eyebrow>
            <h2 className="ab-section-title">{title}</h2>
            {sub && <p className="ab-section-sub">{sub}</p>}
        </div>
    )
}

function IconBox({ name, color }) {
    const Tag = I[name] || I.Settings
    return (
        <div className={`ab-icon-box ab-icon-box--${color}`}>
            <Tag />
        </div>
    )
}

function FeatureCard({ icon, color, title, desc }) {
    return (
        <div className="ab-feature-card">
            <IconBox name={icon} color={color} />
            <div className="ab-feature-card__title">{title}</div>
            <p className="ab-feature-card__desc">{desc}</p>
        </div>
    )
}

function ModuleCard({ icon, color, title, desc }) {
    return (
        <div className="ab-module-card">
            <IconBox name={icon} color={color} />
            <div className="ab-module-card__title">{title}</div>
            <p className="ab-module-card__desc">{desc}</p>
        </div>
    )
}

function StatCard({ value, label }) {
    return (
        <div className="ab-stat-card">
            <div className="ab-stat-card__value">{value}</div>
            <div className="ab-stat-card__label">{label}</div>
        </div>
    )
}

function FaqItem({ q, a }) {
    const [open, setOpen] = useState(false)
    return (
        <div className={`ab-faq-item${open ? ' ab-faq-item--open' : ''}`}>
            <button className="ab-faq-q" onClick={() => setOpen(o => !o)} aria-expanded={open}>
                <span>{q}</span>
                <span className={`ab-faq-chevron${open ? ' ab-faq-chevron--open' : ''}`}>
                    <I.ChevronDown />
                </span>
            </button>
            <div className="ab-faq-body" aria-hidden={!open}>
                <p>{a}</p>
            </div>
        </div>
    )
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function AboutPage() {
    const navigate = useNavigate()

    return (
        <div className="ld-root ab-root">
            <Navbar />

            {/* ════════ HERO ════════ */}
            <section className="ab-hero">
                {/* Animated background grid */}
                <div className="ab-hero__grid" aria-hidden="true">
                    {Array.from({ length: 30 }).map((_, i) => (
                        <div key={i} className="ab-hero__grid-cell" />
                    ))}
                </div>

                {/* Floating route lines (decorative) */}
                <svg className="ab-hero__lines" aria-hidden="true" viewBox="0 0 900 500" preserveAspectRatio="none">
                    <path className="ab-route-line ab-route-line--1" d="M0,250 Q200,100 450,250 Q700,400 900,250" />
                    <path className="ab-route-line ab-route-line--2" d="M0,350 Q300,150 600,300 Q750,380 900,200" />
                    <path className="ab-route-line ab-route-line--3" d="M100,0 Q300,200 200,400 Q100,480 300,500" />
                    <circle className="ab-route-dot ab-route-dot--1" r="6" />
                    <circle className="ab-route-dot ab-route-dot--2" r="5" />
                    <circle className="ab-route-dot ab-route-dot--3" r="4" />
                </svg>

                <div className="ab-hero__inner">
                    <Eyebrow>Lucena City · CENRO · Capstone System</Eyebrow>
                    <h1 className="ab-hero__heading">
                        Smarter Waste Collection<br />
                        <em>for Lucena City</em>
                    </h1>
                    <p className="ab-hero__sub">
                        A public waste collection monitoring and scheduling platform designed to improve
                        collection efficiency, operational transparency, and citizen awareness across all
                        33 barangays of Lucena City.
                    </p>
                    <div className="ab-hero__actions">
                        <button className="ld-btn ld-btn--primary" onClick={() => navigate('/schedule')}>
                            <I.Calendar /> View Collection Schedule
                        </button>
                        <button className="ld-btn ld-btn--outline" onClick={() => navigate('/announcements')}>
                            <I.Bell /> Public Announcements
                        </button>
                    </div>

                    {/* Offline badge */}
                    <div className="ab-hero__offline-badge">
                        <I.WifiOff />
                        <span>Works Offline · PWA</span>
                    </div>
                </div>
            </section>

            {/* ════════ ABOUT THE SYSTEM ════════ */}
            <section className="ab-section ab-section--light">
                <div className="ab-container">
                    <div className="ab-split">
                        {/* Left — text */}
                        <div className="ab-split__text">
                            <SectionHead
                                eyebrow="About the System"
                                title="What is WasteWatch?"
                                sub="WasteWatch is a civic-tech platform developed to digitise and streamline
                solid waste collection management in Lucena City. Built as a capstone project
                by BS Information Technology students, it bridges the gap between CENRO
                operations and public awareness."
                            />
                            <div className="ab-checklist">
                                {[
                                    'Real-time collection schedule visibility for all 33 barangays',
                                    'GIS-based route monitoring for administrators',
                                    'Driver operations module for field coordination',
                                    'Offline-first PWA — works without internet',
                                    'Public announcements and service advisories',
                                    'Citizen waste reporting with GPS tagging',
                                ].map((item, i) => (
                                    <div key={i} className="ab-checklist__item">
                                        <div className="ab-checklist__icon"><I.CheckCircle /></div>
                                        <span>{item}</span>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Right — info cards */}
                        <div className="ab-split__cards">
                            <div className="ab-info-card ab-info-card--green">
                                <div className="ab-info-card__icon"><I.Users /></div>
                                <div className="ab-info-card__title">For Citizens</div>
                                <p className="ab-info-card__desc">
                                    View schedules, track announcements, stay informed about collection operations,
                                    and submit waste problem reports — online or offline.
                                </p>
                            </div>
                            <div className="ab-info-card ab-info-card--blue">
                                <div className="ab-info-card__icon"><I.Settings /></div>
                                <div className="ab-info-card__title">For Administrators</div>
                                <p className="ab-info-card__desc">
                                    Manage routes, coordinate drivers, monitor operations in real time, and
                                    publish public announcements through the Admin Management System.
                                </p>
                            </div>
                            <div className="ab-info-card ab-info-card--amber">
                                <div className="ab-info-card__icon"><I.Truck /></div>
                                <div className="ab-info-card__title">For Drivers</div>
                                <p className="ab-info-card__desc">
                                    Receive daily route assignments, navigate collection zones, and confirm
                                    pickups through the mobile-ready Driver Operations Module.
                                </p>
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            {/* ════════ SYSTEM WORKFLOW ════════ */}
            <section className="ab-section ab-section--tinted">
                <div className="ab-container">
                    <SectionHead
                        eyebrow="System Workflow"
                        title="How the System Operates"
                        sub="From schedule planning to collection confirmation — every step is tracked, coordinated, and made visible to the public."
                        center
                    />
                    <div className="ab-timeline">
                        {WORKFLOW_STEPS.map((step, i) => (
                            <div key={i} className="ab-timeline__item">
                                <div className="ab-timeline__left">
                                    <div className={`ab-timeline__step-num ab-timeline__step-num--${step.color}`}>
                                        {String(i + 1).padStart(2, '0')}
                                    </div>
                                    {i < WORKFLOW_STEPS.length - 1 && <div className="ab-timeline__connector" />}
                                </div>
                                <div className="ab-timeline__card">
                                    <IconBox name={step.icon} color={step.color} />
                                    <div>
                                        <div className="ab-timeline__card-title">{step.label}</div>
                                        <p className="ab-timeline__card-desc">{step.desc}</p>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* ════════ CITIZEN FEATURES ════════ */}
            <section className="ab-section ab-section--light">
                <div className="ab-container">
                    <SectionHead
                        eyebrow="Citizen Features"
                        title="What Citizens Can Access"
                        sub="The Public Dashboard gives every Lucena City resident direct visibility into waste collection operations."
                        center
                    />
                    <div className="ab-features-grid">
                        {CITIZEN_FEATURES.map((f, i) => (
                            <FeatureCard key={i} {...f} />
                        ))}
                    </div>
                </div>
            </section>

            {/* ════════ OPERATIONAL TRANSPARENCY ════════ */}
            <section className="ab-section ab-section--green">
                <div className="ab-container">
                    <div className="ab-transp-inner">
                        <div className="ab-transp__left">
                            <SectionHead
                                eyebrow="Operational Transparency"
                                title="Open by Design"
                                sub="WasteWatch was built on the principle that citizens deserve visibility into public services.
                Every collection operation is trackable, every schedule is public, and every
                announcement is accessible — even offline."
                            />
                            <button className="ld-btn ld-btn--primary" onClick={() => navigate('/')}>
                                Explore the Dashboard <I.ArrowRight />
                            </button>
                        </div>
                        <div className="ab-transp__cards">
                            {TRANSPARENCY_POINTS.map((p, i) => (
                                <div key={i} className="ab-transp-card">
                                    <IconBox name={p.icon} color={p.color} />
                                    <div>
                                        <div className="ab-transp-card__title">{p.title}</div>
                                        <p className="ab-transp-card__desc">{p.desc}</p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </section>

            {/* ════════ SMART CITY / CAPSTONE ════════ */}
            <section className="ab-section ab-section--tinted">
                <div className="ab-container">
                    <div className="ab-capstone">
                        <div className="ab-capstone__badge">
                            <I.Star />
                            <span>BS Information Technology · CSTC · 2026</span>
                        </div>
                        <h2 className="ab-capstone__heading">
                            A Capstone System Built for Public Service
                        </h2>
                        <p className="ab-capstone__sub">
                            WasteWatch was developed as a capstone system to apply modern technology — GIS mapping, machine learning insights,
                            and Progressive Web App architecture — to a real civic challenge: making waste collection management
                            in Lucena City more efficient, transparent, and citizen-centred.
                        </p>
                        <div className="ab-capstone__tech-row">
                            {[
                                { icon: 'Globe', label: 'PWA', sub: 'Offline-first' },
                                { icon: 'Map', label: 'GIS', sub: 'Live mapping' },
                                { icon: 'Cpu', label: 'ML Insights', sub: 'Predictive data' },
                                { icon: 'Database', label: 'REST API', sub: 'Django backend' },
                                { icon: 'Layers', label: 'React', sub: 'Vite frontend' },
                            ].map((t, i) => {
                                const Tag = I[t.icon] || I.Globe
                                return (
                                    <div key={i} className="ab-tech-chip">
                                        <div className="ab-tech-chip__icon"><Tag /></div>
                                        <div className="ab-tech-chip__label">{t.label}</div>
                                        <div className="ab-tech-chip__sub">{t.sub}</div>
                                    </div>
                                )
                            })}
                        </div>
                    </div>
                </div>
            </section>

            {/* ════════ SYSTEM MODULES ════════ */}
            <section className="ab-section ab-section--light">
                <div className="ab-container">
                    <SectionHead
                        eyebrow="System Modules"
                        title="Platform Components"
                        sub="WasteWatch is composed of seven interconnected modules that cover every aspect of waste collection management."
                        center
                    />
                    <div className="ab-modules-grid">
                        {MODULES.map((m, i) => (
                            <ModuleCard key={i} {...m} />
                        ))}
                    </div>
                </div>
            </section>

            {/* ════════ COMMUNITY IMPACT STATS ════════ */}
            <section className="ab-section ab-stats-section">
                <div className="ab-container">
                    <SectionHead
                        eyebrow="Community Impact"
                        title="Platform at a Glance"
                        center
                    />
                    <div className="ab-stats-grid">
                        {STATS.map((s, i) => (
                            <StatCard key={i} {...s} />
                        ))}
                    </div>
                </div>
            </section>

            {/* ════════ FAQ ════════ */}
            <section className="ab-section ab-section--tinted">
                <div className="ab-container ab-container--narrow">
                    <SectionHead
                        eyebrow="Frequently Asked Questions"
                        title="Common Questions"
                        center
                    />
                    <div className="ab-faq-list">
                        {FAQS.map((faq, i) => (
                            <FaqItem key={i} {...faq} />
                        ))}
                    </div>
                </div>
            </section>

            {/* ════════ FINAL CTA ════════ */}
            <section className="ab-cta">
                {/* Grid overlay */}
                <div className="ab-cta__grid" aria-hidden="true">
                    {Array.from({ length: 20 }).map((_, i) => (
                        <div key={i} className="ab-cta__grid-cell" />
                    ))}
                </div>

                <div className="ab-cta__inner">
                    <Eyebrow>Get Started</Eyebrow>
                    <h2 className="ab-cta__heading">
                        Improving Public Waste Collection<br />
                        <em>Through Technology</em>
                    </h2>
                    <p className="ab-cta__sub">
                        Join thousands of Lucena City residents and CENRO staff using WasteWatch
                        to make waste collection more efficient and transparent.
                    </p>
                    <div className="ab-cta__actions">
                        <button className="ld-btn ld-btn--primary" onClick={() => navigate('/')}>
                            Explore Dashboard <I.ArrowRight />
                        </button>
                        <button className="ld-btn ld-btn--outline" onClick={() => navigate('/schedule')}>
                            <I.Calendar /> View Collection Schedule
                        </button>
                    </div>
                </div>
            </section>

            {/* ════════ FOOTER ════════ */}
            <footer className="ld-footer">
                <div className="ld-footer__inner">
                    <div>
                        <div className="ld-footer__brand">
                            <span className="logo">
                                <img src="../../../Logo.svg" alt="WasteWatch" />
                            </span>
                        </div>
                        <p className="ld-footer__tagline">
                            Smart waste management para sa mas malinis na Lucena City — powered by GIS, ML & PWA.
                        </p>
                    </div>
                    <div className="ld-footer__col">
                        <h4 className="ld-footer__col-title">Platform</h4>
                        <a href="#" onClick={e => { e.preventDefault(); navigate('/about') }}>About</a>
                        <a href="#">FAQ</a>
                        <a href="#">Guidelines</a>
                    </div>
                    <div className="ld-footer__col">
                        <h4 className="ld-footer__col-title">Features</h4>
                        <a href="#" onClick={e => { e.preventDefault(); navigate('/map') }}>GIS Map</a>
                        <a href="#" onClick={e => { e.preventDefault(); navigate('/schedule') }}>Schedule</a>
                        <a href="#" onClick={e => { e.preventDefault(); navigate('/announcements') }}>Announcements</a>
                    </div>
                    <div className="ld-footer__col">
                        <h4 className="ld-footer__col-title">Contact</h4>
                        <a href="tel:042-710-4311">(042) 710 4311</a>
                        <a href="mailto:cenro@lucenacity.gov.ph">cenro@lucenacity.gov.ph</a>
                        <a href="#">City Hall, Lucena</a>
                    </div>
                </div>
                <div className="ld-footer__bottom">
                    <p className="ld-footer__copy">
                        © 2026 BS Information Technology — CSTC · Capstone Project · Lucena City
                    </p>
                    <p className="ld-footer__contact">WasteWatch · Lucena City CENRO</p>
                </div>
            </footer>

            <BottomNav />
        </div>
    )
}