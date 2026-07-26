// ═══ NAV / CHROME ICON SET ═══
// Minimal stroke icons replacing the emoji that used to sit in the Studio header. Each is a
// 24×24 viewBox drawn with `currentColor`, so an icon inherits the colour of the button it sits
// in (active gold, inactive grey) with no per-call-site colour plumbing. One `size` knob keeps
// every nav icon optically equal — emoji couldn't be size-matched because each font renders them
// at its own optical weight.

const svg = (size) => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": "true",
  focusable: "false",
  style: { display: "block", flexShrink: 0 },
});

// Colour wheel — Studio / design mode.
export function IconPalette({ size = 15 }) {
  return (
    <svg {...svg(size)}>
      <circle cx="12" cy="12" r="9" />
      <circle cx="8.5" cy="10" r="1.15" fill="currentColor" stroke="none" />
      <circle cx="12" cy="7.8" r="1.15" fill="currentColor" stroke="none" />
      <circle cx="15.5" cy="10.5" r="1.15" fill="currentColor" stroke="none" />
    </svg>
  );
}

// Sliders — Manage mode.
export function IconSliders({ size = 15 }) {
  return (
    <svg {...svg(size)}>
      <path d="M4 7.5h9.5M18.5 7.5H20" />
      <circle cx="16" cy="7.5" r="2.1" />
      <path d="M4 16.5h1.5M10.5 16.5H20" />
      <circle cx="8" cy="16.5" r="2.1" />
    </svg>
  );
}

// Book — Library & content.
export function IconBook({ size = 15 }) {
  return (
    <svg {...svg(size)}>
      <path d="M4 4.5A1.5 1.5 0 0 1 5.5 3H20v18H5.5A1.5 1.5 0 0 1 4 19.5z" />
      <path d="M8 3v18" />
    </svg>
  );
}

// Gear — Settings.
export function IconGear({ size = 15 }) {
  return (
    <svg {...svg(size)}>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 2.6v2.5M12 18.9v2.5M2.6 12h2.5M18.9 12h2.5M5.4 5.4l1.8 1.8M16.8 16.8l1.8 1.8M18.6 5.4l-1.8 1.8M7.2 16.8l-1.8 1.8" />
    </svg>
  );
}

// Carton — IMS / inventory.
export function IconBox({ size = 15 }) {
  return (
    <svg {...svg(size)}>
      <path d="M20.5 7.5 12 3 3.5 7.5v9L12 21l8.5-4.5z" />
      <path d="M3.5 7.5 12 12l8.5-4.5" />
      <path d="M12 12v9" />
    </svg>
  );
}

// Clipboard with ruled lines — a form/brief still being filled in.
export function IconClipboard({ size = 15 }) {
  return (
    <svg {...svg(size)}>
      <path d="M9 4.25H7a2 2 0 0 0-2 2V19a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V6.25a2 2 0 0 0-2-2h-2" />
      <rect x="9" y="2.5" width="6" height="3.5" rx="1.1" />
      <path d="M8.75 11.5h6.5M8.75 15.25h4.25" />
    </svg>
  );
}

// Clipboard with a tick — Deal Check.
export function IconClipboardCheck({ size = 15 }) {
  return (
    <svg {...svg(size)}>
      <path d="M9 4.25H7a2 2 0 0 0-2 2V19a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V6.25a2 2 0 0 0-2-2h-2" />
      <rect x="9" y="2.5" width="6" height="3.5" rx="1.1" />
      <path d="M8.75 13.25 11 15.5l4.25-4.25" />
    </svg>
  );
}

// Door with an out-arrow — Logout.
export function IconLogout({ size = 15 }) {
  return (
    <svg {...svg(size)}>
      <path d="M15 21H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9" />
      <path d="M16.5 8.5 20 12l-3.5 3.5" />
      <path d="M20 12H9.5" />
    </svg>
  );
}

// Tick — completed wizard step.
export function IconCheck({ size = 15 }) {
  return (
    <svg {...svg(size)}>
      <path d="M4.5 12.5 9 17l10.5-10.5" />
    </svg>
  );
}

// Sparkle — AI-generated / AI-tagged content.
export function IconSparkle({ size = 15 }) {
  return (
    <svg {...svg(size)}>
      <path d="M11 3.5l1.5 4L16.5 9l-4 1.5L11 14.5 9.5 10.5 5.5 9l4-1.5z" />
      <path d="M17.5 15l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z" />
    </svg>
  );
}

// Crown — senior-designer / premium gate.
export function IconCrown({ size = 15 }) {
  return (
    <svg {...svg(size)}>
      <path d="M3.5 7.5l4 3.5L12 4l4.5 7 4-3.5-1.7 10.5H5.2z" />
      <path d="M5.2 20.5h13.6" />
    </svg>
  );
}

// Diskette — a saved session.
export function IconSave({ size = 15 }) {
  return (
    <svg {...svg(size)}>
      <path d="M5.5 4h9L19 8.5V19a1.5 1.5 0 0 1-1.5 1.5h-12A1.5 1.5 0 0 1 4 19V5.5A1.5 1.5 0 0 1 5.5 4z" />
      <path d="M8 4v4.5h6" />
      <path d="M8.5 20.5v-4.8h7v4.8" />
    </svg>
  );
}

// Warning triangle — blocking notices.
export function IconAlert({ size = 15 }) {
  return (
    <svg {...svg(size)}>
      <path d="M12 4.2 21 20H3z" />
      <path d="M12 10v4.2" />
      <path d="M12 17.1h.01" />
    </svg>
  );
}

// Solid play — video thumbnail overlay.
export function IconPlay({ size = 15 }) {
  return (
    <svg {...svg(size)}>
      <path d="M9 6.2 18.2 12 9 17.8z" fill="currentColor" />
    </svg>
  );
}

// Pencil — correct / edit in place.
export function IconPencil({ size = 15 }) {
  return (
    <svg {...svg(size)}>
      <path d="M4.5 19.5h4l10-10a2.1 2.1 0 0 0-3-3l-10 10z" />
      <path d="M14.8 5.7 18.3 9.2" />
    </svg>
  );
}

// Ruler — dimensions / zone structure.
export function IconRuler({ size = 15 }) {
  return (
    <svg {...svg(size)}>
      <path d="M15.2 3.3 20.7 8.8 8.8 20.7 3.3 15.2z" />
      <path d="M8.4 10.1l1.8 1.8M11.2 7.3l1.8 1.8M5.6 12.9l1.8 1.8" />
    </svg>
  );
}

// Bolt — truss hardware.
export function IconBolt({ size = 15 }) {
  return (
    <svg {...svg(size)}>
      <circle cx="12" cy="12" r="4.2" />
      <path d="M12 3.4v4.4M12 16.2v4.4M4.6 7.8l3.8 2.2M15.6 14l3.8 2.2M4.6 16.2l3.8-2.2M15.6 10l3.8-2.2" />
    </svg>
  );
}

// Brick coursing — masking panels.
export function IconWall({ size = 15 }) {
  return (
    <svg {...svg(size)}>
      <rect x="3.5" y="5" width="17" height="14" rx="1.6" />
      <path d="M3.5 9.7h17M3.5 14.3h17M9.2 5v4.7M14.8 9.7v4.6M9.2 14.3V19" />
    </svg>
  );
}

// Stage riser — platform.
export function IconPlatform({ size = 15 }) {
  return (
    <svg {...svg(size)}>
      <path d="M3.2 13.5h17.6v4.2H3.2z" />
      <path d="M6.2 13.5V9.8h11.6v3.7" />
      <path d="M8.8 17.7v3M15.2 17.7v3" />
    </svg>
  );
}

// Rolled floor covering — carpet.
export function IconCarpet({ size = 15 }) {
  return (
    <svg {...svg(size)}>
      <path d="M4 17.5c0-1.4 1.1-2.5 2.5-2.5H20v5H6.5A2.5 2.5 0 0 1 4 17.5z" />
      <path d="M6.5 15V6.5A2.5 2.5 0 0 1 9 4h11v11" />
      <path d="M9 8h8" />
    </svg>
  );
}

// Bulb — a hint or tip.
export function IconBulb({ size = 15 }) {
  return (
    <svg {...svg(size)}>
      <path d="M9.2 17.2a6 6 0 1 1 5.6 0" />
      <path d="M9.4 17.2h5.2v2.1a1.6 1.6 0 0 1-1.6 1.6h-2a1.6 1.6 0 0 1-1.6-1.6z" />
    </svg>
  );
}

// Camera — client photo / photo selection.
export function IconCamera({ size = 15 }) {
  return (
    <svg {...svg(size)}>
      <path d="M3.8 8.5A2 2 0 0 1 5.8 6.5h1.7l1.2-2h6.6l1.2 2h1.7a2 2 0 0 1 2 2v8.5a2 2 0 0 1-2 2H5.8a2 2 0 0 1-2-2z" />
      <circle cx="12" cy="12.8" r="3.1" />
    </svg>
  );
}

// Printer — print jobs.
export function IconPrinter({ size = 15 }) {
  return (
    <svg {...svg(size)}>
      <path d="M7 9V3.8h10V9" />
      <path d="M7 17.5H5.5a1.8 1.8 0 0 1-1.8-1.8v-4.9A1.8 1.8 0 0 1 5.5 9h13a1.8 1.8 0 0 1 1.8 1.8v4.9a1.8 1.8 0 0 1-1.8 1.8H17" />
      <rect x="7" y="14.5" width="10" height="5.7" rx="1" />
    </svg>
  );
}

// Note — client note.
export function IconNote({ size = 15 }) {
  return (
    <svg {...svg(size)}>
      <path d="M5 4.5h9.5L19 9v10.5a1.5 1.5 0 0 1-1.5 1.5h-12A1.5 1.5 0 0 1 4 19.5V6a1.5 1.5 0 0 1 1-1.5z" />
      <path d="M14 4.5V9h4.5" />
      <path d="M8 13h7M8 16.5h4.5" />
    </svg>
  );
}

// Magnifier — filters / search.
export function IconSearch({ size = 15 }) {
  return (
    <svg {...svg(size)}>
      <circle cx="10.8" cy="10.8" r="6.3" />
      <path d="M15.4 15.4 20 20" />
    </svg>
  );
}

// Calendar — event date.
export function IconCalendar({ size = 15 }) {
  return (
    <svg {...svg(size)}>
      <rect x="3.8" y="5.5" width="16.4" height="15" rx="2.2" />
      <path d="M3.8 10h16.4M8.5 3.5v4M15.5 3.5v4" />
    </svg>
  );
}

// Bloom — floral / artificial-vs-real ratio.
export function IconFlower({ size = 15 }) {
  return (
    <svg {...svg(size)}>
      <circle cx="12" cy="11" r="2.4" />
      <path d="M12 8.6c0-2.4-3.4-2.4-3.4 0s3.4 2.4 3.4 0M12 13.4c0 2.4 3.4 2.4 3.4 0s-3.4-2.4-3.4 0" />
      <path d="M9.6 11c-2.4 0-2.4 3.4 0 3.4S12 11 9.6 11M14.4 11c2.4 0 2.4-3.4 0-3.4S12 11 14.4 11" />
      <path d="M12 16v4.5" />
    </svg>
  );
}

// Factory — production items.
export function IconFactory({ size = 15 }) {
  return (
    <svg {...svg(size)}>
      <path d="M3.5 20.5V10l5 3.2V10l5 3.2V10l5 3.2v7.3z" />
      <path d="M6.5 10V5.5h3V10" />
    </svg>
  );
}

// Trolley — buying items.
export function IconCart({ size = 15 }) {
  return (
    <svg {...svg(size)}>
      <path d="M3 4h2.3l2.4 10.5h9.6L19.5 7H6.2" />
      <circle cx="9" cy="19" r="1.6" />
      <circle cx="16.6" cy="19" r="1.6" />
    </svg>
  );
}

// Stacked sheets — duplicate.
export function IconCopy({ size = 15 }) {
  return (
    <svg {...svg(size)}>
      <rect x="8.5" y="8.5" width="11.5" height="11.5" rx="2" />
      <path d="M15.5 5.5A2 2 0 0 0 13.5 3.5H6A2 2 0 0 0 4 5.5V13a2 2 0 0 0 2 2" />
    </svg>
  );
}

// Cycle arrows — reused setup.
export function IconRepeat({ size = 15 }) {
  return (
    <svg {...svg(size)}>
      <path d="M4 9.5A5 5 0 0 1 9 5h9" />
      <path d="M15.5 2.5 18.5 5l-3 2.5" />
      <path d="M20 14.5A5 5 0 0 1 15 19H6" />
      <path d="M8.5 21.5 5.5 19l3-2.5" />
    </svg>
  );
}

// Chevron — collapsible section toggle. Rotated by the caller for the open state.
export function IconChevron({ size = 15 }) {
  return (
    <svg {...svg(size)}>
      <path d="M6.5 9.5 12 15l5.5-5.5" />
    </svg>
  );
}

// Padlock — permission-denied states.
export function IconLock({ size = 15 }) {
  return (
    <svg {...svg(size)}>
      <rect x="4.5" y="10.5" width="15" height="10.5" rx="2.5" />
      <path d="M8 10.5V7a4 4 0 0 1 8 0v3.5" />
    </svg>
  );
}
