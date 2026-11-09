This is a single self-contained fix; keep it small and focused. Make both the bottom sheet drawer and the top navigation direction banner in `WatcherMapTaskModule.jsx` retractable / collapsible so that the map view is unobscured when collapsed and expandable when needed.

Working directory: d:\Coding\Waste Watch
Integrity mode: development

## Requirements

### R1. Collapsible Bottom Sheet Drawer
The bottom sheet drawer ("NEAREST PENDING STOP" card) in `d:\Coding\Waste Watch\wastewatch\frontend\src\pages\watcher\WatcherMapTaskModule.jsx` must be toggleable between an expanded state and a retracted/collapsed state (e.g. by clicking the drag handle or a toggle control). When collapsed, the map view is unobscured while retaining an interactive handle/button to re-expand the drawer.

### R2. Retractable Top Direction Banner
The top navigation direction banner ("Head [direction] on [stop]") in `WatcherMapTaskModule.jsx` must be toggleable/collapsible so that it can be retracted or dismissed to clear the top portion of the map view and re-expanded or toggled when needed.

### R3. Iconography Constraints
Strictly avoid using any emojis in the UI and source code. All iconography must use SVG, Lucide, or Material UI icons.

## Acceptance Criteria

### Collapsible Bottom Sheet Drawer
- [ ] The bottom sheet drawer in `WatcherMapTaskModule.jsx` can be toggled between an expanded state and a retracted/collapsed state.
- [ ] In the collapsed state, the main body of the drawer is hidden to reveal the map underneath, while a visible handle or toggle control remains accessible to re-expand it.
- [ ] Clicking or interacting with the handle/toggle restores the drawer to its expanded state with all stop details and action buttons fully functional.

### Retractable Top Direction Banner
- [ ] The top navigation direction banner can be retracted/collapsed to clear the upper map view.
- [ ] A control or trigger is available to toggle or re-expand the direction banner.

### Iconography and Code Quality
- [ ] No emojis are present in `WatcherMapTaskModule.jsx` or any related updated files.
- [ ] Any icons used for collapse/expand toggles (e.g., chevrons or arrows) use Material UI, SVG, or Lucide icons.

### Verification
- [ ] `npm run build` in `wastewatch/frontend` succeeds without errors.
- [ ] `npm run lint` in `wastewatch/frontend` succeeds without lint errors.
