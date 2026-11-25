import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const srcRoot = path.resolve(__dirname, '../../../')

test('DumpsiteDashboard.jsx restricts Log Arrival quick action to Dumpsite Operators only', () => {
  const file = path.join(srcRoot, 'pages/dashboard/DumpsiteDashboard.jsx')
  const content = fs.readFileSync(file, 'utf8')

  assert.ok(
    content.includes("isOperator = Boolean(user?.role === 'dumpsite' && !isAdmin)"),
    'DumpsiteDashboard must compute isOperator requiring role dumpsite and not admin'
  )
  assert.ok(
    content.includes('{isOperator && (') && content.includes('<PlusSquare size={15} /> Log Arrival'),
    'DumpsiteDashboard must conditionally render Log Arrival only when isOperator is true'
  )
  assert.ok(
    content.includes('onLogArrival={isOperator ?'),
    'LiveTrackerCard onLogArrival callback must be restricted to isOperator'
  )
})

test('ArrivalLogger.jsx guards submission and renders operator-only indicator for Admins', () => {
  const file = path.join(srcRoot, 'pages/dumpsite/ArrivalLogger.jsx')
  const content = fs.readFileSync(file, 'utf8')

  assert.ok(
    content.includes("isOperator = Boolean(user?.role === 'dumpsite' && !user?.is_staff)"),
    'ArrivalLogger must compute isOperator requiring role dumpsite and not staff'
  )
  assert.ok(
    content.includes('if (!isOperator)'),
    'ArrivalLogger handleSubmit must reject submission when user is not an operator'
  )
  assert.ok(
    content.includes('Arrival logging is strictly reserved for on-site Dumpsite Operators'),
    'ArrivalLogger must display warning banner when non-operator accesses the modal'
  )
  assert.ok(
    content.includes('disabled={submitting || !isOperator}'),
    'ArrivalLogger submit button must be disabled when user is not an operator'
  )
})

test('CollectionLogs.jsx and TruckQueue.jsx hide or disable arrival logging for Admins', () => {
  const colFile = path.join(srcRoot, 'pages/dumpsite/CollectionLogs.jsx')
  const colContent = fs.readFileSync(colFile, 'utf8')
  assert.ok(
    colContent.includes('{isOperator && (') && colContent.includes('Log Truck Arrival'),
    'CollectionLogs must only render Log Truck Arrival button for isOperator'
  )

  const queueFile = path.join(srcRoot, 'pages/dumpsite/TruckQueue.jsx')
  const queueContent = fs.readFileSync(queueFile, 'utf8')
  assert.ok(
    queueContent.includes('{isOperator ? (') && queueContent.includes('Operator Action Only'),
    'TruckQueue must show Operator Action Only when user is not an operator'
  )
})

test('App.jsx restricts /dumpsite/log-arrival route strictly to dumpsite role', () => {
  const appFile = path.join(srcRoot, 'App.jsx')
  const appContent = fs.readFileSync(appFile, 'utf8')

  assert.ok(
    /<Route\s+path="\/dumpsite\/log-arrival"\s+element=\{\s*<PrivateRoute\s+roles=\{\['dumpsite'\]\}>/.test(appContent),
    'App.jsx /dumpsite/log-arrival route must require role dumpsite without admin'
  )
})

test('Modified dumpsite files strictly contain zero emojis', () => {
  const emojiRegex = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u
  const filesToCheck = [
    path.join(srcRoot, 'pages/dashboard/DumpsiteDashboard.jsx'),
    path.join(srcRoot, 'pages/dumpsite/ArrivalLogger.jsx'),
    path.join(srcRoot, 'pages/dumpsite/CollectionLogs.jsx'),
    path.join(srcRoot, 'pages/dumpsite/TruckQueue.jsx'),
    path.join(srcRoot, 'App.jsx'),
    path.resolve(srcRoot, '../../backend/dumpsite/permissions.py'),
    path.resolve(srcRoot, '../../backend/dumpsite/views.py'),
    path.resolve(srcRoot, '../../backend/dumpsite/tests_facility_operations.py'),
  ]

  for (const f of filesToCheck) {
    const text = fs.readFileSync(f, 'utf8')
    assert.strictEqual(
      emojiRegex.test(text),
      false,
      `Emoji violation detected in ${path.basename(f)}`
    )
  }
})
