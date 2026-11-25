# WasteWatch -- Forecasting Stage 2.3: Artifact Governance Fail-Closed Remediation Report

**Project:** WasteWatch -- CENRO Lucena City Solid Waste Management System
**Author:** Lead Implementer
**Project Authority:** ChatGPT (Forecasting Technical Project Manager)
**Independent Technical Auditor:** Claude
**Stage:** 2.3 -- Targeted Governance Remediation
**Date:** 2026-11-10
**Branch / base commit:** `codex-refactored` at `7a07c08` (all Stage 2.3 changes are uncommitted working-tree changes)
**Status:** `READY FOR INDEPENDENT STAGE 2.3 AUDIT`
**Governance invariant:** `FORECAST_ML_ENABLED = False` ([`settings.py` line 293](file:///d:/Coding/Waste%20Watch/wastewatch/backend/wastewatch/settings.py#L293)). Production remains on the seasonal heuristic. No model trained, promoted, or enabled during this stage.

---

## 1. Executive Summary

Stage 2.3 hardens the shared artifact validator, the two loaders, and the rollback command so they fail closed. Two defects were discovered **during this stage's own verification** that were not in the original remediation plan; both are fixed and covered by tests (see Section 2, items S-1 and S-2):

- **S-1, cache keyed on model SHA only:** two artifacts with byte-identical model files (Ridge training is deterministic) but different metadata collided in the cache. A metadata change, including one that removed a mandatory field, could be served from a stale, previously validated cache entry. This made the candidate loader fail open in test 50 section I.
- **S-2, incomplete rollback recovery:** recovery restored only `active_manifest.json`, while the rollback had already overwritten `waste_forecast_model_latest.joblib` and `waste_forecast_metadata_latest.json`. If the prior manifest pointed at the `latest` files, a failed rollback left the manifest and the artifact bytes inconsistent. The existing recovery test (section N) failed at pre-validation and never reached the recovery handler, so it could not detect this.

Final result: **50 / 50 tests in `analytics.tests.test_forecasting` pass; `manage.py check` reports no issues.**

---

## 2. Claude Stage 2.2 Findings and Corresponding Corrections

| # | Finding | Correction | Evidence |
| :--- | :--- | :--- | :--- |
| A-1 | Permissive `is_promotion_eligible` check (`is not False`) | Key mandatory; must be `bool`; must be `True` when `require_promotion_eligible=True` | [`validate_forecaster_artifact`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/forecasting/service.py#L165-L400) lines 249-254; test 50 sections H, I.2 |
| A-2 | Missing `distinct_genuine_days` / `validation_status` not rejected | Both mandatory; strict types; `validation_status` in `{PASSED, FAILED, PENDING}` | lines 240-267; test 50 sections I.1, I.3 |
| A-3 | `synthetic_records` Boolean coercion (`False == 0`) | `bool` explicitly rejected before integer check | lines 231-238; test 50 section C, test 49 |
| A-4 | Record count vs distinct day count not cross-checked | If `genuine_records` present: must be non-Boolean int and `>= distinct_genuine_days` | lines 269-275; test 50 section I.4 |
| A-5 | No mechanism to verify provenance claims against the database | Added [`verify_artifact_database_provenance`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/forecasting/service.py#L121-L162) and opt-in `verify_db_records` parameter | See limitation L-1 (untested, unused by callers) |
| B-1 | 28-day training rule duplicated as a loader-level candidate gate | Removed from the validator. 84 days is enforced only when `require_promotion_eligible=True` | test 50 section G (83 rejected for rollback; 45 and 14 accepted by candidate loader); section L (84 accepted) |
| C-1 | Rollback not transactional | Pre-validation in memory, then same-filesystem backups, PID-scoped staging, staged-hash verification, atomic `os.replace` of `latest` files, manifest replace as commit point, post-commit verification, automatic recovery | [`rollback_forecast_model.py`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/forecasting/management/commands/rollback_forecast_model.py#L86-L209) |
| D-1 | Cache invalidation relied on `(mtime, size)` | Composite cache key (Section 4.2) | test 50 section M; test 22 |
| **S-1** | **Found in Stage 2.3:** cache keyed on model SHA alone; metadata-only changes served stale | [`_build_cache_key`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/forecasting/service.py#L71-L97) includes SHA-256 of exact metadata bytes and manifest bytes | test 22 (identical deterministic model bytes, different `model_version`); test 50 section I candidate assertions |
| **S-2** | **Found in Stage 2.3:** recovery restored manifest only | Backups of manifest **and** both `latest` files; on failure, all are restored, files that did not previously exist are removed, and incomplete recovery raises a distinct `RECOVERY INCOMPLETE` error that keeps the backups | test 50 section O (new) |

---

## 3. Before-and-After Behavior

| Scenario | Before Stage 2.3 | After Stage 2.3 |
| :--- | :--- | :--- |
| Metadata lacks `is_promotion_eligible` | Accepted by primary loader and rollback | Rejected on all three paths |
| `synthetic_records: false` | Could pass as zero | Rejected (Boolean) |
| Candidate trained on 14-45 genuine days | Rejected by loader (28-day gate) | Accepted for shadow evaluation only; still rejected for production/rollback |
| 83 vs 84 genuine days, production path | Inconsistent checks | 83 rejected, 84 accepted |
| Identical model bytes, changed metadata | Stale cached metadata served | Cache miss; full re-validation |
| Model replaced with identical mtime and size | Stale cache hit possible | Cache miss (metadata/manifest digest changed) |
| Rollback fails after `latest` files overwritten | Manifest restored; `latest` files left with target bytes | Manifest and both `latest` files restored byte-for-byte; no residue |

---

## 4. Validator Design and Enforcement Rules

### 4.1 Shared validator

[`validate_forecaster_artifact(model_bytes, metadata, require_validation_passed=True, require_promotion_eligible=True, target_label, verify_db_records=False)`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/forecasting/service.py#L165-L400) is called by:

| Caller | `require_validation_passed` | `require_promotion_eligible` |
| :--- | :--- | :--- |
| `load_latest_forecaster` | True | True |
| `load_candidate_forecaster` | False | False |
| `rollback_forecast_model` | True | True |

**Unconditional checks** (cannot be disabled by any parameter): non-empty dict metadata; exact ordered 26-feature `feature_schema`; `synthetic_records` present, non-Boolean int, equal to 0; `distinct_genuine_days` present, non-Boolean int, >= 0; `is_promotion_eligible` present, `bool`; `validation_status` present, in the allowed set; `genuine_records` consistency if present; valid 64-hex SHA-256 matching model bytes; library compatibility (4.3); in-memory deserialization; `feature_names` equals schema; horizons 1-7 present; each horizon's fitted `ColumnTransformer` columns equal `NUMERIC_FEATURES` (25) and `CATEGORICAL_FEATURES` (1).

**Gated checks:** `require_promotion_eligible=True` adds `is_promotion_eligible is True`, `distinct_genuine_days >= 84`, and `genuine_records >= 84` if present. `require_validation_passed=True` adds `validation_status == 'PASSED'`. Optional parameters only add checks; none removes an unconditional check.

### 4.2 Cache identity

Both loaders always read the metadata file (small) and compute a composite key from: model path, metadata path, model mtime, model size, SHA-256 of the exact metadata bytes, the declared model SHA, and SHA-256 of the exact manifest bytes. Any change forces a full reload through the shared validator. Any load error resets the cache (`_reset_latest_cache` / `_reset_candidate_cache`).

### 4.3 Library compatibility policy

| Library | Metadata key | Required | Rule | Justification |
| :--- | :--- | :--- | :--- | :--- |
| scikit-learn | `sklearn` | Yes | major.minor match | Estimator internals and pickled attributes change between minor releases |
| Python | `python` | Yes | major.minor match | Pickle compatibility of the stdlib and C extensions is not guaranteed across minor versions |
| joblib | `joblib` | Yes | major.minor match | Serialization container format |
| numpy | `numpy` | No (checked if present) | major match | ABI break boundary (1.x to 2.x) |
| pandas | `pandas` | No | Recorded only, not compared | Not present inside the pickled estimator objects; used upstream of the estimators |

---

## 5. Rollback Transaction and Recovery Design

```text
1. Read and validate target in memory (shared validator)  -- failure: no disk change
2. Back up existing active_manifest.json, waste_forecast_model_latest.joblib,
   waste_forecast_metadata_latest.json to .*.bak in the same directory
3. Stage target model, metadata, new manifest as .staging_{pid}_*
4. Re-hash staged model; must equal validated SHA
5. os.replace staged model/metadata -> latest files
6. COMMIT POINT: os.replace staged manifest -> active_manifest.json
7. Post-commit verification (_verify_committed_state)
8. Success: delete backups

On any exception in steps 3-7:
   restore every backed-up file via os.replace;
   delete live files that did not exist before the transaction;
   delete staging files;
   if any restore step fails -> CommandError "RECOVERY INCOMPLETE", backups retained;
   else -> CommandError "Rollback aborted and recovered".
```

All temporary and backup files live in the registry directory, so `os.replace` stays on one filesystem.

---

## 6. Test Inventory and Exact Results

### 6.1 Execution

```text
> python manage.py test analytics.tests.test_forecasting
Ran 50 tests in 31.068s
OK

> python manage.py check
System check identified no issues (0 silenced).
```

The test count is still 50. Stage 2.3 extended tests 22, 35 and 50; it did not add new test methods.

### 6.2 Tests changed in Stage 2.3

| Test | Change |
| :--- | :--- |
| `test_22_artifact_rollback_detection` | Not modified in the final fix pass. It failed on the first Stage 2.3 run and passes after the S-1 fix. It is the regression test for S-1 (deterministic fits produce identical model bytes) |
| `test_35_sparse_barangay_heuristic_fallback` | Fixture corrected: it set `distinct_genuine_days=84` with `genuine_records=47`, which the new consistency rule correctly rejects. Now sets `genuine_records >= 84`. Test intent (sparse barangay falls back to heuristic) unchanged |
| `test_50_shared_artifact_governance_comprehensive_matrix` | Sections A-O, below |

### 6.3 Test 50 sections (as implemented in [`test_forecasting.py`](file:///d:/Coding/Waste%20Watch/wastewatch/backend/analytics/tests/test_forecasting.py#L2211-L2602))

| Section | Scenario | Paths asserted |
| :--- | :--- | :--- |
| A / B | Subset / superset feature schema | Rollback, candidate |
| C | Non-zero synthetic records | Rollback, candidate |
| D | Missing `library_versions` | Rollback, candidate |
| E / F | Incompatible scikit-learn / Python | Rollback, candidate |
| G | 83 genuine days rejected for rollback; 45 and 14 accepted by candidate loader | Rollback, candidate |
| H | `is_promotion_eligible=False` rejected for rollback, accepted for candidate | Rollback, candidate |
| I.1-I.3 | Missing `distinct_genuine_days`, `is_promotion_eligible`, `validation_status` | Rollback, candidate |
| I.4 | `genuine_records` (80) < `distinct_genuine_days` (85) | Rollback |
| J | Metadata file missing on disk | Rollback |
| K1 / K2 | SHA mismatch / corrupt model bytes | Rollback |
| L | Valid rollback at the 84-day boundary | Rollback, primary |
| M | Replacement with identical model mtime | Primary (cache) |
| N | Rollback to an invalid target leaves the active manifest intact (fails at pre-validation) | Rollback, primary |
| **O (new)** | Valid target; fault injected at post-commit verification via `mock.patch.object(Command, '_verify_committed_state')`. Asserts manifest and both `latest` files are byte-identical to the pre-rollback state, no `.staging_*`/`.bak` residue, primary loader still serves prior model; then the same rollback succeeds without the fault | Rollback recovery, primary |

Primary-loader negative cases for missing metadata fields are covered by tests 12, 27, 33 and 49 (log output confirms `load_latest_forecaster` rejecting missing `distinct_genuine_days`, wrong schema lengths, and synthetic artifacts).

### 6.4 Not demonstrated

Section O was not run against the pre-fix rollback code as a negative control. The claim that it detects S-2 rests on reasoning: the old handler did not restore `latest` files, so the byte-equality assertion on them would fail.

---

## 7. Library Compatibility Policy

See Section 4.3. Required keys are `sklearn`, `python`, `joblib`. `numpy` is compared only when present. `pandas` is recorded only. Note that this report previously stated the key as `scikit-learn` and listed numpy as mandatory; both statements were incorrect and are corrected here.

---

## 8. Git Diff Summary

Diff against `HEAD` (`7a07c08`). **This diff includes the uncommitted prior governance remediation as well as Stage 2.3**, because neither has been committed; the two cannot be separated by `git diff` alone.

```text
 docs/FORECASTING_CALENDAR_FEATURE_VERIFICATION.md  |   9 +-
 .../backend/analytics/tests/test_forecasting.py    | 484 ++++++++++++++++++++-
 .../management/commands/rollback_forecast_model.py | 140 +++++-
 wastewatch/backend/forecasting/service.py          | 385 +++++++++++++---
 4 files changed, 932 insertions(+), 86 deletions(-)
```

Untracked documents: `docs/FORECASTING_ARTIFACT_GOVERNANCE_REMEDIATION_REPORT.md`, `docs/FORECASTING_STAGE_2_2_FORENSIC_PROVENANCE_REPORT.md`, this report.

---

## 9. Remaining Limitations

- **L-1:** `verify_artifact_database_provenance` has no dedicated test, and no caller passes `verify_db_records=True`. Offline validation proves metadata integrity and typing, not that the claimed genuine days exist in the database.
- **L-2:** Metadata provenance fields are not cryptographically signed. Anyone with write access to the registry can write internally consistent metadata. The SHA-256 binds metadata to model bytes, not to an authority.
- **L-3:** `genuine_records` is optional; only `distinct_genuine_days` is mandatory.
- **L-4:** Rollback recovery is in-process. A hard process kill between steps 5 and 6 leaves `.bak` files on disk with no automatic replay on the next start. A manual restore from the `.bak` files is possible.
- **L-5:** No concurrency lock. Two simultaneous rollbacks use different staging names but share the `.bak` names.
- **L-6 (out of scope, observed):** During the suite, `notifications/services.py` `notify_schedule_change` logs `AttributeError: 'str' object has no attribute 'strftime'` from a scheduling test fixture. It does not fail any test and is unrelated to forecasting. Not modified.

---

## 10. Production Safety Confirmation

- `FORECAST_ML_ENABLED = False` at [`settings.py` line 293](file:///d:/Coding/Waste%20Watch/wastewatch/backend/wastewatch/settings.py#L293); not modified.
- No retraining, promotion, or ML enablement performed.
- 26-column feature schema (25 numeric + `barangay_id`) unchanged.
- Changes are limited to `forecasting/service.py`, `rollback_forecast_model.py`, `analytics/tests/test_forecasting.py`, and documentation.

---

**FINAL STATUS:** `READY FOR INDEPENDENT STAGE 2.3 AUDIT`
