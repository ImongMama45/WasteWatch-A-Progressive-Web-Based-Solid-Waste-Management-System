import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const FRONTEND_SRC = path.resolve(__dirname, '..', '..', '..')
const REPO_ROOT = path.resolve(FRONTEND_SRC, '..', '..')

const EMOJI_REGEX =
  /[\u{1F300}-\u{1F9FF}\u{1FA00}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u

test('Stage 5B modified frontend and backend files contain zero emojis', () => {
  const filesToCheck = [
    path.join(FRONTEND_SRC, 'api', 'driverWorkflowApi.js'),
    path.join(FRONTEND_SRC, 'pages', 'Profile.jsx'),
    path.join(FRONTEND_SRC, 'pages', 'admin', 'TeamManagement.jsx'),
    path.join(FRONTEND_SRC, 'pages', 'admin', 'WorkerManagement.jsx'),
    path.join(FRONTEND_SRC, 'pages', 'dashboard', 'CitizenDashboard.jsx'),
    path.join(FRONTEND_SRC, 'pages', 'dashboard', 'DriverDashboard.jsx'),
    path.join(REPO_ROOT, 'backend', 'driver', 'shift_service.py'),
    path.join(REPO_ROOT, 'backend', 'driver', 'serializers.py'),
    path.join(REPO_ROOT, 'backend', 'driver', 'urls.py'),
    path.join(REPO_ROOT, 'backend', 'driver', 'tests', 'test_stage5b_profile_attendance.py'),
  ]

  for (const filePath of filesToCheck) {
    const content = fs.readFileSync(filePath, 'utf8')
    const match = content.match(EMOJI_REGEX)
    assert.equal(
      match,
      null,
      `Found prohibited emoji character in ${path.relative(REPO_ROOT, filePath)}: ${match?.[0]}`
    )
  }
})

test('Profile.jsx removes hardcoded mocks and integrates getMyAttendanceHistory()', () => {
  const profileSrc = fs.readFileSync(path.join(FRONTEND_SRC, 'pages', 'Profile.jsx'), 'utf8')
  assert.equal(profileSrc.includes('MOCK_EXTRA_DATA'), false)
  assert.equal(profileSrc.includes('MOCK_ACTIVITIES'), false)
  assert.equal(profileSrc.includes('0912 345 6789'), false)
  assert.equal(profileSrc.includes('getMyAttendanceHistory'), true)
  assert.equal(profileSrc.includes('Municipal Sanitation Crew Member'), true)
  assert.equal(profileSrc.includes('Boolean(user?.is_staff)'), true)
})

test('TeamManagement.jsx removes invalid SUBSTITUTE correction option and includes CrewShifts', () => {
  const teamSrc = fs.readFileSync(
    path.join(FRONTEND_SRC, 'pages', 'admin', 'TeamManagement.jsx'),
    'utf8'
  )
  assert.equal(teamSrc.includes('<option value="SUBSTITUTE">'), false)
  assert.equal(teamSrc.includes('/api/driver/crew-shifts/'), true)
  assert.equal(teamSrc.includes('item.corrections.map'), true)
})

test('CitizenDashboard.jsx uses persisted personal attendance history without fabricating shift times', () => {
  const citizenSrc = fs.readFileSync(
    path.join(FRONTEND_SRC, 'pages', 'dashboard', 'CitizenDashboard.jsx'),
    'utf8'
  )
  assert.equal(citizenSrc.includes('/api/driver/shift/my-attendance-history/'), true)
  assert.equal(citizenSrc.includes('/api/driver/crew-assignments/my-assignment/'), false)
  assert.equal(citizenSrc.includes('View Full Attendance History'), true)
})
