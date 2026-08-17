# Startup Scan Scope, Evidence Lookup, and Auto-Repair

ForgePilot 0.5.7 separates three concerns that were previously conflated.

1. **Startup proactive scan scope** controls broad enumeration and routine Discovery traversal. Discovery does not use a targeted evidence lookup as permission to recursively scan an excluded subtree.
2. **Evidence validity** is path-based, not Startup-manifest-membership-based. A normal evidence path is valid when it is project-relative, resolves inside the selected repository, and exists at save time. Therefore a concrete file under a Startup-excluded/vendor area may be used as targeted evidence without expanding proactive scan scope.
3. **Checklist auto-repair** is deliberately narrow. ForgePilot may repair a checklist-only evidence defect when the checklist row has no canonical semantic links. A `CHECKED_OK` row whose evidence cannot be verified can be downgraded to `NOT_INSPECTED_WITH_REASON`, invalid evidence removed, and an explicit `[ForgePilot auto-repair]` note appended. If the row is tied to findings, strengths, unknowns, or contradictions, the defect remains a hard failure.

Approved virtual evidence paths remain `@startup/scope`, `@startup/seal`, `@startup/workspace-manifest`, and `@discovery/context`.

Absolute paths, `..` traversal, paths resolving outside the selected workspace, and nonexistent repository paths are rejected.
